import { FUEL_EXCEPTION_STATUSES, type FuelExceptionStatus } from "./exceptions.js";
import { POLICY_EXCEPTION_KINDS, type PolicyExceptionKind } from "./policyFindings.js";

/**
 * Buying habits: the policy premiums as a monthly table, per truck and its drivers (F02-F04 chunk 9a,
 * Q-F2 ruled 2026-10-06).
 *
 * ── WHY THEY LEAVE THE QUEUE ─────────────────────────────────────────────────────────────────────
 * A premium paid at an avoided state, an avoided brand or off the network is real money, but nobody can
 * get it back: there is no vendor to dispute it with. As queue items they were 143 of 157 open fuel
 * problems on 2026-10-08, so the 14 that can be disputed were hidden among things nobody could close.
 * Q-F2 moved them to Fuel Costs as a report. This module is the report's arithmetic; 9b takes the kinds
 * out of the queue.
 *
 * ── THE ROWS ARE ALREADY TRUCK-MONTHS ────────────────────────────────────────────────────────────
 * `policyFindings` files one finding per truck × kind × month (Q-FUI3), dated the month's first day, with
 * the drivers who fuelled the truck that month in `evidence.drivers`. So a table row is one truck in one
 * month, its three kinds side by side. A driver has no amount of their own: the premium is filed per
 * truck, and splitting it between drivers would invent a split the records do not hold.
 *
 * Sums are in whole cents, so the month's total is the sum of the stored amounts to the cent (9a accept).
 */

/** The habit kinds are exactly the policy premiums: one list, read from the producer that files them. */
export const BUYING_HABIT_KINDS: readonly PolicyExceptionKind[] = POLICY_EXCEPTION_KINDS;

/**
 * Every status except `resolved_by_reingest`, which is the DETECTOR withdrawing a finding: a later run over
 * the same month no longer found it, so it is not a habit that happened. Closing or dismissing one in the
 * queue was a person's decision about the finding, not about whether the money was paid, so those count.
 */
export const BUYING_HABIT_STATUSES: readonly FuelExceptionStatus[] = FUEL_EXCEPTION_STATUSES.filter(
  (s) => s !== "resolved_by_reingest",
);

export interface BuyingHabitFinding {
  kind: string;
  /** The month's first day, as `policyFindings` dates it. */
  occurred_on: string | null;
  unit_number: string | null;
  amount: number | string | null;
  evidence: { drivers?: unknown; fills?: unknown; gallons?: unknown } | null;
}

export interface BuyingHabitRow {
  /** YYYY-MM. */
  month: string;
  unit: string;
  /** Who fuelled the truck that month, as the fills name them; empty when no fill carried a driver. */
  drivers: string[];
  byKind: Record<PolicyExceptionKind, number>;
  fills: number;
  gallons: number;
  total: number;
}

export interface BuyingHabitsTable {
  rows: BuyingHabitRow[];
  total: number;
  byKind: Record<PolicyExceptionKind, number>;
}

const cents = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const zeroKinds = (): Record<PolicyExceptionKind, number> =>
  Object.fromEntries(BUYING_HABIT_KINDS.map((k) => [k, 0])) as Record<PolicyExceptionKind, number>;
const isHabit = (k: string): k is PolicyExceptionKind => (BUYING_HABIT_KINDS as readonly string[]).includes(k);

/** Newest month first, then the dearest truck, then the unit number — a total order, so a refresh never reshuffles. */
export function buyingHabitsTable(findings: readonly BuyingHabitFinding[]): BuyingHabitsTable {
  const by = new Map<string, { month: string; unit: string; drivers: Set<string>; kinds: Record<PolicyExceptionKind, number>; fills: number; gallons: number }>();
  const all = zeroKinds();
  for (const f of findings) {
    if (!isHabit(f.kind) || !f.occurred_on) continue;
    const month = f.occurred_on.slice(0, 7);
    const unit = f.unit_number ?? "—";
    const key = `${month}|${unit}`;
    let row = by.get(key);
    if (!row) by.set(key, (row = { month, unit, drivers: new Set(), kinds: zeroKinds(), fills: 0, gallons: 0 }));
    const c = cents(f.amount);
    row.kinds[f.kind] += c;
    all[f.kind] += c;
    // The fills and gallons of one truck-month are counted once per KIND that priced them, and a fill can
    // be both off network and in an avoided state; the largest is the truck-month's own count of fills.
    row.fills = Math.max(row.fills, Number(f.evidence?.fills) || 0);
    row.gallons = Math.max(row.gallons, Number(f.evidence?.gallons) || 0);
    const drivers = f.evidence?.drivers;
    if (Array.isArray(drivers)) for (const d of drivers) if (typeof d === "string" && d.trim()) row.drivers.add(d.trim());
  }
  const toDollars = (r: Record<PolicyExceptionKind, number>) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v / 100])) as Record<PolicyExceptionKind, number>;
  const rows = [...by.values()]
    .map((r) => {
      const totalCents = BUYING_HABIT_KINDS.reduce((s, k) => s + r.kinds[k], 0);
      return {
        month: r.month, unit: r.unit, drivers: [...r.drivers].sort(), byKind: toDollars(r.kinds),
        fills: r.fills, gallons: r.gallons, total: totalCents / 100,
      };
    })
    .sort((a, b) => b.month.localeCompare(a.month) || b.total - a.total || a.unit.localeCompare(b.unit, undefined, { numeric: true }));
  return { rows, total: BUYING_HABIT_KINDS.reduce((s, k) => s + all[k], 0) / 100, byKind: toDollars(all) };
}

/** The first day of the month `ymd` falls in: the table reads whole months, so a window starting mid-month keeps its first month. */
export const monthStartOf = (ymd: string): string => `${ymd.slice(0, 7)}-01`;
