/**
 * The Fuel Costs report as a document (FS-PDF, Q-FSV14 option a, owner 2026-10-03).
 *
 * ── WHY THIS IS NOT `renderFuelSpendReport` ──────────────────────────────────────────────────────
 * The older document is rendered from `fuel_spend_days` for a weekly series and compares the last two
 * complete buckets; it takes dates, grain and trucks and nothing else. The Fuel Costs screen compares the
 * whole selected window with the equal-length window before it and filters by state, location and network
 * too. Both sat behind a button called "Export report", so a filtered screen exported a wider, differently
 * compared document (design verdict 2026-10-03, E6). This one is rendered from the SAME `readFuelReport`
 * the screen reads and prints the strings the screen prints: the cards (`costCards`), the day rows
 * (`costDayCells`), and the sentences (`spendChangeLine`, `comparingLine`, `mpgCoverageLine`, `networkLine`, `reeferLine`),
 * all from `@silvicom/shared`. It has no arithmetic of its own, so it cannot disagree with the page.
 *
 * ── WHAT IT SAYS ABOUT ITS SCOPE ─────────────────────────────────────────────────────────────────
 * Every filter that narrowed the figures is on the letterhead. The old document's lesson (see
 * `letterhead`): a report that covers every truck while the screen showed three cannot be reconciled later.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FUEL_REPORT_TRUCK_FIGURES_NOTE,
  STATE_NAMES,
  comparingLine,
  costCards,
  costDayCells,
  costDayHeaders,
  costDayRows,
  formatDisplayDate,
  mpgCoverageLine,
  networkLine,
  reeferLine,
  spendChangeLine,
  type FuelNetwork,
  type FuelReport,
} from "@silvicom/shared";
import { newDrawing, winAnsi } from "../../lib/pdfDraw.js";
import { letterhead, note, sectionHead, stampPages, verdictBand, withheld } from "./fuelSpendReportDraw.js";
import { figureTable, type Column, type Row } from "./fuelSpendReportTable.js";
import { GEOM } from "./fuelSpendReportTheme.js";
import { readFuelReport, type FuelReportFilterArgs } from "./fuelReport.js";
import { readCarrier } from "./fuelSpendReport.js";

const NETWORK_LABEL: Record<FuelNetwork, string> = { in: "In network", out: "Out of network", unknown: "Station not identified" };
const CONTENT_W = GEOM.pageWidth - GEOM.margin * 2;

/** The filters, as the letterhead's scope fields — what the figures are NOT the whole fleet's because of. */
export function scopeFields(f: FuelReportFilterArgs): { label: string; value: string }[] {
  const trucks = f.vehicleIds.length === 0 ? "All trucks" : `${f.vehicleIds.length} truck${f.vehicleIds.length === 1 ? "" : "s"}`;
  const stations = [
    f.states.length ? f.states.map((s) => STATE_NAMES[s] ?? s).join(", ") : null,
    f.siteIds.length ? `${f.siteIds.length} location${f.siteIds.length === 1 ? "" : "s"}` : null,
    f.networks.length ? f.networks.map((n) => NETWORK_LABEL[n]).join(", ") : null,
  ].filter(Boolean);
  return [
    { label: "Trucks", value: trucks },
    { label: "Stations", value: stations.length ? stations.join(" · ") : "All stations" },
  ];
}

/** The card table's columns: the figure, this range, how it moved, and the previous range's own figure. */
export const CARD_COLUMNS: Column[] = [
  { width: 118, header: "Figure" },
  { width: 74, header: "This range", align: "right" },
  { width: 176, header: "Change" },
  { width: 136, header: "Previous range" },
];

/**
 * Day columns, widths summing to the content width; the MPG column exists only when the screen's does.
 * The values are short ("$850") and the labels are the screen's own, so the labels wrap (`wrapHeader`) rather
 * than being abbreviated for the page. The day column fits "09/30/2026" at the table's body size.
 */
export function dayColumns(withMpg: boolean): Column[] {
  const heads = costDayHeaders(withMpg);
  const widths = withMpg ? [64, 32, 50, 52, 54, 52, 66, 44, 90] : [78, 40, 56, 66, 66, 66, 70, 62];
  return heads.map((header, i) => ({ width: widths[i]!, header, wrapHeader: true, ...(i === 0 ? {} : { align: "right" as const }) }));
}

export function composeCostsReport(
  report: FuelReport,
  o: { carrier: string; filters: FuelReportFilterArgs; generatedAt: string },
): Promise<{ pdf: Buffer; pages: number }> {
  const { doc, done } = newDrawing("Silvicom 360 — Fuel costs", { bufferPages: true });
  const cards = costCards(report);
  const withMpg = report.current.efficiency != null;
  const spend = cards.find((c) => c.key === "spend");

  letterhead(doc, o.carrier, "Fuel costs", comparingLine(report), [
    { label: "Period", value: `${formatDisplayDate(report.current.from)} to ${formatDisplayDate(report.current.to)}` },
    ...scopeFields(o.filters),
  ]);
  // The band leads the way the screen does: spend, then how much of its change was gallons and how much price.
  if (spend) verdictBand(doc, `Fuel spend ${spend.value}`, spendChangeLine(report));

  sectionHead(doc, 1, "The figures", "Tractor fuel, this range against the same number of days just before.");
  const cardRows: Row[] = cards.map((c) => ({ cells: [{ text: c.label, bold: true }, { text: c.value, bold: true }, { text: c.sub }, { text: c.previous }] }));
  figureTable(doc, CARD_COLUMNS, cardRows);

  const lines = [networkLine(report), reeferLine(report.current), withMpg ? mpgCoverageLine(report) : null].filter((x): x is string => !!x);
  for (const l of lines) note(doc, l);
  // Under a station filter the page replaces miles, MPG and cost per mile with the API's sentence; so do we.
  if (!withMpg) withheld(doc, FUEL_REPORT_TRUCK_FIGURES_NOTE);

  sectionHead(doc, 2, "By day", "Newest first. MPG is the trailing seven days ending that day.");
  const dayRows: Row[] = costDayRows(report).map((r) => ({ cells: costDayCells(r).map((text) => ({ text })) }));
  figureTable(doc, dayColumns(withMpg), dayRows);

  const pages = doc.bufferedPageRange().count;
  stampPages(
    doc,
    winAnsi(`${o.carrier} · Fuel costs · ${formatDisplayDate(report.current.from)} to ${formatDisplayDate(report.current.to)}`),
    winAnsi(`Silvicom 360 · the figures on the Fuel Costs screen, for the same filters · generated ${o.generatedAt.slice(0, 16).replace("T", " ")} UTC`),
  );
  doc.end();
  return done.then((pdf) => ({ pdf, pages }));
}

export async function renderFuelCostsReport(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
  filters: FuelReportFilterArgs,
  generatedAt: string,
): Promise<{ pdf: Buffer; pages: number }> {
  const [report, carrier] = await Promise.all([readFuelReport(admin, orgId, from, to, filters), readCarrier(admin, orgId)]);
  return composeCostsReport(report, { carrier, filters, generatedAt });
}

export { CONTENT_W as COSTS_REPORT_CONTENT_W };
