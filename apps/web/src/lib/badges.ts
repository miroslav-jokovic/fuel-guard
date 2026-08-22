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

/**
 * Base classes for a pill badge; combine with a tone from the helpers below.
 *
 * Deliberately NO `capitalize` (removed 2026-08-20, recruiting plan R0b): the transform title-cased
 * every word, so the label maps' sentence-case strings rendered wrong — "No response" became
 * "No Response" — and the copy rule (contract §7.1) lost to a utility class. Labels own their
 * casing. A badge that still renders a raw machine token adds `capitalize` at its own call site;
 * each such site is a vocabulary that has not been mapped yet, which is exactly why it should stay
 * visible rather than papered over here.
 */
export const BADGE_BASE = "inline-flex items-center gap-1 rounded-detail px-2 py-0.5 text-xs font-medium";

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

/**
 * Archived, or not (migration 0235).
 *
 * A one-value vocabulary, and it lives here for the same reason the five-value ones do: the rule is
 * that no `.vue` file carries a status literal or a local tone `Record`, and "the label is obvious"
 * is exactly the argument that put `STATE_TONE` in a component for four months. `neutral` because
 * archiving is not a warning about the person — it is a fact about which list they are on.
 *
 * Returns null when the row is live, so a caller renders nothing rather than an "Active" badge that
 * would appear on every row of the default view and mean nothing.
 */
export function archivedBadge(archivedAt: string | null | undefined): DqBadge | null {
  return archivedAt ? { label: "Archived", tone: "neutral" } : null;
}

/**
 * Application-invitation state (`InviteState`) → badge.
 *
 * The last local tone `Record` in a .vue file, moved here 2026-08-21 as A1's UI-touching PR
 * (RECRUITING-SYSTEM-PLAN §4 flagged it by file and line so nobody would copy it). "Submitted" for
 * `used` deliberately: the machine token predates 0225, and since then a submitted link is not used
 * up — it reopens to what the driver sent. The label was always the honest word for it.
 */
export function applicationInviteBadge(state: string): DqBadge {
  switch (state) {
    case "open":
      return { label: "Open", tone: "info" };
    case "signing":
      return { label: "Signing", tone: "brand" };
    case "used":
      return { label: "Submitted", tone: "success" };
    case "revoked":
      return { label: "Revoked", tone: "neutral" };
    case "expired":
      return { label: "Expired", tone: "warning" };
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

/**
 * §391.23 inquiry-queue state (`inquiryQueue.ts` `InquiryState`) → tone. Labels come from
 * `INQUIRY_STATE_LABELS` in shared — the label and the colour deliberately live in the two
 * canonical homes rather than in a page-local `Record`, which is the drift D4 closed.
 * `documented` is neutral for the same reason `no_response` is success-toned below: a documented
 * good-faith effort discharges §391.23(c)(1), so it must never read as a problem.
 */
export function inquiryStateTone(state: string): string {
  return toneClass(
    state === "not_sent" ? "warning"
    : state === "awaiting" ? "info"
    : state === "overdue" ? "danger"
    : state === "answered" ? "success"
    : state === "undeliverable" ? "caution"
    : "neutral",
  );
}

/**
 * §391.23(a)(2) inquiry state (0208's `inquiry_status`) → badge.
 *
 * `no_response` is SUCCESS-toned on purpose and is not a bug to fix later: §391.23(d) lets a carrier
 * rely on a documented non-response, so the obligation is discharged. Colouring it as a problem would
 * nag a recruiter forever about a requirement they have already met.
 */
export function employmentInquiryBadge(status: string): DqBadge {
  switch (status) {
    case "not_required":
      return { label: "Not required", tone: "neutral" };
    case "pending":
      return { label: "Not sent", tone: "danger" };
    case "sent":
      return { label: "Awaiting", tone: "warning" };
    case "responded":
      return { label: "Responded", tone: "success" };
    case "no_response":
      return { label: "No response", tone: "success" };
    default:
      return { label: status, tone: "neutral" };
  }
}
