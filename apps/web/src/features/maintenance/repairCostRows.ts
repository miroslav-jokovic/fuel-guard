import { formatDisplayDate, shiftDay, type CoverageMonth, type Money, type RollupBucket, type RollupBucketRow, type RollupUnitRow } from "@silvicom/shared";
import { fmtMoney } from "@/lib/chartTheme";

/**
 * The Repair cost tab's words (FLEETPAL-INTEGRATION-PLAN.md F9d). Pure, so the rules that keep the
 * figures honest are tested once, here, and not re-read off a rendered table.
 *
 * ── TWO FIGURES, ALWAYS NAMED (D-FP18) ────────────────────────────────────────────────────────
 * "with shop labour" is FleetPal's total; "without labour" is the one comparable to the ledger,
 * because shop labour is payroll in McLeod. Neither is ever printed bare.
 *
 * ── "AT LEAST", PER MONTH (D-FP15, Q10 (a)) ───────────────────────────────────────────────────
 * The bound is a lower bound and monthly. A month prints its own; a week prints the month it falls
 * in, or both months' when it straddles a month end, each named. A year has up to twelve, and its
 * row prints the lowest — "at least X% every month" is true of all twelve and fits a cell.
 */

export const WITH_LABOUR = "With shop labour";
export const WITHOUT_LABOUR = "Without labour (comparable to the ledger)";

/** A null figure is "nothing priced", never $0 — `—`, with the unpriced count saying why. */
export function money(n: number | null): string {
  return n === null ? "—" : fmtMoney(n);
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = (m: string) => MONTH_NAMES[Number(m.slice(5, 7)) - 1]!.slice(0, 3);

export function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** The row's name. A week is its clipped span in MM/DD/YYYY, so a window starting mid-week says so. */
export function periodLabel(b: Pick<RollupBucketRow, "key" | "from" | "to">, bucket: RollupBucket): string {
  if (bucket === "month") return monthLabel(b.key);
  if (bucket === "year") return b.key;
  return `${formatDisplayDate(b.from)} – ${formatDisplayDate(shiftDay(b.to, -1))}`;
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

/**
 * The bucket's bound, in words. `null` ratios cannot reach here — the API refuses a window holding
 * one — but a month missing from `coverage` is said as "not known" rather than skipped.
 */
export function boundLabel(months: readonly string[], coverage: readonly CoverageMonth[]): string {
  const ratio = (m: string) => coverage.find((c) => c.month === m)?.ratioLowerBound ?? null;
  const known = months.map((m) => ({ m, r: ratio(m) }));
  if (known.some((k) => k.r === null)) return "not known";
  if (known.length === 1) return `at least ${pct(known[0]!.r!)}`;
  if (known.length === 2) return known.map((k) => `at least ${pct(k.r!)} (${SHORT(k.m)})`).join(" · ");
  return `at least ${pct(Math.min(...known.map((k) => k.r!)))} every month`;
}

/** The row's repair count, with the unpriced ones named when there are any. */
export function repairsLabel(m: Money): string {
  const n = `${m.repairs.toLocaleString()} repair${m.repairs === 1 ? "" : "s"}`;
  return m.unpriced ? `${n}, ${m.unpriced.toLocaleString()} not priced` : n;
}

export const KIND_WORD = { tractor: "Truck", trailer: "Trailer", unmatched: "Not matched" } as const;

/** The truck's or trailer's page. An unmatched FleetPal unit has none — it is not ours to open. */
export function unitPath(u: Pick<RollupUnitRow, "kind" | "vehicleId" | "trailerId">): string | null {
  if (u.kind === "tractor" && u.vehicleId) return `/shop/units/tractor/${u.vehicleId}`;
  if (u.kind === "trailer" && u.trailerId) return `/shop/units/trailer/${u.trailerId}`;
  return null;
}
