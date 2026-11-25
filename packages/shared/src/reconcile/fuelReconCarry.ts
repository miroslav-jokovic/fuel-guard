/**
 * The invoice check CARRIES FORWARD what an earlier week left open — pure decisions, no I/O.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────
 * A weekly check reads its own billing week and nothing else, and `sync_fuel_exceptions` (0320) closes only
 * findings inside that week. Measured on production 2026-11-25 (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §5),
 * that leaves three things no later check can fix:
 *
 *   1. A fill Pilot bills a week LATE. Week 1 files "in our records, not on Pilot's bill"; week 2's invoice
 *      carries the line, but week 2 never revisits week 1's finding. 89 such findings were open.
 *   2. A fill we record LATE (an EFS post that lands after the check). Its "on Pilot's bill, not in our
 *      records" finding sits in a week no later check reads.
 *   3. A fill billed on ANOTHER week's invoice. It is in our records and in this week's window, so this week
 *      calls it unbilled, though another invoice already matched it.
 *
 * The API reads the evidence (`apps/api/src/modules/fuel-spend/fuelReconCarry.ts`), these functions decide,
 * and `close_fuel_exceptions` (0647) closes the findings with the reason as the event's note, so a finding's
 * history says WHY it closed, not merely that it did.
 */
import { fuelExceptionFingerprint } from "../fuelSpend/exceptions.js";
import { DEFAULT_TOLERANCES, reconcileFuelReport, type ReconResult, type ReconRow, type ReconTolerances, type SystemFill } from "./fuelMatch.js";
import type { PilotReportFill } from "./pilotFuelReport.js";

/** How far back a late line or an open finding is still looked for. Two billing months, and a bound on the read. */
export const CARRY_LOOKBACK_DAYS = 60;

const shift = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Which of our fills to read for a check: the billing week, widened to every line's own date, so a line
 * billed late or early can still be matched to its fill. Widening the READ never widens the WINDOW: only a
 * fill dated inside the window can be called unbilled (`reconcileFuelReport`'s `window`). A stray line dated
 * further back than the lookback does not drag a year of fills into memory; it is left unmatched.
 */
export function reconReadRange(
  window: { from: string; to: string },
  lineDates: readonly (string | null)[],
): { from: string; to: string } {
  const floor = shift(window.from, -CARRY_LOOKBACK_DAYS);
  const ceiling = shift(window.to, CARRY_LOOKBACK_DAYS);
  let from = window.from;
  let to = window.to;
  for (const d of lineDates) {
    if (!d || d < floor || d > ceiling) continue;
    if (d < from) from = d;
    if (d > to) to = d;
  }
  return { from, to };
}

/** The fills a saved check matched to a line — what "already billed on that invoice" means. */
export function matchedFillIds(rows: readonly Pick<ReconRow, "report" | "system">[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) if (r.report && r.system?.id) out.add(r.system.id);
  return out;
}

/**
 * Case 1, a fill billed late: it matched a line on THIS invoice but is dated outside this invoice's week, so
 * the week it belongs to filed it as unbilled. Its finding's fingerprint is our own fill id (`reconFindings`).
 * A fill inside the week needs nothing from here — `sync_fuel_exceptions` already closes what this run no
 * longer finds there.
 */
export function billedLateFingerprints(result: ReconResult, window: { from: string; to: string }): string[] {
  const out: string[] = [];
  for (const r of result.rows) {
    const d = r.system?.tranDate;
    if (!r.report || !r.system || !d) continue;
    if (d >= window.from && d <= window.to) continue;
    out.push(fuelExceptionFingerprint("recon_missing_on_report", [r.system.id]));
  }
  return out;
}

/** An open "on Pilot's bill, not in our records" finding, as the ledger keeps it. */
export interface OpenUnrecordedFinding {
  fingerprint: string;
  occurredOn: string | null;
  evidence: {
    billedGallons?: unknown;
    billedAmount?: unknown;
    card?: unknown;
    productCode?: unknown;
  } | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/**
 * Case 2, a fill recorded late: re-run the matcher with each open finding's billed line rebuilt from its
 * evidence, against fills recorded since.
 *
 * Stricter than a weekly check on purpose, because this CLOSES something without a person looking: the card
 * must agree (six or four digits — never a date-and-gallons guess), and gallons and amount must both sit
 * inside the tolerances. A drifted or disagreeing match leaves the finding open for somebody, which is the
 * safe way to be wrong. `fills` must already exclude every fill another check matched, so one fill cannot
 * close two findings or close one it was billed against elsewhere.
 */
export function matchLateRecorded(
  findings: readonly OpenUnrecordedFinding[],
  fills: readonly SystemFill[],
  opts: { tolerances?: ReconTolerances; maxDayDrift?: number } = {},
): Array<{ fingerprint: string; transactionId: string }> {
  const tol = opts.tolerances ?? DEFAULT_TOLERANCES;
  const lines: PilotReportFill[] = [];
  const fingerprintOf = new Map<PilotReportFill, string>();
  findings.forEach((f, i) => {
    const gallons = num(f.evidence?.billedGallons);
    const code = str(f.evidence?.productCode);
    if (!f.occurredOn || gallons == null || gallons <= 0 || !code) return;
    const line: PilotReportFill = {
      authNo: null, unit: null, cardRef: str(f.evidence?.card), site: null, city: null, state: null,
      gallons, netAmount: num(f.evidence?.billedAmount), retailAmount: null,
      tranDate: f.occurredOn, time: null, product: "diesel", productCode: code, productDescription: null,
      rowNumber: i + 1,
    };
    lines.push(line);
    fingerprintOf.set(line, f.fingerprint);
  });
  if (lines.length === 0 || fills.length === 0) return [];

  // No window: nothing here may be called unbilled, so the matcher's own `missing_on_report` rows are ignored.
  const result = reconcileFuelReport(lines, fills, { tolerances: tol, window: null, maxDayDrift: opts.maxDayDrift ?? 1 });
  const out: Array<{ fingerprint: string; transactionId: string }> = [];
  for (const r of result.rows) {
    if (!r.report || !r.system) continue;
    if (r.basis !== "card6" && r.basis !== "card4") continue;
    if (r.gallonsDelta == null || Math.abs(r.gallonsDelta) > tol.gallons) continue;
    if (r.amountDelta != null) {
      const allowed = Math.max(tol.amountAbs, Math.abs(r.system.totalCost ?? 0) * tol.amountPct);
      if (Math.abs(r.amountDelta) > allowed) continue;
    }
    const fp = fingerprintOf.get(r.report);
    if (fp) out.push({ fingerprint: fp, transactionId: r.system.id });
  }
  return out;
}

/** The note each close carries, worded for the person reading the finding's history. */
export const CARRY_NOTES = {
  billedLate: (invoiceNo: string | null) => `Billed on invoice ${invoiceNo ?? "(no number)"}.`,
  recordedLate: () => "Our record of this fill arrived later.",
  recheckDropped: (invoiceNo: string | null) => `Re-checking invoice ${invoiceNo ?? "(no number)"} no longer found this.`,
} as const;
