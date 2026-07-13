// Modern "soft" badge styling — light fill + subtle inset ring — used consistently across the app.
// Tones are semantic (design tokens), not raw palette colors: danger > caution > warning > success…
const SOFT = {
  danger: "bg-danger-50 text-danger-700 ring-1 ring-inset ring-danger-600/20",
  caution: "bg-caution-50 text-caution-700 ring-1 ring-inset ring-caution-600/20",
  warning: "bg-warning-50 text-warning-700 ring-1 ring-inset ring-warning-600/20",
  success: "bg-success-50 text-success-700 ring-1 ring-inset ring-success-600/20",
  info: "bg-info-50 text-info-700 ring-1 ring-inset ring-info-600/20",
  brand: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/20",
  neutral: "bg-surface-subtle text-ink-muted ring-1 ring-inset ring-neutral-500/20",
} as const;

export type BadgeTone = keyof typeof SOFT;

/** Base classes for a pill badge; combine with a tone from the helpers below. */
export const BADGE_BASE = "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium capitalize";

/** Soft badge classes for a semantic tone (unknown keys fall back to neutral). */
export const toneClass = (key: string): string => SOFT[key as BadgeTone] ?? SOFT.neutral;

export function severityTone(sev: string): string {
  return toneClass(sev === "critical" ? "danger" : sev === "high" ? "caution" : sev === "medium" ? "warning" : "neutral");
}

export function statusTone(status: string): string {
  return toneClass(
    status === "open" ? "brand" : status === "investigating" ? "warning" : status === "resolved" ? "success" : "neutral",
  );
}

/** Fuel-log transaction status: alert | review | verified | clear. */
export function txnStatusTone(status: string): string {
  return toneClass(status === "alert" ? "danger" : status === "review" ? "warning" : status === "verified" ? "success" : "neutral");
}

export function inviteTone(status: string): string {
  return toneClass(status === "pending" ? "warning" : status === "accepted" ? "success" : "neutral");
}

/** Declined-attempt suspicion: alert | review | clear. */
export function suspicionTone(level: string | null | undefined): string {
  return toneClass(level === "alert" ? "danger" : level === "review" ? "warning" : "neutral");
}
