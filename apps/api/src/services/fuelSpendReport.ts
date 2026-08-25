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
  analyzeDiscountCapture,
  analyzePolicyExceptions,
  comparablePeriods,
  periodTotals,
  spendSeries,
  type SpendDay,
  type SpendGrain,
  type SpendLine,
} from "@fuelguard/shared";
import { eachPage } from "../lib/paging.js";
import { newDrawing, winAnsi } from "./dqBinder/pdfDraw.js";
import { letterhead, stampFooters } from "./fuelSpendReportDraw.js";
import { drawBridge, drawDiscount, drawExceptions, drawHeadline, drawIdle, drawSeries } from "./fuelSpendReportSections.js";
import { readFleetIdleVerdict } from "./fuelIdleVerdict.js";

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
): Promise<{ pdf: Buffer; periods: number; carrier: string }> {
  const vehicleIds = input.vehicleIds ?? [];
  const [days, lines, carrier, units, idle] = await Promise.all([
    readSpendDays(admin, input.orgId, input.from, input.to, vehicleIds),
    readSpendLines(admin, input.from, input.to, vehicleIds),
    readCarrier(admin, input.orgId),
    readUnitNumbers(admin, input.orgId, vehicleIds),
    // The real verdict — equipment flags, HOS duty overlay, temperature envelope — not idle seconds
    // times a burn rate. Fleet-wide: the truck filter narrows FUEL, and an idle figure for three
    // trucks against a fleet-wide baseline would be the more misleading of the two options.
    readFleetIdleVerdict(admin, input.orgId, input.from, input.to),
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
  drawSeries(doc, series, input.grain);
  drawDiscount(doc, analyzeDiscountCapture(lines), lines);
  drawExceptions(doc, exceptions, overall);
  drawIdle(doc, series, input.grain, idle);

  const refused = days.reduce((a: number, d: SpendDay) => a + d.milesRejected, 0);
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

/**
 * Fills with their brand AND the posted price that applied that day, through `fuel_spend_lines` (0246).
 *
 * ⚠ This used to be a direct query that hard-coded `retailAmount: null`, matching what the feed alone
 * can supply. When the page moved onto the joined function this did not, so the document kept saying
 * "no fill could be matched to a posted price" while the screen beside it measured 1,201 of them. Page
 * and report must read the same source or they will disagree exactly like that.
 */
// `fuel_spend_lines` scopes itself: it is security-invoker over org-scoped tables, and the service
// role reaches it with the org already established by the caller.
async function readSpendLines(admin: SupabaseClient, from: string, to: string, vehicleIds: string[]): Promise<SpendLine[]> {
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
          // Null when no report covered that station that day — never 0, which would read as a fill
          // that captured no discount at all.
          retailAmount: r.retail_amount == null ? null : n(r.retail_amount),
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
