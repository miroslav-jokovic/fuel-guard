/**
 * Pilot / Flying J fuel-report reconciliation (pure). Parses the vendor "All Transactions" export into
 * normalized diesel fills, then reconciles them against the org's recorded fuel_transactions so the
 * carrier can see, line by line, where the two disagree — the fuel-theft / billing-integrity surface.
 *
 * Pure + dataset-free: the .xls/.xlsx/.csv decode stays at the UI edge (readReportGrid); this takes the
 * decoded cell grid and the system fills, and returns buckets. Verified against a real 2026-06/07 Pilot
 * export (account 139445); the diesel gallon total ties out to the report's own PivotTable grand total.
 */

export type ReconCell = string | number | boolean | Date | null | undefined;
export type ReconGrid = ReconCell[][];

export type ReportProduct = "diesel" | "def" | "other";

export interface PilotReportFill {
  authNo: string | null; // Authorization_No — the vendor transaction id
  unit: string | null; // UnitNo — maps to a vehicle unit number
  cardRef: string | null; // Card_No
  site: string | null; // Pilot site number
  city: string | null;
  state: string | null;
  gallons: number; // Quantity
  netAmount: number | null; // InvoiceTotal — what the fleet actually paid
  retailAmount: number | null; // RetailTotal — posted total
  tranDate: string | null; // YYYY-MM-DD business date
  time: string | null; // HH:MM as printed (station local)
  product: ReportProduct;
  rowNumber: number;
}

export interface PilotReportParse {
  headerFound: boolean;
  account: string | null;
  startDate: string | null; // report window (from the metadata rows), YYYY-MM-DD
  endDate: string | null;
  fills: PilotReportFill[]; // diesel fills — the primary reconciliation unit
  defLines: PilotReportFill[]; // DEF add-ons (shown, not matched as fills)
  other: PilotReportFill[];
  totalDieselGallons: number;
  totalDieselNet: number;
  totalDieselRetail: number;
  skipped: number;
}

/** One recorded fill from fuel_transactions, projected to the fields we reconcile on. */
export interface SystemFill {
  id: string;
  cardRef: string | null;
  controlId: string | null;
  unit: string | null; // vehicle unit_number
  fueledAt: string | null; // ISO
  tranDate: string | null; // YYYY-MM-DD business date
  gallons: number;
  totalCost: number | null;
}

export interface ReconTolerances {
  gallons: number; // gallons within this are "the same fill volume"
  amountAbs: number; // $ within this (OR amountPct) are "the same amount"
  amountPct: number;
}
export const DEFAULT_TOLERANCES: ReconTolerances = { gallons: 1.0, amountAbs: 1.0, amountPct: 0.01 };

export type ReconStatus =
  | "clean"
  | "amount_mismatch"
  | "gallon_mismatch"
  | "missing_in_system"
  | "missing_on_report"
  | "other";

export interface ReconRow {
  status: ReconStatus;
  report: PilotReportFill | null;
  system: SystemFill | null;
  gallonsDelta: number | null; // report − system
  amountDelta: number | null; // report.net − system.totalCost
  note: string | null;
}

export interface ReconSummary {
  reportFills: number;
  systemFills: number; // system fills inside the report window
  clean: number;
  amountMismatch: number;
  gallonMismatch: number;
  missingInSystem: number;
  missingOnReport: number;
  other: number;
  /** $ that don't reconcile: |amount deltas| on mismatches + unmatched amounts on both sides. */
  dollarsAtStake: number;
}

export interface ReconResult {
  rows: ReconRow[];
  summary: ReconSummary;
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
const norm = (s: ReconCell): string => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const cstr = (c: ReconCell): string => (c == null ? "" : String(c)).trim();
const cnum = (c: ReconCell): number | null => {
  if (c == null || c === "") return null;
  const n = Number(String(c).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const digits = (s: string | null): string => (s ?? "").replace(/\D/g, "");
const last4 = (s: string | null): string => digits(s).slice(-4);

/** "747 Springville UT" → { site:"747", city:"Springville", state:"UT" }. */
export function parsePilotSiteDescr(d: ReconCell): { site: string | null; city: string | null; state: string | null } {
  const s = cstr(d);
  if (!s) return { site: null, city: null, state: null };
  const m = s.match(/^\s*(\d{1,5})?\s*(.*?)\s*([A-Z]{2})\s*$/);
  if (!m) return { site: null, city: s || null, state: null };
  return { site: m[1] ?? null, city: (m[2] ?? "").trim() || null, state: m[3] ?? null };
}

function timeHHMM(v: ReconCell): string | null {
  if (v instanceof Date) return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
  const m = cstr(v).match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : null;
}
function dateYMD(v: ReconCell): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = cstr(v);
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  return null;
}

const isDieselRow = (code: string, desc: string) => code === "20" || /truck diesel|diesel(?! exhaust)/i.test(desc);
const isDefRow = (code: string, desc: string) => code === "140" || /exhaust fluid|\bdef\b/i.test(desc);

// ── parser ──────────────────────────────────────────────────────────────────────────────────────
export function parsePilotFuelReport(grid: ReconGrid): PilotReportParse {
  const empty: PilotReportParse = {
    headerFound: false, account: null, startDate: null, endDate: null,
    fills: [], defLines: [], other: [], totalDieselGallons: 0, totalDieselNet: 0, totalDieselRetail: 0, skipped: 0,
  };
  if (!Array.isArray(grid) || grid.length === 0) return empty;

  // Metadata rows above the header carry the account + the report window.
  let account: string | null = null;
  let startDate: string | null = null;
  let endDate: string | null = null;

  const headerIdx = grid.findIndex((r) => {
    if (!Array.isArray(r)) return false;
    const set = new Set(r.map(norm));
    return set.has("authorizationno") && set.has("cardno") && set.has("quantity");
  });
  for (let i = 0; i < (headerIdx === -1 ? grid.length : headerIdx); i++) {
    const row = grid[i] ?? [];
    for (let j = 0; j < row.length; j++) {
      const key = norm(row[j]);
      const nextVal = row[j + 1];
      if (key === "standardacctno" && account == null) account = cstr(nextVal) || null;
      if (key === "startdate" && startDate == null) startDate = dateYMD(nextVal);
      if (key === "enddate" && endDate == null) endDate = dateYMD(nextVal);
    }
  }
  if (headerIdx === -1) return { ...empty, account, startDate, endDate };

  const header = grid[headerIdx]!.map(norm);
  const col = (n: string) => header.indexOf(n);
  const c = {
    auth: col("authorizationno"), unit: col("unitno"), card: col("cardno"), site: col("site"),
    siteDescr: col("sitedescr"), qty: col("quantity"), net: col("invoicetotal"), retail: col("retailtotal"),
    date: col("transactiondate"), time: col("transactiontime"), pcode: col("productcode"), pdesc: col("productdescription"),
  };

  const at = (row: ReconCell[], idx: number): ReconCell => (idx >= 0 ? row[idx] : null);
  const fills: PilotReportFill[] = [];
  const defLines: PilotReportFill[] = [];
  const other: PilotReportFill[] = [];
  let skipped = 0;

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row)) continue;
    const gallons = cnum(at(row, c.qty));
    if (gallons == null || gallons <= 0) {
      if (cstr(at(row, c.auth)) || cstr(at(row, c.card))) skipped++;
      continue;
    }
    const code = cstr(at(row, c.pcode));
    const desc = cstr(at(row, c.pdesc));
    const sd = parsePilotSiteDescr(at(row, c.siteDescr));
    const fill: PilotReportFill = {
      authNo: cstr(at(row, c.auth)) || null,
      unit: cstr(at(row, c.unit)) || null,
      cardRef: cstr(at(row, c.card)) || null,
      site: sd.site ?? (cstr(at(row, c.site)) || null),
      city: sd.city,
      state: sd.state,
      gallons,
      netAmount: cnum(at(row, c.net)),
      retailAmount: cnum(at(row, c.retail)),
      tranDate: dateYMD(at(row, c.date)),
      time: timeHHMM(at(row, c.time)),
      product: isDieselRow(code, desc) ? "diesel" : isDefRow(code, desc) ? "def" : "other",
      rowNumber: r + 1,
    };
    if (fill.product === "diesel") fills.push(fill);
    else if (fill.product === "def") defLines.push(fill);
    else other.push(fill);
  }

  const sum = (arr: PilotReportFill[], k: "gallons" | "netAmount" | "retailAmount") =>
    arr.reduce((s, x) => s + (x[k] ?? 0), 0);

  return {
    headerFound: true, account, startDate, endDate,
    fills, defLines, other,
    totalDieselGallons: sum(fills, "gallons"),
    totalDieselNet: sum(fills, "netAmount"),
    totalDieselRetail: sum(fills, "retailAmount"),
    skipped,
  };
}

// ── reconciler ──────────────────────────────────────────────────────────────────────────────────
const within = (a: number | null, b: number | null, absTol: number, pctTol = 0): boolean => {
  if (a == null || b == null) return false;
  const d = Math.abs(a - b);
  return d <= absTol || (pctTol > 0 && d <= Math.abs(b) * pctTol);
};

/**
 * Reconcile parsed report diesel fills against the org's recorded fills. Greedy match on card last-4 +
 * business date, choosing the closest-gallons unconsumed system fill; then classify by gallon/amount
 * tolerance. Report fills with no candidate are missing_in_system; system fills (inside the report
 * window) never consumed are missing_on_report.
 */
export function reconcilePilotFuel(
  report: PilotReportFill[],
  system: SystemFill[],
  tol: ReconTolerances = DEFAULT_TOLERANCES,
): ReconResult {
  // Index system fills by cardLast4|date, and a looser date-only fallback (card mismatch → "other").
  const byCardDate = new Map<string, SystemFill[]>();
  const byDate = new Map<string, SystemFill[]>();
  const consumed = new Set<string>();
  for (const s of system) {
    if (!s.tranDate) continue;
    const cd = `${last4(s.cardRef)}|${s.tranDate}`;
    (byCardDate.get(cd) ?? byCardDate.set(cd, []).get(cd)!).push(s);
    (byDate.get(s.tranDate) ?? byDate.set(s.tranDate, []).get(s.tranDate)!).push(s);
  }

  const pickClosest = (cands: SystemFill[], gallons: number): SystemFill | null => {
    let best: SystemFill | null = null;
    let bestD = Infinity;
    for (const s of cands) {
      if (consumed.has(s.id)) continue;
      const d = Math.abs(s.gallons - gallons);
      if (d < bestD) { best = s; bestD = d; }
    }
    return best;
  };

  const rows: ReconRow[] = [];
  for (const f of report) {
    const cd = `${last4(f.cardRef)}|${f.tranDate ?? ""}`;
    let match = f.tranDate ? pickClosest(byCardDate.get(cd) ?? [], f.gallons) : null;
    let viaCard = true;
    if (!match && f.tranDate) {
      // Same day, gallons line up, but the card didn't — flag as "other" (card/attribution drift).
      const cand = pickClosest(byDate.get(f.tranDate) ?? [], f.gallons);
      if (cand && within(cand.gallons, f.gallons, Math.max(tol.gallons, 2))) { match = cand; viaCard = false; }
    }
    if (!match) {
      rows.push({ status: "missing_in_system", report: f, system: null, gallonsDelta: null, amountDelta: null, note: "On the report; no matching fill recorded." });
      continue;
    }
    consumed.add(match.id);
    const gDelta = f.gallons - match.gallons;
    const aDelta = f.netAmount != null && match.totalCost != null ? f.netAmount - match.totalCost : null;
    const gOk = within(f.gallons, match.gallons, tol.gallons);
    const aOk = within(f.netAmount, match.totalCost, tol.amountAbs, tol.amountPct);
    let status: ReconStatus;
    let note: string | null = null;
    if (!viaCard) { status = "other"; note = "Matched by date + gallons, but the card number differs."; }
    else if (gOk && aOk) status = "clean";
    else if (!gOk && aOk) { status = "gallon_mismatch"; note = `Gallons differ by ${gDelta.toFixed(2)}.`; }
    else if (gOk && !aOk) { status = "amount_mismatch"; note = aDelta != null ? `Amount differs by $${aDelta.toFixed(2)}.` : "Amount differs."; }
    else { status = "other"; note = "Both gallons and amount differ."; }
    rows.push({ status, report: f, system: match, gallonsDelta: gDelta, amountDelta: aDelta, note });
  }

  // System fills inside the report window that were never matched → missing on the report.
  const lo = report.reduce<string | null>((m, f) => (f.tranDate && (!m || f.tranDate < m) ? f.tranDate : m), null);
  const hi = report.reduce<string | null>((m, f) => (f.tranDate && (!m || f.tranDate > m) ? f.tranDate : m), null);
  for (const s of system) {
    if (consumed.has(s.id)) continue;
    if (lo && hi && s.tranDate && (s.tranDate < lo || s.tranDate > hi)) continue; // outside the report window
    rows.push({ status: "missing_on_report", report: null, system: s, gallonsDelta: null, amountDelta: null, note: "Recorded fill with no matching report line." });
  }

  const count = (st: ReconStatus) => rows.filter((r) => r.status === st).length;
  const dollarsAtStake =
    rows.reduce((acc, r) => {
      if (r.status === "amount_mismatch") return acc + Math.abs(r.amountDelta ?? 0);
      if (r.status === "missing_in_system") return acc + (r.report?.netAmount ?? 0);
      if (r.status === "missing_on_report") return acc + (r.system?.totalCost ?? 0);
      if (r.status === "other") return acc + Math.abs(r.amountDelta ?? 0);
      return acc;
    }, 0);

  const systemInWindow = system.filter((s) => !(lo && hi && s.tranDate && (s.tranDate < lo || s.tranDate > hi))).length;
  return {
    rows,
    summary: {
      reportFills: report.length,
      systemFills: systemInWindow,
      clean: count("clean"),
      amountMismatch: count("amount_mismatch"),
      gallonMismatch: count("gallon_mismatch"),
      missingInSystem: count("missing_in_system"),
      missingOnReport: count("missing_on_report"),
      other: count("other"),
      dollarsAtStake: Math.round(dollarsAtStake * 100) / 100,
    },
  };
}
