import { shiftDay, type CalendarDay } from "./calendarDay.js";
import type { CoverageMonth } from "./fleetpal/coverage.js";

/**
 * The repair-cost roll-up's arithmetic (FLEETPAL-INTEGRATION-PLAN.md F9d, D-FP18, D-FP19, Q10).
 *
 * F9b answers one truck, one window, one total. This answers "weekly, monthly and yearly expenses for
 * each truck" and "trucks versus trailers" without twelve calls each recomputing a coverage bound.
 * Pure: the API reads the rows and the coverage, this buckets them, so the rules below are tested
 * once here rather than per caller.
 *
 * ── TWO VALUES ON EVERY ROW, ALWAYS NAMED (D-FP18) ────────────────────────────────────────────
 * `operational` is FleetPal's `total` — labour in, what the unit cost to keep running. `external` is
 * `total − total_labor` — the only value comparable to the ledger's maintenance family, because shop
 * labour is payroll in McLeod and never in that family (measured July 2026: FleetPal $314,030 against
 * the family's $219,301; strip labour and it is $213,147, within 2.8%). A null `total_labor` is a job
 * with no labour line, so its external value is its total. A null `total` is a repair FleetPal has not
 * priced; it is COUNTED (`unpriced`) and adds nothing, and a bucket nothing priced stays null — never
 * a zero that reads as "free".
 *
 * ── THE BOUND STAYS MONTHLY (Q10 (a), taken 2026-11-16) ───────────────────────────────────────
 * The general ledger closes by month, so a week has no coverage bound of its own. A week carries the
 * months it touches — one, or two when it straddles a month end — and the page prints each month's
 * "at least X%" labelled as that month's. A year carries its twelve (or fewer, clipped to the window).
 *
 * ── EQUIPMENT TYPE COMES FROM FLEETPAL (D-FP19) ───────────────────────────────────────────────
 * The kind is the unit's own mapping (F5): a vehicle is a tractor, a trailer is a trailer, and a unit
 * resolved to neither is `unmatched` — reported beside every total (D-FP14), never dropped. A unit
 * resolved to BOTH is a mapping fault, and reported as unmatched too rather than counted twice.
 */

export const ROLLUP_BUCKETS = ["week", "month", "year"] as const;
export type RollupBucket = (typeof ROLLUP_BUCKETS)[number];
export const ROLLUP_KINDS = ["tractor", "trailer", "all"] as const;
export type RollupKind = (typeof ROLLUP_KINDS)[number];
export type RollupUnitKind = "tractor" | "trailer" | "unmatched";

export interface RollupRepair {
  unitFleetpalId: string | null;
  /** The carrier-zone calendar day the repair completed on. */
  day: CalendarDay;
  total: number | null;
  labor: number | null;
}

export interface RollupUnit {
  fleetpalId: string;
  number: string | null;
  vehicleId: string | null;
  trailerId: string | null;
}

export interface Money {
  operational: number | null;
  external: number | null;
  repairs: number;
  /** Repairs FleetPal has not priced (null `total`): counted, never summed as zero. */
  unpriced: number;
}

export interface RollupBucketRow {
  key: string;
  /** The bucket's first day and the day after its last, clipped to the window (half-open). */
  from: CalendarDay;
  to: CalendarDay;
  /** The `YYYY-MM` months whose bound this bucket carries (Q10 (a)). */
  months: string[];
  fleet: Money;
  byKind: Record<RollupUnitKind, Money>;
}

export interface RollupUnitRow {
  /** Every FleetPal unit id that resolved to this vehicle or trailer — eight trucks have two. */
  fleetpalUnitIds: string[];
  kind: RollupUnitKind;
  label: string | null;
  vehicleId: string | null;
  trailerId: string | null;
  total: Money;
  buckets: Record<string, Money>;
}

const emptyMoney = (): Money => ({ operational: null, external: null, repairs: 0, unpriced: 0 });
const round2 = (n: number) => Math.round(n * 100) / 100;

function add(m: Money, r: RollupRepair): void {
  m.repairs += 1;
  if (r.total === null) {
    m.unpriced += 1;
    return;
  }
  m.operational = round2((m.operational ?? 0) + r.total);
  m.external = round2((m.external ?? 0) + r.total - (r.labor ?? 0));
}

/** Monday of the week `day` falls in. Weeks are Monday-start, as every other fleet period here. */
export function weekStart(day: CalendarDay): CalendarDay {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return shiftDay(day, -((dow + 6) % 7));
}

export function bucketKey(day: CalendarDay, bucket: RollupBucket): string {
  if (bucket === "week") return weekStart(day);
  if (bucket === "month") return day.slice(0, 7);
  return day.slice(0, 4);
}

/** The half-open span of a bucket key, before clipping. */
function bucketSpan(key: string, bucket: RollupBucket): { from: CalendarDay; to: CalendarDay } {
  if (bucket === "week") return { from: key, to: shiftDay(key, 7) };
  if (bucket === "month") {
    const [y, m] = key.split("-").map(Number) as [number, number];
    return { from: `${key}-01`, to: m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01` };
  }
  return { from: `${key}-01-01`, to: `${Number(key) + 1}-01-01` };
}

/** Every `YYYY-MM` a half-open day span touches. */
export function monthsOfSpan(from: CalendarDay, to: CalendarDay): string[] {
  const out: string[] = [];
  const last = shiftDay(to, -1).slice(0, 7);
  let [y, m] = from.slice(0, 7).split("-").map(Number) as [number, number];
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= last) break;
    m += 1;
    if (m === 13) { m = 1; y += 1; }
  }
  return out;
}

/** Every bucket the window `[from, to)` touches, in order, clipped to the window. Empty ones included. */
export function bucketsOf(from: CalendarDay, to: CalendarDay, bucket: RollupBucket): Array<Omit<RollupBucketRow, "fleet" | "byKind">> {
  const out: Array<Omit<RollupBucketRow, "fleet" | "byKind">> = [];
  let key = bucketKey(from, bucket);
  for (;;) {
    const span = bucketSpan(key, bucket);
    const clipped = { from: span.from < from ? from : span.from, to: span.to > to ? to : span.to };
    out.push({ key, ...clipped, months: monthsOfSpan(clipped.from, clipped.to) });
    if (span.to >= to) break;
    key = bucketKey(span.to, bucket);
  }
  return out;
}

export function rollupUnitKindOf(u: Pick<RollupUnit, "vehicleId" | "trailerId"> | undefined): RollupUnitKind {
  if (!u) return "unmatched";
  if (u.vehicleId && !u.trailerId) return "tractor";
  if (u.trailerId && !u.vehicleId) return "trailer";
  return "unmatched";
}

export interface RollupResult {
  buckets: RollupBucketRow[];
  /** One row per vehicle or trailer (several FleetPal units folded), and one per unmatched FleetPal unit. */
  units: RollupUnitRow[];
}

/**
 * Buckets every repair in the window. `kind` filters the unit rows and the fleet line; `byKind` always
 * carries all three, so a tractor-only view can still say what it left out.
 */
export function rollUp(
  repairs: readonly RollupRepair[],
  units: readonly RollupUnit[],
  window: { from: CalendarDay; to: CalendarDay; bucket: RollupBucket; kind: RollupKind },
): RollupResult {
  const unitById = new Map(units.map((u) => [u.fleetpalId, u]));
  const buckets = bucketsOf(window.from, window.to, window.bucket).map((b) => ({
    ...b,
    fleet: emptyMoney(),
    byKind: { tractor: emptyMoney(), trailer: emptyMoney(), unmatched: emptyMoney() },
  }));
  const bucketByKey = new Map(buckets.map((b) => [b.key, b]));
  const rows = new Map<string, RollupUnitRow>();

  for (const r of repairs) {
    if (r.day < window.from || r.day >= window.to) continue;
    const bucket = bucketByKey.get(bucketKey(r.day, window.bucket));
    if (!bucket) continue;
    const unit = r.unitFleetpalId ? unitById.get(r.unitFleetpalId) : undefined;
    const kind = rollupUnitKindOf(unit);
    add(bucket.byKind[kind], r);
    if (window.kind !== "all" && kind !== window.kind) continue;
    add(bucket.fleet, r);

    // One row per vehicle or trailer, folding every FleetPal unit mapped to it (the eight duplicates).
    const rowKey = kind === "tractor" ? `v:${unit!.vehicleId}` : kind === "trailer" ? `t:${unit!.trailerId}` : `u:${r.unitFleetpalId ?? "none"}`;
    let row = rows.get(rowKey);
    if (!row) {
      row = {
        fleetpalUnitIds: [],
        kind,
        label: unit?.number ?? null,
        vehicleId: kind === "tractor" ? unit!.vehicleId : null,
        trailerId: kind === "trailer" ? unit!.trailerId : null,
        total: emptyMoney(),
        buckets: {},
      };
      rows.set(rowKey, row);
    }
    if (r.unitFleetpalId && !row.fleetpalUnitIds.includes(r.unitFleetpalId)) row.fleetpalUnitIds.push(r.unitFleetpalId);
    add(row.total, r);
    add((row.buckets[bucket.key] ??= emptyMoney()), r);
  }

  // Costliest first; an unpriced row sorts last, by its label, so the order is stable.
  const ordered = [...rows.values()].sort(
    (a, b) => (b.total.operational ?? -1) - (a.total.operational ?? -1) || (a.label ?? "").localeCompare(b.label ?? ""),
  );
  return { buckets, units: ordered };
}

/**
 * `GET /api/maintenance/fleetpal/rollup`'s answer — the contract the API sends and the Shop's Repair
 * cost tab reads. One page of unit rows (`limit`/`offset`), every bucket, and the bound per month.
 */
export interface RollupAnswer {
  buckets: RollupBucketRow[];
  units: RollupUnitRow[];
  /** Unit rows in the whole answer, before `limit`/`offset`. */
  unitTotal: number;
  /** Per month: FleetPal's invoicing, the ledger family and the "at least" bound (Q10 (a)). */
  coverage: CoverageMonth[];
  unmatchedUnits: number;
}

/**
 * Several buckets' money as one — the window's total on the Repair cost tab. Same rule as `add`: a
 * null side stays null only when NOTHING under it was priced, so a window of unpriced repairs reads
 * "—", never "$0.00".
 */
export function sumMoney(ms: readonly Money[]): Money {
  const out = emptyMoney();
  for (const m of ms) {
    out.repairs += m.repairs;
    out.unpriced += m.unpriced;
    if (m.operational !== null) out.operational = round2((out.operational ?? 0) + m.operational);
    if (m.external !== null) out.external = round2((out.external ?? 0) + m.external);
  }
  return out;
}

/**
 * The window the Repair cost tab opens on: the newest run of months whose bound is computable, at
 * most `max` long, as INCLUSIVE calendar days (first of its first month, last of its last).
 *
 * ⚠ The current month always refuses — the ledger is swept after it closes — and so does any month
 * the sweep missed. A default that reached either would open the tab on a 409, every time, so the
 * run stops at the first unprintable month walking back. Null when no month in `months` is printable.
 */
export function lastPrintableRun(months: readonly CoverageMonth[], max = 12): { from: CalendarDay; to: CalendarDay } | null {
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  let end = sorted.length - 1;
  while (end >= 0 && sorted[end]!.ratioLowerBound === null) end -= 1;
  if (end < 0) return null;
  let start = end;
  while (start > 0 && end - start + 1 < max && sorted[start - 1]!.ratioLowerBound !== null) start -= 1;
  const last = sorted[end]!.month;
  const [y, m] = last.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from: `${sorted[start]!.month}-01`, to: shiftDay(next, -1) };
}
