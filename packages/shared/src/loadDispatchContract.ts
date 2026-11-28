import { z } from "zod";
import { recordId } from "./recordId.js";
import { formatDisplayDateTime } from "./displayDate.js";

/**
 * The office sending a McLeod load to a driver (LOADS-MIRROR-PLAN.md LR-D2; D-LMR5, D-LMR6).
 *
 * The contract and the message live here rather than in the API because LR-D3's modal previews the
 * text before Send. A preview composed in the browser would read appointments on the viewer's clock
 * and could drift from what the server stores in `load_dispatches.body`, so the API composes it once,
 * with this function, for both the preview and the send.
 */

export const dispatchLoadRequestSchema = z.object({
  driverId: recordId(),
});
export type DispatchLoadRequest = z.infer<typeof dispatchLoadRequestSchema>;

/**
 * Whether the office may dispatch this load at all: a McLeod load that is still open. The API refuses
 * the rest (409), and the board and the load page offer the button on exactly the same rule — one
 * definition, so the button can never promise what the endpoint will refuse.
 */
export const DISPATCH_CLOSED_STATUSES = ["delivered", "canceled"] as const;
export function isDispatchable(load: { source: string; status: string }): boolean {
  return load.source === "tms" && !(DISPATCH_CLOSED_STATUSES as readonly string[]).includes(load.status);
}

export const LOAD_DISPATCH_CHANNELS = ["sms", "app"] as const;
export type LoadDispatchChannel = (typeof LOAD_DISPATCH_CHANNELS)[number];

export const LOAD_DISPATCH_OUTCOMES = ["sent", "not_sent", "failed"] as const;
export type LoadDispatchOutcome = (typeof LOAD_DISPATCH_OUTCOMES)[number];

/**
 * Why a dispatch was not texted. Stable codes, worded by the page.
 *
 *   sms_not_configured   — `SMS_PROVIDER=none`, or Telnyx without a key and a sender. Today's answer.
 *   no_dispatch_consent  — the provider IS configured, but no consent instrument covers a dispatch
 *                          text: the only one there is (`SMS_CONSENT`) is limited, in its own words, to
 *                          "messages about your own application". Q-LMR9 is the blocker.
 */
export const LOAD_DISPATCH_SMS_REASONS = ["sms_not_configured", "no_dispatch_consent"] as const;
export type LoadDispatchSmsReason = (typeof LOAD_DISPATCH_SMS_REASONS)[number];

export interface LoadDispatch {
  id: string;
  loadId: string;
  driverId: string;
  driverName: string;
  sentBy: string;
  sentAt: string;
  channel: LoadDispatchChannel;
  outcome: LoadDispatchOutcome;
  outcomeReason: string | null;
  body: string;
}

/**
 * A dispatch as the loads board and the load page read it (D-LMR7): "Sent to …" or "Not sent" is this,
 * never `loads.status`, which stays McLeod's. The board carries the load's current one; the load page
 * carries every one, newest first.
 */
export interface LoadDispatchSummary {
  id: string;
  driverId: string;
  driverName: string | null;
  sentAt: string;
  channel: LoadDispatchChannel;
  outcome: LoadDispatchOutcome;
  outcomeReason: string | null;
  /**
   * Who said "Got it" to THIS dispatch (0661 `acknowledged` events, one per dispatch per driver), oldest
   * first. Both seats of a team appear here once each, the McLeod co-driver too (O-3).
   */
  acknowledgements: DispatchAcknowledgement[];
  /**
   * Everybody this dispatch shows the load to (`dispatchSeats`, 0655's O-3 rule): the dispatched driver,
   * and McLeod's co-driver when the dispatch names McLeod's driver. The team form of "Seen" reads it.
   */
  seats: { driverId: string; driverName: string | null }[];
  /** Whether anybody can see this load in the app now — derived, never stored (`dispatchReachable`). */
  reachable: DispatchReach;
  /** McLeod seats somebody else on the load (`dispatchSeatNote`); the dispatch still decides (D-LMR6). */
  seatNote: DispatchSeatNote;
  /**
   * When the dispatched driver's phone last reached us about this load (D-MK22): the later of their
   * newest event on this load and their app's last check-in (`device_push_tokens.last_seen_at`). Null
   * when neither exists. `phoneSilentSince` decides whether the office is told.
   */
  lastContactAt: string | null;
}

export interface DispatchAcknowledgement {
  driverId: string;
  driverName: string | null;
  at: string;
}

/**
 * Why a sent load is in nobody's app (T1 N-9, cD DR-14 re-derived against 0655):
 *   no_app_login        — the dispatched driver has no active app login. The commonest case today
 *                         (production 2026-11-27: 1 of 195 active drivers has one);
 *   uncovered_in_mcleod — McLeod has the load at `draft` (uncovered), the one status 0655 shows nobody;
 *   closed              — McLeod closed the load.
 */
export const DISPATCH_UNREACHABLE_REASONS = ["no_app_login", "uncovered_in_mcleod", "closed"] as const;
export type DispatchUnreachableReason = (typeof DISPATCH_UNREACHABLE_REASONS)[number];
export type DispatchReach = { ok: true } | { ok: false; reason: DispatchUnreachableReason };
export type DispatchSeatNote = "mcleod_seats_someone_else" | null;

/**
 * Whether a driver has a login the app can reach — the predicate Send uses to choose the `app`
 * channel (#2689) and the office uses to say "not in their app". One definition for both.
 */
export function driverHasAppLogin(driver: { user_id: string | null; app_access_enabled: boolean | null } | null): boolean {
  return driver !== null && driver.user_id != null && driver.app_access_enabled === true;
}

/** Whether a dispatch reaches an app now. Order matters: a closed load is closed whoever holds it. */
export function dispatchReachable(
  load: { status: string; external_closed_at: string | null },
  driver: { user_id: string | null; app_access_enabled: boolean | null } | null,
): DispatchReach {
  if (load.external_closed_at) return { ok: false, reason: "closed" };
  if (load.status === "draft") return { ok: false, reason: "uncovered_in_mcleod" };
  if (!driverHasAppLogin(driver)) return { ok: false, reason: "no_app_login" };
  return { ok: true };
}

/**
 * The office sent the load to a driver McLeod does not seat on it (neither `driver_id` nor
 * `co_driver_id`), e.g. after a repower nobody keyed into McLeod. 0655 still shows them the load; the
 * office should know McLeod disagrees.
 */
export function dispatchSeatNote(
  load: { driver_id: string | null; co_driver_id: string | null },
  dispatchedDriverId: string,
): DispatchSeatNote {
  return load.driver_id === dispatchedDriverId || load.co_driver_id === dispatchedDriverId ? null : "mcleod_seats_someone_else";
}

/** The drivers a dispatch shows the load to — 0655's rule (`driver_visible_tms_load_ids`), in TypeScript only for the office's words. */
export function dispatchSeats(
  load: { driver_id: string | null; co_driver_id: string | null },
  dispatchedDriverId: string,
): string[] {
  const co = load.co_driver_id;
  return co && load.driver_id === dispatchedDriverId && co !== dispatchedDriverId ? [dispatchedDriverId, co] : [dispatchedDriverId];
}

/** How long a phone may be quiet on an active load before the office is told (D-MK22). */
export const PHONE_SILENT_MINUTES = 60;
const PHONE_WATCH_STATUSES: readonly string[] = ["pending_approval", "approved", "in_transit"];

/**
 * The instant to show in "Driver's phone last reached us at …", or null when the office is not told:
 * only for a load still open in McLeod whose current dispatch reaches an app, when the phone has been
 * quiet for more than an hour. A phone that never reached us has no time to show — the load page says
 * "not seen" through the acknowledgement line instead.
 */
export function phoneSilentSince(
  load: { status: string },
  current: Pick<LoadDispatchSummary, "reachable" | "lastContactAt"> | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!current || !current.reachable.ok || !current.lastContactAt) return null;
  if (!PHONE_WATCH_STATUSES.includes(load.status)) return null;
  const at = Date.parse(current.lastContactAt);
  return Number.isFinite(at) && now - at > PHONE_SILENT_MINUTES * 60_000 ? current.lastContactAt : null;
}

/** What the modal shows before Send: the exact text, and whether it would actually be texted. */
export interface LoadDispatchPreview {
  loadId: string;
  driverId: string;
  driverName: string;
  body: string;
  /** Null when a text would go out; otherwise why it will be recorded as not sent. */
  smsHeldBecause: LoadDispatchSmsReason | null;
  /**
   * Whether Send puts the load in the driver's app (DRIVER-APP-ENTERPRISE-PLAN S1.1): true when the
   * driver has an active app login (`drivers.user_id` with `app_access_enabled`). Then the dispatch is
   * recorded on the `app` channel as `sent` — the load is in their app from that moment (0655), and a
   * "New load" notification goes to them and to the McLeod co-driver. False → the `sms` record as before.
   */
  inApp: boolean;
  /** `uncovered_in_mcleod` when nobody will see the load whoever it is sent to; else the same as `inApp`. */
  reachable: DispatchReach;
  seatNote: DispatchSeatNote;
}

export interface DispatchSmsStop {
  seq: number;
  kind: "pickup" | "dropoff";
  name: string;
  city: string | null;
  state: string | null;
  appointmentStart: string | null;
}

export interface DispatchSmsInput {
  carrierName: string;
  loadRef: string;
  truck: string | null;
  trailer: string | null;
  stops: DispatchSmsStop[];
  /** The carrier's zone (`organizations.operating_hours->>'tz'`) — never the server's, never the viewer's. */
  timeZone: string;
}

/**
 * The text a driver receives.
 *
 * ASCII only, on purpose: one character outside the GSM-7 alphabet (an em dash, a curly quote) makes
 * the carrier re-encode the whole message as UCS-2, which halves a segment from 160 characters to 70
 * and triples what a four-line load sheet costs. The first pickup and the last delivery are named;
 * anything between them is counted, because a driver reads the rest in the app or asks.
 */
export function composeLoadDispatchSms(input: DispatchSmsInput): string {
  const ordered = [...input.stops].sort((a, b) => a.seq - b.seq);
  const pickup = ordered.find((s) => s.kind === "pickup") ?? null;
  const delivery = [...ordered].reverse().find((s) => s.kind === "dropoff") ?? null;
  const others = ordered.filter((s) => s !== pickup && s !== delivery).length;

  const place = (s: DispatchSmsStop): string => {
    const where = [s.city, s.state].filter(Boolean).join(" ");
    const when = formatDisplayDateTime(s.appointmentStart, "no appointment", input.timeZone);
    return `${[s.name, where].filter(Boolean).join(", ")}, ${when}`;
  };
  const equipment = [input.truck ? `Truck ${input.truck}` : null, input.trailer ? `trailer ${input.trailer}` : null]
    .filter(Boolean)
    .join(", ");

  return [
    `${input.carrierName}: load ${input.loadRef}`,
    equipment || null,
    pickup ? `Pick up: ${place(pickup)}` : null,
    delivery ? `Deliver: ${place(delivery)}` : null,
    others > 0 ? `+${others} more stop${others === 1 ? "" : "s"}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
