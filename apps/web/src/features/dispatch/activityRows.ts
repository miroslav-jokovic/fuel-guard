import type { ActivitySummary } from "@silvicom/shared";

/**
 * The Activity view's threshold, order and colour (LOADS-ACTIVITY-PLAN D-LA7). The figures are the
 * server's (`summarizeActivity`). This file only decides which rows pass the filter, in what order,
 * and how loud each one reads.
 */

/** "Without a load" choices. "" = everyone; "none" = nothing delivered inside the read's window. */
export const IDLE_OPTIONS = [
  { value: "", label: "Anyone" },
  { value: "2", label: "2+ days" },
  { value: "3", label: "3+ days" },
  { value: "5", label: "5+ days" },
  { value: "7", label: "7+ days" },
  { value: "none", label: "No delivery in range" },
];
export const IDLE_VALUES = IDLE_OPTIONS.map((o) => o.value).filter(Boolean);

/**
 * Does this row pass the threshold? A subject with no delivery in the window and no load now passes
 * every numeric threshold: whatever the true number is, it exceeds the window, which exceeds 7.
 */
export function passesIdle(row: Pick<ActivitySummary, "daysWithoutLoad" | "currentLoad">, threshold: string): boolean {
  if (!threshold) return true;
  const unknown = row.daysWithoutLoad === null && !row.currentLoad;
  if (threshold === "none") return unknown;
  return unknown || (row.daysWithoutLoad ?? 0) >= Number(threshold);
}

/** Longest without a load first; "none in range" leads, a load on the truck trails. Ties by name. */
export function compareIdle<T extends Pick<ActivitySummary, "daysWithoutLoad" | "currentLoad">>(name: (r: T) => string) {
  const rank = (r: T) => (r.daysWithoutLoad === null && !r.currentLoad ? Number.POSITIVE_INFINITY : (r.daysWithoutLoad ?? 0));
  return (a: T, b: T) => rank(b) - rank(a) || name(a).localeCompare(name(b), undefined, { numeric: true });
}

/** 0 days is working; 3+ asks a question; 7+ needs an answer. The same bands the threshold offers. */
export function idleTone(days: number | null, hasLoad: boolean): "success" | "neutral" | "warning" | "danger" {
  if (hasLoad) return "success";
  if (days === null || days >= 7) return "danger";
  if (days >= 3) return "warning";
  return "neutral";
}
