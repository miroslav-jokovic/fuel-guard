import {
  CORRELATION_THRESHOLDS, RECON_STATUS_LABELS,
  FUEL_EXCEPTION_STATUS_LABELS, type FuelExceptionStatus,
} from "@fuelguard/shared";
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

/**
 * A near-miss fill's timeline marker (G3) — a fill whose case stayed CLEAR but whose combined score
 * reached `entityRisk.ts`'s NEAR_THRESHOLD_SCORE.
 *
 * The breakpoint is `CORRELATION_THRESHOLDS.review` (60) and is not a design choice: a case is
 * levelled `review` when a SINGLE signal weighs >= 60, so a fill whose signals SUM past 60 while no
 * one of them reaches it is a fill the engine deliberately let through. That is the near miss worth
 * a warning marker. Below it the score is elevated but nothing individually came close, so it stays
 * neutral - colouring every near miss alike would make the list say nothing.
 *
 * WARNING: deliberately NOT `toneClass`. Those are pill classes - a pale `bg-*-50` fill plus `ring-1
 * ring-inset` - which are right behind 11px of text and invisible as an 8px dot; the first cut
 * shipped that way and the markers could not be seen against the card. A marker needs a solid fill.
 * The neutral case uses the `edge-strong` ROLE rather than a `neutral-*` ramp, per the token
 * contract: roles for neutrals, ramps only for status and brand tints.
 */
const MARKER = {
  warning: "bg-warning-600",
  neutral: "bg-edge-strong",
} as const;

export function nearMissMarker(score: number): string {
  return score >= CORRELATION_THRESHOLDS.review ? MARKER.warning : MARKER.neutral;
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
/**
 * The applicant board's stage chip.
 *
 * ⚠ **Moved here from a local `Record` in `RecruitmentPage.vue` (2026-08-23).**
 * `RECRUITING-SYSTEM-PLAN.md` §4 says tones live in this file only and that
 * `ApplicationInviteCard`'s `STATE_TONE` was "the last survivor". It was not — `STAGE_TONE` was
 * still sitting in the page. Found while adding the disposition chip beside it, and moved rather
 * than matched, because the wrong one is the template the next person copies.
 */
export function applicantStageBadge(stage: string): DqBadge {
  switch (stage) {
    case "not_started":
      return { label: "Not started", tone: "neutral" };
    case "history_incomplete":
      return { label: "History incomplete", tone: "warning" };
    case "awaiting_releases":
      return { label: "Awaiting releases", tone: "caution" };
    case "ready_to_screen":
      return { label: "Ready to screen", tone: "success" };
    default:
      return { label: stage, tone: "neutral" };
  }
}

/**
 * How an application ended, when it ended without a hire (0238).
 *
 * ⚠ **`declined` is `danger` and the other two are `neutral`**, and the difference is not decoration:
 * a decline is the CARRIER's decision and the only one of the three that can ever owe the applicant
 * a notice. A recruiter scanning the board needs to tell at a glance which of these the company did
 * and which happened to it.
 */
export function applicantDispositionBadge(outcome: string): DqBadge {
  switch (outcome) {
    case "declined":
      return { label: "Declined", tone: "danger" };
    case "withdrawn":
      return { label: "Withdrew", tone: "neutral" };
    case "no_response":
      return { label: "No response", tone: "neutral" };
    default:
      return { label: outcome, tone: "neutral" };
  }
}

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

/**
 * A reconciliation row's status.
 *
 * The words come from `RECON_STATUS_LABELS` in `@fuelguard/shared` — the machine token and the label
 * ship as a pair, so no `.vue` file carries a status literal — and only the TONE is decided here.
 *
 * The three tones say what a reader should do, not how bad the row sounds. A fill the vendor billed and
 * we never recorded is the fuel-theft surface and is the only red; a drifted or card-drifted match
 * AGREES about the money and is merely qualified, so it is neutral rather than a warning.
 */
export function reconStatusBadge(status: string): DqBadge {
  switch (status) {
    case "clean":
      return { label: RECON_STATUS_LABELS.clean, tone: "success" };
    case "missing_in_system":
      return { label: RECON_STATUS_LABELS.missing_in_system, tone: "danger" };
    case "missing_on_report":
      return { label: RECON_STATUS_LABELS.missing_on_report, tone: "caution" };
    case "amount_mismatch":
    case "gallon_mismatch":
    case "other":
      return { label: RECON_STATUS_LABELS[status], tone: "warning" };
    case "date_drift":
    case "card_drift":
    case "amount_unknown":
      return { label: RECON_STATUS_LABELS[status], tone: "neutral" };
    default:
      return { label: status, tone: "neutral" };
  }
}

/**
 * An exception's status, in the ledger and its slide-over.
 *
 * The words come from `FUEL_EXCEPTION_STATUS_LABELS` in `@fuelguard/shared`; only the TONE is decided
 * here. What the tones say is *what a reader should do*, not how bad the row sounds:
 *
 *   open / investigating  — somebody's work, and warning is the colour of work outstanding
 *   disputed              — with the vendor now; ours to chase, not ours to decide
 *   credited              — settled in our favour, and the only success on this surface
 *   dismissed             — a decision, deliberately neutral rather than red: choosing not to pursue
 *                           $40 is good judgement, and colouring it as a loss would discourage it
 *   no longer found       — nobody decided anything; it stopped appearing. Neutral for that reason.
 */
export function fuelExceptionStatusBadge(status: string): DqBadge {
  const label = FUEL_EXCEPTION_STATUS_LABELS[status as FuelExceptionStatus] ?? status;
  switch (status) {
    case "open":
      return { label, tone: "warning" };
    case "investigating":
      return { label, tone: "info" };
    case "disputed":
      return { label, tone: "caution" };
    case "credited":
      return { label, tone: "success" };
    case "dismissed":
    case "resolved_by_reingest":
      return { label, tone: "neutral" };
    default:
      return { label, tone: "neutral" };
  }
}

/**
 * What KIND of money a finding is. Only the two recoverable-or-unexplained kinds carry weight:
 * `unrecorded` is fuel we cannot account for and is the fuel-theft surface, `overbilled` is money to
 * go and get back. `unbilled` is neither — the vendor may simply not have invoiced yet — so colouring
 * it as a problem would put a red row in front of somebody with nothing to do about it.
 */
export function fuelExceptionAmountTone(amountKind: string): string {
  if (amountKind === "unrecorded") return "text-danger-700";
  if (amountKind === "overbilled" || amountKind === "premium") return "text-caution-800";
  return "text-ink";
}
