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
  analyzePolicyExceptions, comparablePeriods, operatingBridge, periodTotals, spendSeries,
  type SpendDay, type SpendGrain, type SpendLine, type SpendPeriod,
} from "@fuelguard/shared";
import { eachPage } from "../lib/paging.js";
import { CONTENT_WIDTH, INK, MUTED, body, heading, muted, newDrawing, table, winAnsi } from "./dqBinder/pdfDraw.js";
import { kpiRow, letterhead, money, stampFooters, waterfall, type Kpi } from "./fuelSpendReportDraw.js";

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

const usd = (n: number | null | undefined) =>
  n == null ? "-" : `$${Math.round(n).toLocaleString("en-US")}`;
const usd2 = (n: number | null | undefined) => (n == null ? "-" : `$${n.toFixed(2)}`);
const usd3 = (n: number | null | undefined) => (n == null ? "-" : `$${n.toFixed(3)}`);
const num = (n: number | null | undefined, dp = 0) =>
  n == null ? "-" : n.toLocaleString("en-US", { maximumFractionDigits: dp });
/** A formatted delta plus the verdict on it — `upIsBad` says which direction is the bad one. */
function change(a: number | null | undefined, b: number | null | undefined, upIsBad: boolean): Pick<Kpi, "delta" | "deltaIsBad"> {
  if (a == null || b == null || a === 0 || a === b) return {};
  const p = ((b - a) / Math.abs(a)) * 100;
  return {
    delta: `${p >= 0 ? "+" : "-"}${Math.abs(p).toFixed(1)}% vs prior`,
    // The sign and the preference resolved together. Spend up is bad; MPG up is the one good headline
    // this report ever gets, and a tile that painted it red would bury it.
    deltaIsBad: p > 0 === upIsBad,
  };
}

export async function renderFuelSpendReport(
  admin: SupabaseClient,
  input: FuelSpendReportInput,
): Promise<{ pdf: Buffer; periods: number; carrier: string }> {
  const vehicleIds = input.vehicleIds ?? [];
  const [days, lines, carrier, units] = await Promise.all([
    readSpendDays(admin, input.orgId, input.from, input.to, vehicleIds),
    readSpendLines(admin, input.orgId, input.from, input.to, vehicleIds),
    readCarrier(admin, input.orgId),
    readUnitNumbers(admin, input.orgId, vehicleIds),
  ]);

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
  const exceptions = analyzePolicyExceptions(lines);

  const { doc, done } = newDrawing("FuelGuard — Fuel spend", { bufferPages: true });
  letterhead(
    doc,
    carrier,
    "Fuel spend report",
    `${input.from} to ${input.to}  ·  by ${input.grain}  ·  ` +
      (units.length === 0
        ? "whole fleet"
        : units.length <= 6
          ? `units ${units.join(", ")}`
          : `${units.length} units`),
  );

  drawHeadline(doc, overall, comparison);
  drawBridge(doc, comparison);
  drawIdle(doc, series, input.grain);
  drawSeries(doc, series, input.grain);
  drawExceptions(doc, exceptions, overall);

  const refused = days.reduce((a, d) => a + d.milesRejected, 0);
  stampFooters(
    doc,
    winAnsi(
      `FuelGuard · derived from recorded fills, odometer intervals and engine time · generated ${input.generatedAt.slice(0, 16).replace("T", " ")} UTC` +
        (refused > 0 ? ` · ${refused} odometer interval(s) refused as implausible` : ""),
    ),
  );
  doc.end();
  return { pdf: await done, periods: series.length, carrier };
}

// ── sections ────────────────────────────────────────────────────────────────────────────────────

function drawHeadline(
  doc: PDFKit.PDFDocument,
  overall: SpendPeriod,
  cmp: { prior: SpendPeriod; current: SpendPeriod } | null,
): void {
  const c = cmp?.current;
  const p = cmp?.prior;
  const kpis: Kpi[] = [
    { label: "Fuel spend", value: usd(c?.spend ?? overall.spend), ...change(p?.spend, c?.spend, true) },
    { label: "Gallons", value: num(c?.gallons ?? overall.gallons), ...change(p?.gallons, c?.gallons, true) },
    { label: "Paid / gal", value: usd3(c?.pricePerGal ?? overall.pricePerGal), ...change(p?.pricePerGal, c?.pricePerGal, true) },
    { label: "Cost / mile", value: usd2(c?.costPerMile ?? overall.costPerMile), ...change(p?.costPerMile, c?.costPerMile, true) },
    { label: "Fleet MPG", value: c?.mpg?.toFixed(2) ?? overall.mpg?.toFixed(2) ?? "-", ...change(p?.mpg, c?.mpg, false) },
  ];
  kpiRow(doc, kpis);
}

function drawBridge(doc: PDFKit.PDFDocument, cmp: { prior: SpendPeriod; current: SpendPeriod } | null): void {
  heading(doc, "Why spend moved");
  if (!cmp) {
    muted(doc, "Two complete periods are needed before a change can be explained against anything.");
    return;
  }
  const b = operatingBridge(cmp.prior, cmp.current);

  // The plain-English answer first. Somebody reads one sentence of a report and this is it.
  doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(
    winAnsi(
      `Tractor fuel went ${usd(cmp.prior.spend)} to ${usd(cmp.current.spend)}, a change of ${money(b.deltaSpend)}. ` +
        (b.volumeSplit
          ? `The fleet covered ${num(cmp.current.miles)} miles against ${num(cmp.prior.miles)}, at ${usd3(cmp.current.pricePerGal)} a gallon against ${usd3(cmp.prior.pricePerGal)}.`
          : ""),
    ),
    { width: CONTENT_WIDTH },
  );
  doc.moveDown(0.6);

  waterfall(doc, b.terms.map((t) => ({ label: t.label, dollars: t.dollars, detail: t.detail })), b.deltaSpend);

  if (b.volumeSplit) {
    const m = b.volumeSplit.milesFrom;
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(
      winAnsi(
        `Distance splits into ${num(m.trucks)} miles from running ${cmp.current.activeTrucks} trucks against ${cmp.prior.activeTrucks}, ` +
          `and ${num(m.perTruck)} miles from each covering ${num(cmp.current.milesPerTruck)} against ${num(cmp.prior.milesPerTruck)}. ` +
          `Components sum to the change exactly${b.tiesOut ? "" : " — RESIDUAL PRESENT, the decomposition is wrong"}.`,
      ),
      { width: CONTENT_WIDTH },
    );
  }
  if (b.withheld) {
    doc.moveDown(0.3);
    doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(7.5).text(winAnsi(b.withheld), { width: CONTENT_WIDTH });
  }
  doc.moveDown(0.4);
}

/**
 * Fuel burned standing still — on the fuel bill, because it is bought with the same gallons as the miles.
 *
 * Periods the engine feed did not cover are NAMED and left out rather than averaged in. Idle measured
 * across a gap reads as a fleet that stopped idling, and a document is exactly where that would be
 * believed.
 */
function drawIdle(doc: PDFKit.PDFDocument, series: SpendPeriod[], grain: SpendGrain): void {
  heading(doc, "Fuel burned standing still");
  const usable = series.filter((p) => p.idleUsable);
  const withheld = series.filter((p) => !p.idleUsable && p.idleCoverage != null);
  if (usable.length === 0) {
    muted(doc, "No period in this range had enough engine-feed coverage to measure idle against.");
    return;
  }
  const idleSec = usable.reduce((a, p) => a + p.idleSec, 0);
  const driveSec = usable.reduce((a, p) => a + p.driveSec, 0);
  const gallons = usable.reduce((a, p) => a + (p.idleGallons ?? 0), 0);
  const cost = usable.reduce((a, p) => a + (p.idleCost ?? 0), 0);
  const fuel = usable.reduce((a, p) => a + p.spend, 0);
  const share = idleSec + driveSec > 0 ? (idleSec / (idleSec + driveSec)) * 100 : 0;
  const perPeriod = cost / usable.length;
  const annual = perPeriod * (grain === "week" ? 52 : grain === "month" ? 12 : 365);

  doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(
    winAnsi(
      `The fleet idled ${num(idleSec / 3600)} hours across the ${usable.length} measured ${grain}(s) — ` +
        `${share.toFixed(1)}% of every hour an engine was running — burning ${num(gallons)} gallons worth ` +
        `${usd(cost)} at the prices actually paid, ${fuel > 0 ? ((cost / fuel) * 100).toFixed(1) : "0"}% of the fuel bill. ` +
        `At this rate that is ${usd(annual)} a year.`,
    ),
    { width: CONTENT_WIDTH },
  );
  doc.moveDown(0.4);
  body(
    doc,
    "Not all of this is waste — a driver resting in a sleeper through a summer night is idling for a reason. " +
      "The Idling page separates avoidable from unavoidable idle using each truck's confirmed APU equipment.",
    MUTED,
  );
  if (withheld.length > 0) {
    doc.moveDown(0.2);
    body(
      doc,
      `${withheld.length} ${grain}(s) are left out: the engine feed covered too little of those days to measure ` +
        "idle against, and idle measured across a gap in the feed reads as a fleet that stopped idling rather " +
        "than as a sync that stopped reporting. Their fuel is counted everywhere else in this report.",
      MUTED,
    );
  }
  doc.moveDown(0.3);
}

function drawSeries(doc: PDFKit.PDFDocument, series: SpendPeriod[], grain: SpendGrain): void {
  heading(doc, grain === "day" ? "Day by day" : grain === "month" ? "Month by month" : "Week by week");
  // Widths must sum to CONTENT_WIDTH (504pt) or less — `table` does not wrap or shrink them, it draws
  // past the right margin, which is how the idle column arrived clipped in half on the first render.
  const cols = [
    { width: 92, header: "Period" },
    { width: 40, header: "Trucks", align: "right" as const },
    { width: 56, header: "Gallons", align: "right" as const },
    { width: 68, header: "Fuel spend", align: "right" as const },
    { width: 52, header: "Paid / gal", align: "right" as const },
    { width: 58, header: "Miles", align: "right" as const },
    { width: 36, header: "MPG", align: "right" as const },
    { width: 52, header: "$ / mile", align: "right" as const },
    { width: 50, header: "Idle $", align: "right" as const },
  ];
  // Newest first, and a period still filling is kept but LABELLED. Dropping it hides the most recent
  // days from a reader looking for them; leaving it unmarked invites the comparison the bridge
  // deliberately refuses to make, which is how a one-day week reads as a collapse in spend.
  const rows = [...series].reverse().map((p) => [
    { text: periodLabel(p, grain), sub: p.partial ? "in progress" : undefined },
    { text: String(p.activeTrucks) },
    { text: num(p.gallons) },
    { text: usd(p.spend), bold: true },
    { text: usd3(p.pricePerGal) },
    { text: num(p.miles) },
    { text: p.mpg?.toFixed(2) ?? "—" },
    { text: usd2(p.costPerMile) },
    { text: p.idleCost == null ? "-" : usd(p.idleCost) },
  ]);
  table(doc, cols, rows);
}

function drawExceptions(doc: PDFKit.PDFDocument, ex: ReturnType<typeof analyzePolicyExceptions>, overall: SpendPeriod): void {
  heading(doc, "Where the fuel policy was not followed");
  const share = (g: number) => (overall.gallons > 0 ? `${((g / overall.gallons) * 100).toFixed(1)}%` : "—");
  const reports = [
    { name: "Avoided brands (ONE9 and other off-brand)", r: ex.avoidedBrands },
    { name: "California", r: ex.avoidedStates },
    { name: "Off the preferred network", r: ex.offNetwork },
  ];
  if (reports.every((x) => x.r.lines === 0)) {
    muted(doc, "No fills outside the fuel policy in this window.");
    return;
  }
  table(
    doc,
    [
      { width: 190, header: "Exception" },
      { width: 48, header: "Fills", align: "right" },
      { width: 66, header: "Gallons", align: "right" },
      { width: 52, header: "Share", align: "right" },
      { width: 74, header: "Spend", align: "right" },
      { width: 74, header: "Excess", align: "right" },
    ],
    reports.map((x) => [
      { text: x.name, sub: x.r.netPerGal != null ? `${usd3(x.r.netPerGal)}/gal against ${usd3(x.r.baselinePerGal)} elsewhere` : undefined },
      { text: String(x.r.lines) },
      { text: num(x.r.gallons) },
      { text: share(x.r.gallons) },
      { text: usd(x.r.spend) },
      { text: usd(x.r.excess), bold: true },
    ]),
  );
  body(
    doc,
    "Excess is what these gallons cost above what the rest of the fleet paid over the same period — not against a fixed price, which in a moving market invents a finding every time diesel rises.",
    MUTED,
  );
}

/** "2026-08-17 - 2026-08-23", or just the date when a clamped period covers a single day. */
function periodLabel(p: SpendPeriod, grain: SpendGrain): string {
  if (grain === "day" || p.from === p.to) return p.from;
  return `${p.from} - ${p.to}`;
}

// ── reads ───────────────────────────────────────────────────────────────────────────────────────

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

/** Fills with their brand, for the policy section. Same projection the page's feed source uses. */
async function readSpendLines(admin: SupabaseClient, orgId: string, from: string, to: string, vehicleIds: string[]): Promise<SpendLine[]> {
  const out: SpendLine[] = [];
  await eachPage<Record<string, unknown>>(
    (a, b) =>
      (() => {
        const q = admin.from("fuel_transactions")
          .select("fueled_at, state, gallons, total_cost, tank_type, location_text, fuel_stations(brand, store_number, city), vehicles(unit_number), drivers(full_name)")
          .eq("org_id", orgId)
          .gte("fueled_at", `${from}T00:00:00.000Z`).lte("fueled_at", `${to}T23:59:59.999Z`);
        return (vehicleIds.length > 0 ? q.in("vehicle_id", vehicleIds) : q)
          .order("fueled_at", { ascending: true }).range(a, b);
      })(),
    (rows) => {
      const one = <T,>(v: unknown): T | null => (Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null));
      for (const r of rows) {
        const st = one<{ brand: string | null; store_number: string | null; city: string | null }>(r.fuel_stations);
        out.push({
          tranDate: r.fueled_at ? String(r.fueled_at).slice(0, 10) : null,
          brand: st?.brand ?? null, state: r.state == null ? null : String(r.state),
          site: st?.store_number ?? null, city: st?.city ?? (r.location_text == null ? null : String(r.location_text)),
          unit: one<{ unit_number: string | null }>(r.vehicles)?.unit_number ?? null,
          driver: one<{ full_name: string | null }>(r.drivers)?.full_name ?? null,
          product: "diesel", tank: r.tank_type === "reefer" ? "reefer" : "tractor",
          gallons: r.gallons == null ? 0 : Number(r.gallons) || 0,
          netAmount: r.total_cost == null ? null : Number(r.total_cost),
          retailAmount: null,
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

async function readCarrier(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? "Carrier";
}
