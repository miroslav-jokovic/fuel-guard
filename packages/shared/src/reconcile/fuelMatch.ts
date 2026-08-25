/**
 * Reconcile a Pilot fuel report against the fills we recorded — line by line, deterministically.
 *
 * Split out of `pilotFuelReport.ts` (F4), which now holds only the grid parser. This file holds the
 * question the page is named after: does the vendor's bill agree with our own record of the same week.
 *
 * ── THERE IS NO EXACT KEY, AND THAT IS MEASURED RATHER THAN ASSUMED ─────────────────────────────
 * The obvious design is to join on the vendor's transaction id. It does not exist. Measured 2026-08-25
 * against production, over the five real statements (3,919 lines) and the 4,634 `efs_transactions`
 * rows covering the same window:
 *
 *     statement `ticket` (9 digits)  → efs.invoice, zero-padded      0 of 2,283
 *     statement `ticket`             → efs.invoice, zeros stripped   0 of 2,283
 *     statement `authNo` (6 digits)  → efs.invoice                   0 of 1,511
 *     statement card (6 digits)      → last 6 of efs.card_num    171 of 171   (100%)
 *
 * Pilot's ticket and authorization numbers are Pilot's; EFS's invoice is EFS's. They name the same
 * physical fill and share no value. So this is a heuristic matcher on purpose, and its job is to be
 * *honest about which fills it is confident in* rather than to pretend to a key it does not have.
 *
 * ── THE CARD IS SIX DIGITS, NOT FOUR (D-FR6) ────────────────────────────────────────────────────
 * The statement prints the last SIX of the EFS PAN (`7083050030490367971` → `367971`). The old matcher
 * used four. Measured on the same window, across the 171 cards actually in use:
 *
 *     39 last-4 groups collide, covering 121 of 171 cards (71%)
 *     460 of 1,769 (business day, last-4) buckets hold MORE THAN ONE physical card — one holds five
 *     last-6 collisions: none
 *
 * Each of those 460 buckets is a place a last-4 key can pair a report line against a different truck's
 * fill and call it clean. Six digits removes all of them, and four survives only as a labelled weaker
 * fallback for a report that does not print six.
 *
 * ── WHY MATCHING IS COST-ORDERED AND NOT FIRST-COME (L5) ────────────────────────────────────────
 * The old matcher walked report rows in file order and took the closest unconsumed fill for each. With
 * two fills on one card and day — a split fill, a top-off, a tractor and a reefer on one swipe — the
 * first row could take the second row's fill, mis-flagging both. Worse, the answer depended on the
 * ORDER OF THE FILE: re-exporting the same month with rows sorted differently produced a different
 * reconciliation, which is not a property a document sent to a vendor may have.
 *
 * Candidate pairs are therefore scored, sorted by cost, and consumed cheapest-first across the whole
 * bucket. That is order-independent by construction: the input order cannot influence the sort, so the
 * same rows in any order produce the same pairing. It is a cost-ordered greedy rather than a full
 * optimal assignment, which is a deliberate trade — buckets here hold one to five rows, where the two
 * agree, and an O(n!) search would buy nothing measurable at the cost of a much harder file to read.
 *
 * ── UNKNOWN IS NOT DISAGREEMENT (L4) ────────────────────────────────────────────────────────────
 * A fill with no recorded cost used to be classified `amount_mismatch` with a null delta: an amount
 * mismatch worth $0.00. Unknown and disagreeing are opposite findings and are reported apart.
 *
 * ── FOUR EXPOSURES, NEVER THEIR SUM (D-FX5) ─────────────────────────────────────────────────────
 * The old summary had one figure, `dollarsAtStake`, which added the absolute amount deltas, the full
 * value of report lines we never recorded, and the full value of fills the vendor never billed. Those
 * are three different kinds of money — recoverable, owed, and unexplained — and adding them produces a
 * number that means nothing and is always too big. They are reported apart and nothing here sums them.
 */
import { classifyPilotProduct, isMatchableFuel, type ReportTank } from "./fuelProducts.js";
import type { PilotReportFill } from "./pilotFuelReport.js";

/** One recorded fill from `fuel_transactions`, projected to the fields a reconciliation needs. */
export interface SystemFill {
  id: string;
  cardRef: string | null;
  controlId: string | null;
  unit: string | null;
  fueledAt: string | null;
  /** Station-local business date, YYYY-MM-DD. */
  tranDate: string | null;
  /** Which tank this fill went into — reefer fuel is never matched against a tractor line. */
  tank: ReportTank;
  gallons: number;
  totalCost: number | null;
}

export interface ReconTolerances {
  gallons: number;
  amountAbs: number;
  amountPct: number;
}
export const DEFAULT_TOLERANCES: ReconTolerances = { gallons: 1.0, amountAbs: 1.0, amountPct: 0.01 };

export type ReconStatus =
  | "clean"
  | "amount_mismatch"
  | "gallon_mismatch"
  | "amount_unknown"
  | "date_drift"
  | "card_drift"
  | "missing_in_system"
  | "missing_on_report"
  | "other";

/** Machine token → the words a reader sees. No `.vue` file may carry a status literal. */
export const RECON_STATUS_LABELS: Record<ReconStatus, string> = {
  clean: "Matched",
  amount_mismatch: "Amount differs",
  gallon_mismatch: "Gallons differ",
  amount_unknown: "Amount not recorded",
  date_drift: "Matched, dated a day apart",
  card_drift: "Matched, different card",
  missing_in_system: "Billed, never recorded",
  missing_on_report: "Recorded, never billed",
  other: "Needs a look",
};

/** Which key placed a row — a claim's strength is part of the claim. */
export type MatchBasis = "card6" | "card4" | "date_gallons" | null;

export interface ReconRow {
  status: ReconStatus;
  report: PilotReportFill | null;
  system: SystemFill | null;
  tank: ReportTank;
  /** report − system. */
  gallonsDelta: number | null;
  amountDelta: number | null;
  basis: MatchBasis;
  /** report − system, in days. 0 unless `date_drift`. */
  dayDelta: number | null;
  note: string | null;
}

/**
 * The four kinds of money, apart. Each is a positive magnitude with its own line count; no field here
 * is the sum of any other, and nothing in this module adds them.
 */
export interface ReconExposure {
  /** Billed above what we recorded — the recoverable side. */
  overbilled: number;
  overbilledLines: number;
  /** Billed below what we recorded — money we may still owe. */
  underbilled: number;
  underbilledLines: number;
  /** Recorded by us and never billed. Not recoverable; an unbilled liability or a mis-recorded fill. */
  unbilled: number;
  unbilledLines: number;
  /** Billed and never recorded. The fuel-theft surface, and the reason this page exists. */
  unrecorded: number;
  unrecordedLines: number;
}

export interface ReconSummary {
  reportLines: number;
  systemFills: number;
  clean: number;
  amountMismatch: number;
  gallonMismatch: number;
  amountUnknown: number;
  dateDrift: number;
  cardDrift: number;
  missingInSystem: number;
  missingOnReport: number;
  other: number;
  /** How many matches each key placed — a strong claim and a weak one, told apart. */
  matchedOnCard6: number;
  matchedOnCard4: number;
  matchedOnDateGallons: number;
  exposure: ReconExposure;
}

export interface ReconResult {
  rows: ReconRow[];
  summary: ReconSummary;
  /** Report lines excluded from matching because nothing on our side can hold them (DEF, in-store). */
  unmatchable: PilotReportFill[];
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
const digits = (s: string | null | undefined): string => String(s ?? "").replace(/\D/g, "");
const lastN = (s: string | null | undefined, n: number): string | null => {
  const d = digits(s);
  return d.length >= n ? d.slice(-n) : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Days between two YYYY-MM-DD dates, or null if either is missing. */
function dayGap(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

const shiftDay = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Within tolerance. Returns `null` — not `false` — when either side is unknown, so a caller can tell
 * "these disagree" from "we cannot say" (L4).
 */
function within(a: number | null, b: number | null, absTol: number, pctTol = 0): boolean | null {
  if (a == null || b == null) return null;
  const d = Math.abs(a - b);
  return d <= absTol || (pctTol > 0 && d <= Math.abs(b) * pctTol);
}

interface Candidate {
  ri: number;
  si: number;
  /** Lower is better. Ordered lexicographically: gallons first, then dollars. */
  gallonCost: number;
  amountCost: number;
  basis: Exclude<MatchBasis, null>;
  dayDelta: number;
}

/** Deterministic ordering: cost, then the report line's own row number, then the system id. */
function compareCandidates(a: Candidate, b: Candidate, report: PilotReportFill[], system: SystemFill[]): number {
  // A same-day match always beats a drifted one, whatever the gallons say.
  if (Math.abs(a.dayDelta) !== Math.abs(b.dayDelta)) return Math.abs(a.dayDelta) - Math.abs(b.dayDelta);
  const basisRank = { card6: 0, card4: 1, date_gallons: 2 } as const;
  if (basisRank[a.basis] !== basisRank[b.basis]) return basisRank[a.basis] - basisRank[b.basis];
  if (a.gallonCost !== b.gallonCost) return a.gallonCost - b.gallonCost;
  if (a.amountCost !== b.amountCost) return a.amountCost - b.amountCost;
  // Ties broken on stable identity, never on input order — this is what makes a shuffle a no-op.
  const rn = report[a.ri]!.rowNumber - report[b.ri]!.rowNumber;
  if (rn !== 0) return rn;
  return system[a.si]!.id < system[b.si]!.id ? -1 : 1;
}

export interface ReconOptions {
  tolerances?: ReconTolerances;
  /**
   * The report's DECLARED window, which is what decides whether one of our fills should have appeared
   * on it (L6). The old matcher used the min and max date of the fills it happened to find, so a fill
   * on a day the fleet bought nothing was silently dropped from `missing_on_report` instead of flagged.
   */
  window?: { from: string; to: string } | null;
  /** How many days either side a drifted match may sit. One, and deliberately not two (D-FX4). */
  maxDayDrift?: number;
}

export function reconcileFuelReport(
  reportIn: readonly PilotReportFill[],
  systemIn: readonly SystemFill[],
  opts: ReconOptions = {},
): ReconResult {
  const tol = opts.tolerances ?? DEFAULT_TOLERANCES;
  const maxDrift = opts.maxDayDrift ?? 1;

  // Split the report by what our own records can even hold. `fuel_transactions` carries no DEF at all
  // (it arrives on `efs_transactions` as item DEFD), and in-store merchandise is not a fill, so neither
  // may be scored as "billed and never recorded" — they are set aside and reported.
  const matchable: PilotReportFill[] = [];
  const unmatchable: PilotReportFill[] = [];
  const tankOf = new Map<PilotReportFill, ReportTank>();
  for (const f of reportIn) {
    const p = classifyPilotProduct(f.productCode ?? null, f.productDescription ?? null);
    if (isMatchableFuel(p) && f.gallons > 0) {
      matchable.push(f);
      tankOf.set(f, p.tank);
    } else {
      unmatchable.push(f);
    }
  }

  // Canonical order in, so nothing downstream can depend on how the file was sorted.
  const report = [...matchable].sort((a, b) => a.rowNumber - b.rowNumber);
  const system = [...systemIn].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // ── build every plausible pair, then take them cheapest-first ────────────────────────────────
  const candidates: Candidate[] = [];
  for (let ri = 0; ri < report.length; ri++) {
    const f = report[ri]!;
    const tank = tankOf.get(f)!;
    if (!f.tranDate) continue;
    const r6 = lastN(f.cardRef, 6);
    const r4 = lastN(f.cardRef, 4);
    for (let si = 0; si < system.length; si++) {
      const s = system[si]!;
      // Reefer fuel is never paired with a tractor fill: dyed off-road diesel bought under different
      // terms, and conflating them is what made the tractor MPG and capacity checks wrong (0029).
      if (s.tank !== tank || !s.tranDate) continue;
      const gap = dayGap(f.tranDate, s.tranDate);
      if (gap == null || Math.abs(gap) > maxDrift) continue;

      const s6 = lastN(s.cardRef, 6);
      const s4 = lastN(s.cardRef, 4);
      let basis: Exclude<MatchBasis, null> | null = null;
      if (r6 && s6 && r6 === s6) basis = "card6";
      else if (r4 && s4 && r4 === s4) basis = "card4";
      // A card-less line is NEVER bucketed with other card-less lines (L9): `lastN` returns null and
      // null never equals null here. It may still be placed on date and gallons, labelled as such.
      else if (within(f.gallons, s.gallons, Math.max(tol.gallons, 2))) basis = "date_gallons";
      if (!basis) continue;

      candidates.push({
        ri, si, basis, dayDelta: gap,
        gallonCost: Math.abs(f.gallons - s.gallons),
        amountCost: f.netAmount != null && s.totalCost != null ? Math.abs(f.netAmount - s.totalCost) : Number.MAX_SAFE_INTEGER,
      });
    }
  }
  candidates.sort((a, b) => compareCandidates(a, b, report, system));

  const takenReport = new Set<number>();
  const takenSystem = new Set<number>();
  const rows: ReconRow[] = [];

  for (const c of candidates) {
    if (takenReport.has(c.ri) || takenSystem.has(c.si)) continue;
    takenReport.add(c.ri);
    takenSystem.add(c.si);
    const f = report[c.ri]!;
    const s = system[c.si]!;
    rows.push(classify(f, s, tankOf.get(f)!, c, tol));
  }

  // ── what nothing could be paired with ───────────────────────────────────────────────────────
  for (let ri = 0; ri < report.length; ri++) {
    if (takenReport.has(ri)) continue;
    const f = report[ri]!;
    rows.push({
      status: "missing_in_system", report: f, system: null, tank: tankOf.get(f)!,
      gallonsDelta: null, amountDelta: null, basis: null, dayDelta: null,
      note: "On the report; no matching fill recorded.",
    });
  }

  // The report's DECLARED window decides this, not the dates its fills happen to span (L6).
  const from = opts.window?.from ?? null;
  const to = opts.window?.to ?? null;
  const inWindow = (d: string | null): boolean => {
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };
  for (let si = 0; si < system.length; si++) {
    if (takenSystem.has(si)) continue;
    const s = system[si]!;
    if (!inWindow(s.tranDate)) continue;
    rows.push({
      status: "missing_on_report", report: null, system: s, tank: s.tank,
      gallonsDelta: null, amountDelta: null, basis: null, dayDelta: null,
      note: "Recorded fill with no matching report line.",
    });
  }

  return { rows, summary: summarise(rows, report.length, system.filter((s) => inWindow(s.tranDate)).length), unmatchable };
}

function classify(
  f: PilotReportFill,
  s: SystemFill,
  tank: ReportTank,
  c: Candidate,
  tol: ReconTolerances,
): ReconRow {
  const gDelta = f.gallons - s.gallons;
  const aDelta = f.netAmount != null && s.totalCost != null ? r2(f.netAmount - s.totalCost) : null;
  const gOk = within(f.gallons, s.gallons, tol.gallons);
  const aOk = within(f.netAmount, s.totalCost, tol.amountAbs, tol.amountPct);
  const base = {
    report: f, system: s, tank, gallonsDelta: r2(gDelta), amountDelta: aDelta,
    basis: c.basis as MatchBasis, dayDelta: c.dayDelta,
  };

  // Ordered by what a reader most needs to know first. A drifted or card-drifted match is reported as
  // such even when the figures agree, because HOW it was placed qualifies the claim that it agrees.
  if (c.dayDelta !== 0) {
    return {
      ...base, status: "date_drift",
      note: `Matched to a fill dated ${Math.abs(c.dayDelta)} day${Math.abs(c.dayDelta) === 1 ? "" : "s"} ${c.dayDelta > 0 ? "earlier" : "later"} in our records.`,
    };
  }
  if (c.basis === "date_gallons") {
    return { ...base, status: "card_drift", note: "Matched on date and gallons; the card numbers differ." };
  }
  // Unknown is not disagreement (L4).
  if (aOk == null) {
    return { ...base, status: "amount_unknown", note: "No amount recorded for this fill, so the billing cannot be checked." };
  }
  if (gOk === true && aOk) return { ...base, status: "clean", note: null };
  if (gOk !== true && aOk) return { ...base, status: "gallon_mismatch", note: `Gallons differ by ${gDelta.toFixed(2)}.` };
  if (gOk === true && !aOk) return { ...base, status: "amount_mismatch", note: `Amount differs by ${(aDelta ?? 0).toFixed(2)}.` };
  return { ...base, status: "other", note: "Both gallons and amount differ." };
}

function summarise(rows: readonly ReconRow[], reportLines: number, systemFills: number): ReconSummary {
  const count = (st: ReconStatus) => rows.filter((r) => r.status === st).length;
  const basis = (b: MatchBasis) => rows.filter((r) => r.basis === b).length;

  /*
   * Four magnitudes, each positive, none derived from another. Only rows whose amount is KNOWN can
   * contribute: an unrecorded amount is not a dollar of exposure, it is a dollar we cannot speak about.
   *
   * ── AND ONLY ROWS WE ARE ACTUALLY CALLING WRONG ────────────────────────────────────────────────
   * An earlier version summed every non-zero amount delta, including the ones inside tolerance. Run
   * against the five real statements that reported "85 lines overbilled" on a week whose overbilling
   * totalled **one dollar** — EFS bills a four-decimal per-gallon rate and rounds the total to the
   * cent, so a cent of disagreement is arithmetic, not a finding. A line count is the part a reader
   * reacts to, and 85 is alarming in a way $1 is not. Exposure now counts only rows whose STATUS says
   * they disagree; a clean line contributes nothing however its last cent fell.
   */
  const e: ReconExposure = {
    overbilled: 0, overbilledLines: 0, underbilled: 0, underbilledLines: 0,
    unbilled: 0, unbilledLines: 0, unrecorded: 0, unrecordedLines: 0,
  };
  const DISAGREES: readonly ReconStatus[] = ["amount_mismatch", "gallon_mismatch", "other"];
  for (const r of rows) {
    if (r.status === "missing_in_system") {
      if (r.report?.netAmount != null) { e.unrecorded += r.report.netAmount; e.unrecordedLines += 1; }
      continue;
    }
    if (r.status === "missing_on_report") {
      if (r.system?.totalCost != null) { e.unbilled += r.system.totalCost; e.unbilledLines += 1; }
      continue;
    }
    if (!DISAGREES.includes(r.status) || r.amountDelta == null || r.amountDelta === 0) continue;
    if (r.amountDelta > 0) { e.overbilled += r.amountDelta; e.overbilledLines += 1; }
    else { e.underbilled += -r.amountDelta; e.underbilledLines += 1; }
  }

  return {
    reportLines,
    systemFills,
    clean: count("clean"),
    amountMismatch: count("amount_mismatch"),
    gallonMismatch: count("gallon_mismatch"),
    amountUnknown: count("amount_unknown"),
    dateDrift: count("date_drift"),
    cardDrift: count("card_drift"),
    missingInSystem: count("missing_in_system"),
    missingOnReport: count("missing_on_report"),
    other: count("other"),
    matchedOnCard6: basis("card6"),
    matchedOnCard4: basis("card4"),
    matchedOnDateGallons: basis("date_gallons"),
    exposure: {
      overbilled: r2(e.overbilled), overbilledLines: e.overbilledLines,
      underbilled: r2(e.underbilled), underbilledLines: e.underbilledLines,
      unbilled: r2(e.unbilled), unbilledLines: e.unbilledLines,
      unrecorded: r2(e.unrecorded), unrecordedLines: e.unrecordedLines,
    },
  };
}

/** Statuses that need somebody to look. `clean` and the two labelled-but-agreeing matches do not. */
export const RECON_DISCREPANCIES: readonly ReconStatus[] = [
  "missing_in_system", "missing_on_report", "amount_mismatch", "gallon_mismatch", "other",
];

export { shiftDay as shiftBusinessDay };
