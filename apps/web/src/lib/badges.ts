// Modern "soft" badge styling — light fill + subtle inset ring — used consistently across the app.
// Tones are semantic (design tokens), not raw palette colors: danger > caution > warning > success…
const SOFT = {
  danger: "bg-danger-50 text-danger-700 ring-1 ring-inset ring-danger-600/20",
  caution: "bg-caution-50 text-caution-700 ring-1 ring-inset ring-caution-600/20",
  warning: "bg-warning-50 text-warning-700 ring-1 ring-inset ring-warning-600/20",
  success: "bg-success-50 text-success-700 ring-1 ring-inset ring-success-600/20",
  info: "bg-info-50 text-info-700 ring-1 ring-inset ring-info-600/20",
  brand: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/20",
  neutral: "bg-surface-subtle text-ink-muted ring-1 ring-inset ring-edge",
} as const;

export type BadgeTone = keyof typeof SOFT;

/** Base classes for a pill badge; combine with a tone from the helpers below. */
export const BADGE_BASE = "inline-flex items-center gap-1 rounded-detail px-2 py-0.5 text-xs font-medium capitalize";

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

// ── Driver qualification (DQF plan D4): THREE words, mapped in exactly one place ─────────────────
//
// The section had grown four status vocabularies (queue/file, roster, CertManager, exports). The UI
// vocabulary collapses to OK / Expiring / Blocked: `missing` and `expired` both read as Blocked —
// either way the driver should not be dispatched on that item — and the distinction survives in the
// requirement drawer and the detail columns, where it is actionable. `DqItemState` itself is
// internal and unchanged. Done-when: no .vue file carries a DQ status string literal of its own.

export interface DqBadge {
  label: string;
  tone: BadgeTone;
}

/** Per-requirement state (DqItemState) → the three-word vocabulary. */
export function dqItemBadge(state: string): DqBadge {
  switch (state) {
    case "current":
      return { label: "OK", tone: "success" };
    case "expiring":
      return { label: "Expiring", tone: "warning" };
    case "expired":
    case "missing":
      return { label: "Blocked", tone: "danger" };
    default:
      return { label: state, tone: "neutral" };
  }
}

/** HOS duty status → badge (moved from DriversPage per D3 — the contract's §8 flagged the local
 *  map, and its -100/-700 pairs, as the violation). */
export function hosStatusBadge(status: string): DqBadge {
  switch (status) {
    case "driving":
      return { label: "Driving", tone: "info" };
    case "on_duty":
      return { label: "On duty", tone: "warning" };
    case "sleeper":
      return { label: "Sleeper", tone: "neutral" };
    case "off_duty":
      return { label: "Off duty", tone: "neutral" };
    case "yard_move":
      return { label: "Yard move", tone: "neutral" };
    case "personal_conveyance":
      return { label: "Personal", tone: "neutral" };
    default:
      return { label: "Unknown", tone: "neutral" };
  }
}

/** Driver-app access (active | disabled | none) → badge (moved from DriversPage per D3). */
export function appAccessBadge(access: string): DqBadge {
  switch (access) {
    case "active":
      return { label: "Active", tone: "success" };
    case "disabled":
      return { label: "Disabled", tone: "warning" };
    default:
      return { label: "—", tone: "neutral" };
  }
}

/** Whole-file state (complete | incomplete | not_started) → the same three words. */
export function dqFileBadge(state: string): DqBadge {
  switch (state) {
    case "complete":
      return { label: "OK", tone: "success" };
    case "incomplete":
      return { label: "Blocked", tone: "danger" };
    case "not_started":
      return { label: "Not started", tone: "neutral" };
    default:
      return { label: state, tone: "neutral" };
  }
}
