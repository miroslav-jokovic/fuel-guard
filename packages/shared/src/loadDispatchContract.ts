import { z } from "zod";
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
  driverId: z.uuid(),
});
export type DispatchLoadRequest = z.infer<typeof dispatchLoadRequestSchema>;

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

/** What the modal shows before Send: the exact text, and whether it would actually be texted. */
export interface LoadDispatchPreview {
  loadId: string;
  driverId: string;
  driverName: string;
  body: string;
  /** Null when a text would go out; otherwise why it will be recorded as not sent. */
  smsHeldBecause: LoadDispatchSmsReason | null;
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
