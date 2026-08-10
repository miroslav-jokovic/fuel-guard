import {
  type CardCapabilities,
  type EffectiveOrigin,
  EFS_CARD_STATUS_LABELS,
  type EfsCardStatus,
  formatLimit,
  infoLabel,
  limitLabel,
} from "@fuelguard/shared";

/**
 * Pure presentation logic for the fuel-card pages.
 *
 * Extracted from the `.vue` files so the rules that are easy to get wrong — and expensive when wrong —
 * are unit-testable without mounting anything. Two of them matter more than the rest:
 *
 *   • A limit VALUE means gallons for fuel and dollars otherwise (guide p36). Rendering a 100-gallon
 *     ULSD cap as "$100" tells a fleet manager their driver can buy a third of a tank when he can in
 *     fact fill twice.
 *   • "Card level always trumps policy" (p37), and getCardv2 does not return the policy half at all.
 *     A policy rule that is NOT in force must still be visible, and visibly not in force — otherwise
 *     the operator sees it in the WEX portal, doesn't see it here, and stops trusting the page.
 */

// ─── Status ────────────────────────────────────────────────────────────────────────────────────

/**
 * `Hold` is warning rather than danger on purpose: it is the reversible, intended state after
 * somebody locks a card, not a fault. `Fraud` and `Deleted` are the ones that should stop a reader.
 */
export function cardStatusTone(status: string | null): string {
  switch (status) {
    case "Active": return "success";
    case "Hold": return "warning";
    case "Inactive": return "neutral";
    case "Fraud": return "danger";
    case "Deleted": return "danger";
    default: return "neutral";
  }
}

/** A status EFS reports that we have no label for is shown verbatim, never blanked. */
export const cardStatusLabel = (status: string | null): string =>
  status ? (EFS_CARD_STATUS_LABELS[status as EfsCardStatus] ?? status) : "Unknown";

// ─── Freshness ─────────────────────────────────────────────────────────────────────────────────

export interface Freshness {
  text: string;
  /** True past the staleness threshold — the page shows this in a caution tone with a next action. */
  stale: boolean;
}

const STALE_AFTER_MINUTES = 60;

/**
 * How old the mirror row is, in words.
 *
 * This exists because the mirror is swept DAILY: card configuration changes when a human changes it,
 * and polling a shared, rate-paced service account every few minutes for data that has not moved is
 * exactly the behaviour the guide warns can get an account suspended (p11). So the page has to be
 * honest about its own age and offer the refresh, rather than implying it is live.
 */
export function freshness(syncedAt: string | null, now: Date = new Date()): Freshness {
  if (!syncedAt) return { text: "Never checked.", stale: true };
  const ms = now.getTime() - new Date(syncedAt).getTime();
  if (Number.isNaN(ms)) return { text: "Never checked.", stale: true };
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return { text: "Checked just now.", stale: false };
  if (minutes < 60) return { text: `Checked ${minutes} minute${minutes === 1 ? "" : "s"} ago.`, stale: minutes >= STALE_AFTER_MINUTES };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return { text: `Last checked over ${hours === 1 ? "an hour" : `${hours} hours`} ago. Refresh to see current settings.`, stale: true };
  }
  const days = Math.floor(hours / 24);
  return { text: `Last checked ${days} day${days === 1 ? "" : "s"} ago. Refresh to see current settings.`, stale: true };
}

// ─── Effective configuration ───────────────────────────────────────────────────────────────────

export interface EffectiveDisplayRow {
  key: string;
  label: string;
  detail: string;
  origin: EffectiveOrigin;
  originLabel: string;
  originTone: string;
  /** False when the row is shown for context but the pump will not apply it. */
  enforced: boolean;
}

const ORIGIN_LABEL: Record<EffectiveOrigin, string> = {
  card: "Card",
  policy: "Policy",
  "policy-overridden": "Overridden by card",
  "policy-ignored": "Not applied",
};

const ORIGIN_TONE: Record<EffectiveOrigin, string> = {
  card: "brand",
  policy: "info",
  "policy-overridden": "neutral",
  "policy-ignored": "neutral",
};

const describeOrigin = (origin: EffectiveOrigin) => ({
  origin,
  originLabel: ORIGIN_LABEL[origin],
  originTone: ORIGIN_TONE[origin],
  enforced: origin === "card" || origin === "policy",
});

export interface RawInfo { infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null }
export interface RawLimit { limitId: string; limit: number; hours: number | null; minHours: number | null }
export interface RawTime { day: number; beginTime: string | null; endTime: string | null }
export interface Merged<T> { value: T; origin: EffectiveOrigin }

export function promptRows(rows: readonly Merged<RawInfo>[]): EffectiveDisplayRow[] {
  return rows.map((row, index) => ({
    key: `${row.value.infoId}-${row.origin}-${index}`,
    label: infoLabel(row.value.infoId),
    // EXACT_MATCH is the one that makes the pump VALIDATE the entry rather than just record it —
    // the difference between a prompt that stops the wrong driver and one that only reports him.
    detail: row.value.validationType === "EXACT_MATCH"
      ? `Must match ${row.value.matchValue || "—"}`
      : row.value.validationType === "REPORT_ONLY"
        ? `Recorded only${row.value.reportValue ? `: ${row.value.reportValue}` : ""}`
        : (row.value.validationType ?? "—"),
    ...describeOrigin(row.origin),
  }));
}

export function limitRows(rows: readonly Merged<RawLimit>[]): EffectiveDisplayRow[] {
  return rows.map((row, index) => {
    const window = row.value.hours ? ` per ${row.value.hours}h` : "";
    const gap = row.value.minHours ? `, ${row.value.minHours}h between uses` : "";
    return {
      key: `${row.value.limitId}-${row.origin}-${index}`,
      label: limitLabel(row.value.limitId),
      // formatLimit carries the unit the limit ID implies. See the note at the top of this file.
      detail: `${formatLimit(row.value.limitId, row.value.limit)}${window}${gap}`,
      ...describeOrigin(row.origin),
    };
  });
}

const DAY_NAMES = ["", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Only the time-of-day part of a restriction applies; the date reads 1970-01-01 (p37). */
const clockTime = (value: string | null): string => {
  if (!value) return "—";
  const match = /T(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : value;
};

export function timeRows(rows: readonly Merged<RawTime>[]): EffectiveDisplayRow[] {
  return rows.map((row, index) => ({
    key: `${row.value.day}-${row.origin}-${index}`,
    // 1 = Sunday, not 0 = Sunday (p37). Off by one here mislabels every restriction on the card.
    label: DAY_NAMES[row.value.day] ?? `Day ${row.value.day}`,
    detail: `Blocked ${clockTime(row.value.beginTime)} to ${clockTime(row.value.endTime)}`,
    ...describeOrigin(row.origin),
  }));
}

/** One plain sentence above each table, so the source mode is never something to infer from badges. */
export function sourceSentence(noun: string, source: string | null, policyNumber: number | null): string {
  const policy = policyNumber ? `policy ${policyNumber}` : "the policy";
  switch (source) {
    case "CARD": return `${noun} come from the card only.`;
    case "POLICY": return `${noun} come from ${policy}.`;
    case "BOTH": return `${noun} come from both the card and ${policy}. Card settings win where they overlap.`;
    default: return `${noun} source is not reported by EFS.`;
  }
}

// ─── Write availability ────────────────────────────────────────────────────────────────────────

export interface AvailabilityNotice {
  /** `disabled` shows the panel greyed with an explanation; `hidden` removes it entirely. */
  mode: "available" | "disabled" | "hidden";
  message: string;
  /** Admin-only next step, when there is one. */
  actionTo?: string;
  actionLabel?: string;
}

/**
 * What to tell someone who cannot change this card.
 *
 * The distinction that matters: an entitlement we have not CHECKED yet is shown as a disabled panel
 * with an explanation, because the read layer ships first and the whole product story is "you will be
 * able to lock this card" — hiding the actions makes Phase A look like a dead end and generates
 * support tickets for a feature that is already built. A capability the person will NEVER have,
 * because of their role, is hidden instead: advertising it reads as a taunt.
 */
export function availability(capabilities: CardCapabilities, isAdmin: boolean): AvailabilityNotice {
  if (!capabilities.blockedBy) return { mode: "available", message: "" };

  const adminAction = isAdmin
    ? { actionTo: "/settings/card-control", actionLabel: "Open card control settings" }
    : {};

  switch (capabilities.blockedBy) {
    case "role":
    case "not_approver":
      return { mode: "hidden", message: "" };
    case "kill_switch":
      return { mode: "disabled", message: "Card actions are paused." };
    case "no_credentials":
      return { mode: "disabled", message: "EFS is not connected for this company.", ...adminAction };
    case "not_enabled":
      return { mode: "disabled", message: "Card actions are not switched on for this company.", ...adminAction };
    case "not_entitled":
      return capabilities.writeEntitlement === "denied"
        ? {
            mode: "disabled",
            message: "EFS has not enabled card changes for this account. Ask your WEX representative to add write access for the service account.",
          }
        : {
            mode: "disabled",
            message: "Card actions are not switched on yet. An admin needs to run the EFS write check.",
            ...adminAction,
          };
    default:
      return { mode: "disabled", message: "Card actions are unavailable." };
  }
}
