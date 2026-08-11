import {
  type CardCapabilities,
  type EffectiveOrigin,
  EFS_CARD_STATUS_LABELS,
  type EfsCardStatus,
  formatLimit,
  infoLabel,
  limitLabel,
  canonicalEfsStatus,
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
  // Through canonicalEfsStatus, because a production account reports ACTIVE/INACTIVE/HOLD while the
  // guide documents Active/Inactive/Hold. Switching on the raw text gave every card a neutral badge.
  switch (canonicalEfsStatus(status)) {
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
  status ? (EFS_CARD_STATUS_LABELS[canonicalEfsStatus(status) as EfsCardStatus] ?? status) : "Unknown";

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

// ─── Phase B: the confirmation copy ────────────────────────────────────────────────────────────

/**
 * The sentence an operator reads before a card changes.
 *
 * PURE, and in this file rather than in the component, for one reason: this text is the last thing
 * standing between somebody and a real consequence at a real pump, and it should be readable, and
 * reviewable, and testable, without mounting a drawer. `cardControlModel.test.ts` asserts the ones
 * that name numbers — an override confirmation that says "2 purchases" when it will grant 3 is worse
 * than no confirmation at all.
 *
 * Every body says what happens to the DRIVER, not what happens to the record. "The card stops working
 * at every location immediately" is actionable; "status will be set to Hold" is a field name.
 */
export interface CardConfirmation {
  tone: "danger" | "warning";
  title: string;
  body: string;
  confirmLabel: string;
  /** Present tense for the button while the vendor call is in flight. */
  busyLabel: string;
  /** The toast title on success. */
  doneLabel: string;
}

export const lockConfirmation = (status: "Hold" | "Inactive"): CardConfirmation =>
  status === "Inactive"
    ? {
        tone: "danger",
        title: "Deactivate this card?",
        body:
          "The card stops working at every location immediately, and deactivating is how a card is retired rather than paused. " +
          "Fuel purchases will decline until somebody activates it again.",
        confirmLabel: "Deactivate card",
        busyLabel: "Deactivating…",
        doneLabel: "Card deactivated",
      }
    : {
        tone: "danger",
        title: "Lock this card?",
        body:
          "The card stops working at every location immediately. Fuel purchases will decline until you unlock it.",
        confirmLabel: "Lock card",
        busyLabel: "Locking…",
        doneLabel: "Card locked",
      };

export const unlockConfirmation = (wasFraud: boolean): CardConfirmation => ({
  tone: wasFraud ? "danger" : "warning",
  title: wasFraud ? "Unlock a card flagged for fraud?" : "Unlock this card?",
  body: wasFraud
    // Somebody — WEX, or this product's own detection — decided this card was being abused. Releasing
    // it is not the reversible safety action a lock is, and the copy should not pretend otherwise.
    ? "This card is flagged for fraud. Unlocking it lets fuel purchases go through again at every location it is allowed to use. Confirm your password to continue."
    : "Fuel purchases will go through again at every location this card is allowed to use.",
  confirmLabel: "Unlock card",
  busyLabel: "Unlocking…",
  doneLabel: "Card unlocked",
});

/**
 * The override confirmation NAMES THE NUMBERS. "This card will be allowed 2 purchases outside its
 * normal limits at Loves station 442, Effingham IL." A generic "grant an override?" is how somebody grants
 * nine when they meant one.
 */
export function overrideConfirmation(uses: number, locationLabel: string | null): CardConfirmation {
  const where = locationLabel ? `at ${locationLabel}` : "at any location";
  const purchases = uses === 1 ? "1 purchase" : `${uses} purchases`;
  return {
    tone: "warning",
    title: "Grant a fuel exception?",
    body:
      `This card will be allowed ${purchases} outside its normal limits ${where}. ` +
      "The exception is used up automatically — it does not need to be revoked.",
    confirmLabel: "Grant exception",
    busyLabel: "Granting…",
    doneLabel: "Exception granted",
  };
}

export const clearOverrideConfirmation = (): CardConfirmation => ({
  tone: "warning",
  title: "Remove the exception?",
  body: "The card goes back to its normal limits immediately. Any unused exceptions are cancelled.",
  confirmLabel: "Remove exception",
  busyLabel: "Removing…",
  doneLabel: "Exception removed",
});

export const promptsConfirmation = (removesDriverId: boolean): CardConfirmation =>
  removesDriverId
    ? {
        tone: "danger",
        title: "Stop asking who is fueling?",
        body:
          "The pump will stop checking a Driver ID on this card. Anyone holding it can fuel, and FuelGuard loses its strongest signal for attributing a fill to a driver. " +
          "Confirm your password to continue.",
        confirmLabel: "Remove Driver ID prompt",
        busyLabel: "Saving…",
        doneLabel: "Prompts updated",
      }
    : {
        tone: "warning",
        title: "Change what the pump asks for?",
        body: "Drivers will be prompted for exactly these values at the pump the next time they fuel with this card.",
        confirmLabel: "Save prompts",
        busyLabel: "Saving…",
        doneLabel: "Prompts updated",
      };

// ─── Phase B: what an outcome MEANS ────────────────────────────────────────────────────────────

export interface OutcomeNotice {
  kind: "success" | "warning" | "error";
  title: string;
  message?: string;
}

/**
 * Turn a recorded outcome into what the operator is told.
 *
 * The API answers 200 for every RECORDED outcome, including the ones that did not work — the request
 * succeeded, we asked EFS and wrote down the answer. So "did the card change?" is read from `status`,
 * never from the HTTP code, and three of the four answers are not "it worked":
 *
 *   succeeded      → say so plainly.
 *   drift_detected → it worked AND something else moved. Not an error; a thing to go and look at.
 *   failed         → EFS refused. Quote the vendor's own words; they carry the reference WEX asks for.
 *   sent           → WE DO NOT KNOW. The one outcome that must never be dressed up as either.
 */
export function outcomeNotice(
  outcome: { status: string; driftFields?: string[]; faultMessage?: string | null },
  doneLabel: string,
): OutcomeNotice {
  switch (outcome.status) {
    case "succeeded":
      return { kind: "success", title: doneLabel };
    case "drift_detected":
      return {
        kind: "warning",
        title: `${doneLabel} — with other changes`,
        message:
          "Something else on this card changed at the same time" +
          ((outcome.driftFields?.length ?? 0) > 0
            ? ` (${outcome.driftFields!.map((f) => f.replace(/^\//, "")).join(", ")}).`
            : ".") +
          " EFS is the source of truth and the card page now shows what it reports.",
      };
    case "sent":
      return {
        kind: "warning",
        title: "Sent, but not confirmed",
        message:
          "The change was sent to EFS and we could not confirm what happened. Check the card in the WEX portal before trying again — retrying could apply it twice.",
      };
    default:
      return {
        kind: "error",
        title: "EFS refused the change",
        message: outcome.faultMessage ?? "The card was not changed.",
      };
  }
}
