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
  const [days, lines, carrier] = await Promise.all([
    readSpendDays(admin, input.orgId, input.from, input.to),
    readSpendLines(admin, input.orgId, input.from, input.to),
    readCarrier(admin, input.orgId),
  ]);

  const series = spendSeries(days, input.grain);
  const overall = periodTotals(days, input.from, input.to);
  // NOT `includePartial`. The newest bucket is normally still filling, and comparing a one-day week
  // against a finished one made the first render of this report announce spend down 88% and a $271,841
  // saving from "miles driven" — a collapse that never happened, in a document meant to be forwarded.
  const comparison = comparablePeriods(series, input.to);
  const exceptions = analyzePolicyExceptions(lines);

  const { doc, done } = newDrawing("FuelGuard — Fuel spend", { bufferPages: true });
  letterhead(doc, carrier, "Fuel spend report", `${input.from} to ${input.to}  ·  by ${input.grain}`);

  drawHeadline(doc, overall, comparison);
  drawBridge(doc, comparison);
  drawSeries(doc, series, input.grain, input.to);
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

function drawSeries(doc: PDFKit.PDFDocument, series: SpendPeriod[], grain: SpendGrain, today: string): void {
  heading(doc, grain === "day" ? "Day by day" : grain === "month" ? "Month by month" : "Week by week");
  const cols = [
    { width: 96, header: "Period" },
    { width: 46, header: "Trucks", align: "right" as const },
    { width: 60, header: "Gallons", align: "right" as const },
    { width: 74, header: "Fuel spend", align: "right" as const },
    { width: 58, header: "Paid / gal", align: "right" as const },
    { width: 62, header: "Miles", align: "right" as const },
    { width: 42, header: "MPG", align: "right" as const },
    { width: 66, header: "Cost / mile", align: "right" as const },
  ];
  // A period still filling is kept but LABELLED. Dropping it hides the most recent days from a reader
  // looking for them; leaving it unmarked invites the comparison the bridge deliberately refuses to
  // make, which is how a one-day week reads as a collapse in spend.
  const rows = [...series].reverse().map((p) => [
    { text: grain === "day" ? p.from : `${p.from} - ${p.to}`, sub: p.to >= today ? "in progress" : undefined },
    { text: String(p.activeTrucks) },
    { text: num(p.gallons) },
    { text: usd(p.spend), bold: true },
    { text: usd3(p.pricePerGal) },
    { text: num(p.miles) },
    { text: p.mpg?.toFixed(2) ?? "—" },
    { text: usd2(p.costPerMile) },
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

// ── reads ───────────────────────────────────────────────────────────────────────────────────────

async function readSpendDays(admin: SupabaseClient, orgId: string, from: string, to: string): Promise<SpendDay[]> {
  const out: SpendDay[] = [];
  await eachPage<Record<string, unknown>>(
    (a, b) =>
      admin.from("fuel_spend_days")
        .select("day, vehicle_id, fills, gallons_tractor, gallons_reefer, gallons_def, spend_tractor, spend_reefer, spend_def, miles, mpg_gallons, miles_rejected, drive_sec, idle_sec, off_sec, coverage_sec")
        .eq("org_id", orgId).gte("day", from).lte("day", to)
        .order("day", { ascending: true }).range(a, b),
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
async function readSpendLines(admin: SupabaseClient, orgId: string, from: string, to: string): Promise<SpendLine[]> {
  const out: SpendLine[] = [];
  await eachPage<Record<string, unknown>>(
    (a, b) =>
      admin.from("fuel_transactions")
        .select("fueled_at, state, gallons, total_cost, tank_type, location_text, fuel_stations(brand, store_number, city), vehicles(unit_number), drivers(full_name)")
        .eq("org_id", orgId)
        .gte("fueled_at", `${from}T00:00:00.000Z`).lte("fueled_at", `${to}T23:59:59.999Z`)
        .order("fueled_at", { ascending: true }).range(a, b),
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

async function readCarrier(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? "Carrier";
}
