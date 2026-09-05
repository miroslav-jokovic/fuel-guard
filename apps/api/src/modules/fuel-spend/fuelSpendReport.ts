/**
 * The fuel-spend report as a document — the thing a fleet manager forwards to somebody who will not
 * open the app.
 *
 * ── WHY IT IS RENDERED ON THE SERVER FROM THE ROLLUP ─────────────────────────────────────────────
 * Not from whatever the browser happens to be showing. A figure in a PDF outlives the session that
 * made it and will be quoted back months later, so it is derived from `fuel_spend_days` by the same
 * pure functions the page uses (`spendSeries`, `operatingBridge`, `analyzePolicyExceptions`). Page and
 * document cannot disagree, because neither does its own arithmetic.
 *
 * ── WHAT IT SAYS WHEN IT CANNOT SAY SOMETHING ────────────────────────────────────────────────────
 * The bridge withholds its miles/efficiency split when a period's odometer coverage is too thin or its
 * MPG is impossible. The document prints that refusal instead of quietly dropping two bars, and stamps
 * every page with the window, the source and the odometer intervals that were refused. A report a boss
 * cannot trace back to a source is one nobody can act on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  analyzeContractCapture,
  analyzePolicyExceptions,
  describeRollupFreshness,
  fuelPolicyFromSettings,
  type FuelPolicy,
  type FuelPolicyRow,
  comparablePeriods,
  periodTotals,
  type ContractCapture,
  type FleetIdleVerdict,
  type SpendPeriod,
  spendSeries,
  type SpendDay,
  type MileageAgreement,
  type SpendGrain,
  type SpendLine,
} from "@silvicom/shared";
import { eachPage } from "../../lib/paging.js";
import { newDrawing, winAnsi } from "../../lib/pdfDraw.js";
import { letterhead, stampPages } from "./fuelSpendReportDraw.js";
import { setDensity } from "./fuelSpendReportFlow.js";
import { GEOM } from "./fuelSpendReportTheme.js";
import { drawBridge, drawHeadline, drawSeries, drawVerdict } from "./fuelSpendReportSections.js";
import { drawDiscount, drawExceptions, drawIdle } from "./fuelSpendReportPolicy.js";
import { plural, usd, windowLabel } from "./fuelSpendReportFormat.js";
import { readFleetIdleVerdict } from "../idle/index.js";
import { getMileageAgreement } from "./mileageAgreement.js";

export interface FuelSpendReportInput {
  orgId: string;
  from: string;
  to: string;
  grain: SpendGrain;
  /**
   * Vehicles the reader had narrowed to, or empty for the whole fleet.
   *
   * A report that quietly covered every truck while the screen showed three is a document somebody
   * acts on and cannot reconcile later, so the filter travels with the request and is printed on the
   * page rather than assumed.
   */
  vehicleIds?: string[];
  /** The org's configured idle burn rate; the default is used when it has none. */
  idleGalPerHour?: number;
  /** Stamped on the document; the caller owns the clock so the render stays deterministic in tests. */
  generatedAt: string;
}


export async function renderFuelSpendReport(
  admin: SupabaseClient,
  input: FuelSpendReportInput,
): Promise<{ pdf: Buffer; periods: number; carrier: string; pages: number }> {
  const vehicleIds = input.vehicleIds ?? [];
  const [days, lines, carrier, units, idle, policy, builtAt, agreement] = await Promise.all([
    readSpendDays(admin, input.orgId, input.from, input.to, vehicleIds),
    readSpendLines(admin, input.orgId, input.from, input.to, vehicleIds),
    readCarrier(admin, input.orgId),
    readUnitNumbers(admin, input.orgId, vehicleIds),
    // The real verdict — equipment flags, HOS duty overlay, temperature envelope — not idle seconds
    // times a burn rate. Fleet-wide: the truck filter narrows FUEL, and an idle figure for three
    // trucks against a fleet-wide baseline would be the more misleading of the two options.
    readFleetIdleVerdict(admin, input.orgId, input.from, input.to),
    readFuelPolicy(admin, input.orgId),
    readRollupBuiltAt(admin, input.orgId, input.from, input.to, vehicleIds),
    // The check that would have caught the 2026-07-28 mileage step the week it happened (M5, Q3).
    // FLEET-WIDE deliberately, even when the reader has narrowed to three trucks: the question is
    // whether the two SOURCES agree, and a divergence that appears and disappears as somebody picks
    // trucks teaches a reader to ignore it.
    getMileageAgreement(admin, input.orgId, input.from, input.to),
  ]);
  // The same sentence the screen prints, from the same pure function — `readSpendLines` above carries
  // a scar about exactly this: its query drifted from the page's and the document went on saying "no
  // fill could be matched to a posted price" while the screen measured 1,201 of them.
  const freshness = describeRollupFreshness(builtAt, new Date(input.generatedAt));

  // The requested window, so an edge bucket is labelled by the days it holds rather than by the
  // calendar week it belongs to — see `spendSeries`.
  const series = spendSeries(days, input.grain, { from: input.from, to: input.to }, {
    idleGalPerHour: input.idleGalPerHour,
  });
  const overall = periodTotals(days, input.from, input.to);
  // NOT `includePartial`. The newest bucket is normally still filling, and comparing a one-day week
  // against a finished one made the first render of this report announce spend down 88% and a $271,841
  // saving from "miles driven" — a collapse that never happened, in a document meant to be forwarded.
  const comparison = comparablePeriods(series);
  // This org's policy, from the same `route_fuel_settings` columns the page and the route planner read.
  // A document is the worst place for the constant this used to be: it outlives the session that made
  // it and gets quoted back, so a report headed with a state the carrier does not avoid is a claim
  // nobody can trace or correct.
  const exceptions = analyzePolicyExceptions(lines, policy);
  const capture = analyzeContractCapture(lines);
  const window = windowLabel(input.from, input.to);
  const fleet = units.length === 0
    ? "Whole fleet"
    : units.length <= 4
      ? `Units ${units.join(", ")}`
      : plural(units.length, "unit");

  const refused = days.reduce((a: number, d: SpendDay) => a + d.milesRejected, 0);
  const compose = (density: number) =>
    composeDocument({
      density, carrier, window, refused, idle, series, overall, comparison, exceptions, capture, lines, policy, agreement,
      grain: input.grain, generatedAt: input.generatedAt,
      meta: [
        { label: "Period", value: window },
        { label: "Reported", value: GRAIN_LABEL[input.grain] },
        { label: "Scope", value: fleet },
        { label: "Fills", value: plural(lines.length, "fill") },
        // A6 / D-FUI18. On the letterhead rather than in a footnote: a document is forwarded and
        // quoted back months later, so how current its figures are belongs beside its period, not
        // below its conclusions. Omitted entirely when the window holds no rows — there is nothing to
        // qualify, and "built never" is not a fact about freshness.
        ...(freshness.short ? [{ label: "Figures built", value: freshness.short }] : []),
      ],
    });

  const roomy = await compose(1);
  const chosen = await tightenIfTailIsAStub(roomy, compose);
  // `pages` is returned so the pagination itself is testable. It was not, and the document spent a
  // release emitting pages that held one string each.
  return { pdf: chosen.pdf, periods: series.length, carrier, pages: chosen.pages };
}

/**
 * Keep the roomy composition unless its last page is a stub AND composing tighter saves a page.
 *
 * ── WHY THE SECOND PASS IS CONDITIONAL AND WHY IT CAN BE REJECTED ───────────────────────────────
 * Measured across the shapes production actually produces — a fortnight at day grain, a quarter at
 * week grain, one truck, a carrier with no quotes on file — the failure was always the same: content
 * coming to a bit over a whole number of pages, and the remainder stranded on a final page 80% white.
 * Every individual break was correct; the document was still wrong.
 *
 * Composing is a few milliseconds of in-memory pdfkit, so the cheap answer is to do it twice and keep
 * the better one. The tight pass is DISCARDED unless it drops the page count, because a document that
 * gave up its air and still runs to three pages is strictly worse than one that did not.
 */
const STUB_TAIL = 0.4;
/**
 * Two attempts, not one. The gentler density recovers a page on its own in most of the cases that need
 * it, and only where it does not is the harder one tried — so a document is never squeezed further
 * than it had to be to lose the stub. `MIN_GAP` in `fuelSpendReportFlow` bounds the bottom of this.
 */
const TIGHT_DENSITIES = [0.55, 0.3];

async function tightenIfTailIsAStub(
  roomy: Composed,
  compose: (density: number) => Promise<Composed>,
): Promise<Composed> {
  const tail = (roomy.lastY - MARGIN) / (CONTENT_BOTTOM - MARGIN);
  if (roomy.pages < 2 || tail >= STUB_TAIL) return roomy;
  for (const density of TIGHT_DENSITIES) {
    const tight = await compose(density);
    if (tight.pages < roomy.pages) return tight;
  }
  return roomy;
}

interface Composed {
  pdf: Buffer;
  pages: number;
  /** Where content stopped on the final page — how full the tail is. */
  lastY: number;
}

interface ComposeInput {
  density: number;
  carrier: string;
  window: string;
  refused: number;
  meta: { label: string; value: string }[];
  idle: FleetIdleVerdict | null;
  series: SpendPeriod[];
  overall: SpendPeriod;
  comparison: { prior: SpendPeriod; current: SpendPeriod } | null;
  exceptions: ReturnType<typeof analyzePolicyExceptions>;
  policy: FuelPolicy;
  capture: ContractCapture;
  lines: SpendLine[];
  /** The cross-source mileage check — printed only when it has something to say (M5). */
  agreement: MileageAgreement;
  grain: SpendGrain;
  generatedAt: string;
}

/** Draw the whole document at one density. Called once, or twice — see above. */
async function composeDocument(c: ComposeInput): Promise<Composed> {
  const { doc, done } = newDrawing("Silvicom 360 — Fuel spend", { bufferPages: true });
  setDensity(doc, c.density);

  letterhead(doc, c.carrier, "Fuel spend", "What fuel cost, why it moved, and where the fuel policy was not followed.", c.meta);
  drawVerdict(doc, c.overall, c.comparison, c.grain, supportLine(c.exceptions, c.capture));
  drawHeadline(doc, c.overall, c.series, c.comparison, c.grain, c.agreement);
  drawBridge(doc, c.comparison, c.grain, 1);
  drawSeries(doc, c.series, c.overall, c.grain, 2);
  drawDiscount(doc, c.capture, c.lines, 3);
  drawIdle(doc, c.series, c.grain, c.idle, 4);
  drawExceptions(doc, c.exceptions, 5, c.policy);

  // Read BEFORE `stampPages`, which switches to page 1 and leaves `doc.y` wherever the footer left it.
  const lastY = doc.y;
  const pages = doc.bufferedPageRange().count;

  stampPages(
    doc,
    winAnsi(`${c.carrier} · Fuel spend · ${c.window}`),
    winAnsi(
      `Silvicom 360 · derived from recorded fills, odometer intervals and engine time · generated ${c.generatedAt.slice(0, 16).replace("T", " ")} UTC` +
        (c.refused > 0 ? ` · ${c.refused} odometer interval(s) refused as implausible` : ""),
    ),
  );
  doc.end();
  return { pdf: await done, pages, lastY };
}


const GRAIN_LABEL: Record<SpendGrain, string> = { day: "Daily", week: "Weekly", month: "Monthly" };
const { margin: MARGIN, contentBottom: CONTENT_BOTTOM } = GEOM;

/**
 * The line under the verdict: the two findings that are somebody's to answer for.
 *
 * Deliberately only these two. The verdict band is the one thing in the document guaranteed to be
 * read, and a band that tried to summarise all five sections would be a paragraph — which is the shape
 * the eye skips. Off-policy excess and money billed above contract are the two figures a carrier can
 * actually go and recover, so they are the two that ride at the top.
 */
function supportLine(
  exceptions: ReturnType<typeof analyzePolicyExceptions>,
  capture: ContractCapture,
): string {
  const parts: string[] = [];
  // NOT the sum of the three reports: they select overlapping populations, so a ONE9 fill in an
  // avoided state was counted three times in the figure a boss reads first. `offPolicy` is the union,
  // scored once (see `PolicyExceptions.offPolicy`).
  const offPolicy = exceptions.offPolicy.excess;
  if (offPolicy > 0) {
    parts.push(
      `Fills outside the fuel policy cost ${usd(offPolicy)} more than the fleet paid elsewhere over the same window`,
    );
  }
  if (capture.overDollars > 0) {
    parts.push(
      `${capture.overLines} fill(s) were billed above the contracted price, ${usd(capture.overDollars)} in total`,
    );
  }
  if (parts.length === 0) {
    return capture.measuredLines > 0
      ? "Every measurable fill was billed at its contracted price, and no fill fell outside the fuel policy."
      : "No fill in this window could be matched to a quote, so nothing here is measured against contract.";
  }
  return `${parts.join(", and ")}.`;
}

// ── reads ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The OLDEST `fuel_spend_days.updated_at` in the window — when the least-recently-derived figure in
 * this document was last built (FUEL-T5, A6, D-FUI18).
 *
 * The rollup rebuilds only the trailing 14 days, so a report reaching further back contains figures
 * derived once and never re-derived through any correction since. A PDF is the worst place for that to
 * be invisible: it outlives the session that made it and gets quoted back months later, which is the
 * same argument the fuel-policy read above already makes about hardcoded constants.
 *
 * One ordered row, not a fold over the pages `readSpendDays` walks — the answer is one timestamp.
 */
async function readRollupBuiltAt(
  admin: SupabaseClient, orgId: string, from: string, to: string, vehicleIds: string[],
): Promise<string | null> {
  const q = admin.from("fuel_spend_days").select("updated_at")
    .eq("org_id", orgId).gte("day", from).lte("day", to);
  const { data, error } = await (vehicleIds.length > 0 ? q.in("vehicle_id", vehicleIds) : q)
    .order("updated_at", { ascending: true }).limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as { updated_at?: string } | undefined)?.updated_at ?? null;
}

async function readSpendDays(admin: SupabaseClient, orgId: string, from: string, to: string, vehicleIds: string[]): Promise<SpendDay[]> {
  const out: SpendDay[] = [];
  await eachPage<Record<string, unknown>>(
    (a, b) =>
      (() => {
        const q = admin.from("fuel_spend_days")
          .select("day, vehicle_id, fills, gallons_tractor, gallons_reefer, gallons_def, spend_tractor, spend_reefer, spend_def, miles, mpg_gallons, miles_rejected, drive_sec, idle_sec, off_sec, coverage_sec")
          .eq("org_id", orgId).gte("day", from).lte("day", to);
        return (vehicleIds.length > 0 ? q.in("vehicle_id", vehicleIds) : q)
          .order("day", { ascending: true }).range(a, b);
      })(),
    (rows) => {
      const n = (v: unknown) => (v == null ? 0 : Number(v) || 0);
      for (const r of rows) {
        out.push({
          day: String(r.day), vehicleId: r.vehicle_id == null ? null : String(r.vehicle_id),
          fills: n(r.fills), gallonsTractor: n(r.gallons_tractor), gallonsReefer: n(r.gallons_reefer),
          gallonsDef: n(r.gallons_def), spendTractor: n(r.spend_tractor), spendReefer: n(r.spend_reefer),
          spendDef: n(r.spend_def), miles: n(r.miles), mpgGallons: n(r.mpg_gallons),
          milesRejected: n(r.miles_rejected), driveSec: n(r.drive_sec), idleSec: n(r.idle_sec),
          offSec: n(r.off_sec), coverageSec: n(r.coverage_sec),
        });
      }
    },
  );
  return out;
}

/**
 * Fills with their brand AND the posted price that applied that day, through `fuel_spend_lines` (0246).
 *
 * ⚠ This used to be a direct query that hard-coded `retailAmount: null`, matching what the feed alone
 * can supply. When the page moved onto the joined function this did not, so the document kept saying
 * "no fill could be matched to a posted price" while the screen beside it measured 1,201 of them. Page
 * and report must read the same source or they will disagree exactly like that.
 */
/**
 * ⚠ `p_org` IS NOT OPTIONAL HERE, whatever its default says.
 *
 * This comment used to read "fuel_spend_lines scopes itself: it is security-invoker over org-scoped
 * tables". The first half is true and the second does not follow. Security-invoker means RLS decides —
 * and `admin` is the SERVICE ROLE, which bypasses RLS. The function took no org, so this read returned
 * every carrier in the database and the document below mixed a test org's 267 fills into a real
 * carrier's exception and discount sections. That is the hard rule in CLAUDE.md: a service query
 * org-filters itself or it is wrong. See D-FC1 in migration 0247.
 */
async function readSpendLines(admin: SupabaseClient, orgId: string, from: string, to: string, vehicleIds: string[]): Promise<SpendLine[]> {
  const out: SpendLine[] = [];
  const str = (v: unknown): string | null => (v == null ? null : String(v));
  const n = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
  await eachPage<Record<string, unknown>>(
    (a, b) =>
      admin
        .rpc("fuel_spend_lines", {
          p_from: from,
          p_to: to,
          p_vehicles: vehicleIds.length > 0 ? vehicleIds : null,
          p_org: orgId,
        })
        .range(a, b),
    (rows) => {
      for (const r of rows) {
        out.push({
          tranDate: str(r.tran_date),
          brand: str(r.brand),
          state: str(r.state),
          site: str(r.site),
          city: str(r.city),
          unit: str(r.unit),
          driver: str(r.driver),
          product: "diesel",
          tank: r.tank === "reefer" ? "reefer" : "tractor",
          gallons: n(r.gallons),
          netAmount: r.net_amount == null ? null : n(r.net_amount),
          // Null when no quote was in range — never 0, which would read as a fill billed exactly at
          // contract rather than as one nobody could measure.
          retailAmount: r.retail_amount == null ? null : n(r.retail_amount),
          contractAmount: r.contract_amount == null ? null : n(r.contract_amount),
          quoteStaleDays: r.quote_stale_days == null ? null : n(r.quote_stale_days),
        });
      }
    },
  );
  return out;
}

/**
 * Unit numbers for the letterhead — a report has to say which trucks it covers.
 *
 * Note that narrowing to trucks excludes the unattributed row by construction: `.in()` on a null
 * `vehicle_id` never matches. That is correct — fuel belonging to no truck cannot belong to the ones
 * the reader asked about — but it does mean a filtered report will not tie to the whole invoice.
 */
async function readUnitNumbers(admin: SupabaseClient, orgId: string, vehicleIds: string[]): Promise<string[]> {
  if (vehicleIds.length === 0) return [];
  const { data } = await admin.from("vehicles").select("unit_number").eq("org_id", orgId).in("id", vehicleIds);
  return ((data ?? []) as { unit_number: string | null }[])
    .map((v) => v.unit_number)
    .filter((u): u is string => !!u)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * The org's fuel policy. Org-filtered explicitly: `admin` is the SERVICE ROLE and bypasses RLS, so the
 * `.eq("org_id", …)` here is the only tenant boundary this read has — the same rule 0247's D-FC1 states
 * for `fuel_spend_lines`, and the reason `expectOrgScoped` asserts it.
 */
async function readFuelPolicy(admin: SupabaseClient, orgId: string): Promise<FuelPolicy> {
  const { data } = await admin
    .from("route_fuel_settings")
    .select("avoid_states, avoid_brands, preferred_brands")
    .eq("org_id", orgId)
    .maybeSingle();
  return fuelPolicyFromSettings(data as FuelPolicyRow | null);
}

async function readCarrier(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? "Carrier";
}
