// Modern "soft" badge styling — light fill + subtle inset ring — used consistently across the app.
const SOFT: Record<string, string> = {
  red: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20",
  orange: "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-600/20",
  amber: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
  green: "bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20",
  indigo: "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20",
  gray: "bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-500/20",
};

/** Base classes for a pill badge; combine with a tone from the helpers below. */
export const BADGE_BASE = "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium capitalize";

const tone = (key: string): string => SOFT[key] ?? SOFT.gray!;

export function severityTone(sev: string): string {
  return tone(sev === "critical" ? "red" : sev === "high" ? "orange" : sev === "medium" ? "amber" : "gray");
}

export function statusTone(status: string): string {
  return tone(
    status === "open" ? "indigo" : status === "investigating" ? "amber" : status === "resolved" ? "green" : "gray",
  );
}

/** Fuel-log transaction status: alert | review | verified | clear. */
export function txnStatusTone(status: string): string {
  return tone(status === "alert" ? "red" : status === "review" ? "amber" : status === "verified" ? "green" : "gray");
}

export function inviteTone(status: string): string {
  return tone(status === "pending" ? "amber" : status === "accepted" ? "green" : "gray");
}

/** Declined-attempt suspicion: alert | review | clear. */
export function suspicionTone(level: string | null | undefined): string {
  return tone(level === "alert" ? "red" : level === "review" ? "amber" : "gray");
}
