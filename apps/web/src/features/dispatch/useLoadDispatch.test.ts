import { describe, it, expect } from "vitest";
import type { LoadDispatchSummary } from "@silvicom/shared";
import { dispatchHeadline, dispatchReachText, dispatchSeenText, phoneSilentText, seatNoteText, smsReasonText } from "./useLoadDispatch";
import { QUEUE_TABS, inQueue, type DispatchLoad } from "./useDispatchLoads";

/**
 * The words the board and the load page use for a dispatch (LR-D3, D-LMR7). The one that matters:
 * nothing reads "Sent" while no text has gone out.
 */
const d: LoadDispatchSummary = {
  id: "x",
  driverId: "d",
  driverName: "Dana Kelly",
  sentAt: "2026-09-24T15:14:00Z",
  channel: "sms",
  outcome: "not_sent",
  outcomeReason: "sms_not_configured",
  acknowledgements: [],
  seats: [{ driverId: "d", driverName: "Dana Kelly" }],
  reachable: { ok: false, reason: "no_app_login" },
  seatNote: null,
  lastContactAt: null,
};

describe("dispatch wording", () => {
  it("says dispatched, to whom, and when — never 'sent'", () => {
    expect(dispatchHeadline(d)).toMatch(/^Dispatched to Dana Kelly · \d{2}\/\d{2}\/2026 \d{1,2}:\d{2} [AP]M$/);
    expect(dispatchHeadline(d)).not.toMatch(/sent/i);
    expect(dispatchHeadline(null)).toBe("Not dispatched");
    // S1.1: only an app dispatch is in the driver's hands, and only then does the headline say so.
    expect(dispatchHeadline({ ...d, channel: "app", outcome: "sent", outcomeReason: null })).toContain("Dana Kelly · in their app ·");
  });

  it("names a driver who has left the roster rather than showing nothing", () => {
    expect(dispatchHeadline({ ...d, driverName: null })).toContain("a driver no longer on the roster");
  });

  it("words each stable reason, and shows an unknown one as it is", () => {
    expect(smsReasonText("sms_not_configured")).toBe("Text messages aren't set up yet, so no text was sent.");
    expect(smsReasonText("no_dispatch_consent")).toContain("haven't agreed to receive dispatch texts");
    expect(smsReasonText("telnyx_40001")).toBe("No text was sent (telnyx_40001).");
    expect(smsReasonText(null)).toBeNull();
  });
});

describe("what the office sees after Send (T1 N-9)", () => {
  const app: LoadDispatchSummary = { ...d, channel: "app", outcome: "sent", outcomeReason: null, reachable: { ok: true } };
  const STAMP = /\d{2}\/\d{2}\/2026 \d{1,2}:\d{2} [AP]M/;

  it("a dispatch seen by its driver says Seen with the time", () => {
    const seen = { ...app, acknowledgements: [{ driverId: "d", driverName: "Dana Kelly", at: "2026-11-27T15:14:00Z" }] };
    expect(dispatchSeenText(seen)).toMatch(new RegExp(`^Seen ${STAMP.source}$`));
    expect(dispatchHeadline(seen)).toMatch(new RegExp(`in their app · ${STAMP.source} · Seen ${STAMP.source}$`));
    expect(dispatchHeadline(app)).not.toContain("Seen");
  });

  it("a team dispatch names who has seen it and who has not", () => {
    const team = {
      ...app,
      seats: [{ driverId: "d", driverName: "Dana Kelly" }, { driverId: "c", driverName: "Luis Ortega" }],
      acknowledgements: [{ driverId: "c", driverName: "Luis Ortega", at: "2026-11-27T15:14:00Z" }],
    };
    expect(dispatchSeenText(team)).toMatch(new RegExp(`^Seen by Luis Ortega ${STAMP.source}; Dana Kelly not yet$`));
    // Nobody yet: no "Seen" line at all rather than "Dana Kelly not yet; Luis Ortega not yet".
    expect(dispatchSeenText({ ...team, acknowledgements: [] })).toBeNull();
  });

  it("says why a sent load is in nobody's app, and McLeod's other seat", () => {
    expect(dispatchReachText(d.reachable, "Dixon Ruiz")).toBe("Not in Dixon Ruiz's app — no app login");
    expect(dispatchReachText({ ok: false, reason: "uncovered_in_mcleod" }, "Dixon Ruiz")).toContain("McLeod has it uncovered");
    expect(dispatchReachText({ ok: true }, "Dixon Ruiz")).toBeNull();
    expect(seatNoteText("mcleod_seats_someone_else")).toContain("McLeod has somebody else on this load");
    expect(seatNoteText(null)).toBeNull();
  });

  it("tells the office a phone has been quiet for over an hour on an open load, and only then", () => {
    const now = Date.parse("2026-11-27T16:30:00Z");
    const quiet = { ...app, lastContactAt: "2026-11-27T15:05:00Z" };
    expect(phoneSilentText({ status: "in_transit" }, quiet, now)).toMatch(new RegExp(`^Driver's phone last reached us at ${STAMP.source}$`));
    expect(phoneSilentText({ status: "in_transit" }, { ...quiet, lastContactAt: "2026-11-27T16:00:00Z" }, now)).toBeNull();
    expect(phoneSilentText({ status: "delivered" }, quiet, now)).toBeNull();
    // A driver with no app login is the reach line's to explain, not a "quiet phone".
    expect(phoneSilentText({ status: "in_transit" }, { ...quiet, reachable: { ok: false, reason: "no_app_login" } }, now)).toBeNull();
  });
});

describe("the board's queues (LR7)", () => {
  const load = (status: string, extra: Record<string, unknown> = {}) =>
    ({ status, source: "tms", stops: [], ...extra }) as unknown as DispatchLoad;

  it("opens on In transit and offers In transit, Upcoming, Uncovered, Delivered, All and Exceptions, with no approval queue", () => {
    expect(QUEUE_TABS.map((t) => t.value)).toEqual(["in_transit", "upcoming", "uncovered", "delivered", "all", "exceptions"]);
    expect(QUEUE_TABS.map((t) => t.label).join(" ")).not.toMatch(/approv/i);
  });

  it("files a load where the shared rule words it: an A with driver and truck is Upcoming, without is Uncovered", () => {
    expect(inQueue(load("pending_approval", { driver_id: "d", vehicle_id: "v" }), "upcoming")).toBe(true);
    expect(inQueue(load("pending_approval", { driver_id: "d" }), "uncovered")).toBe(true);
    expect(inQueue(load("in_transit"), "in_transit")).toBe(true);
    expect(inQueue(load("in_transit"), "upcoming")).toBe(false);
    expect(inQueue(load("delivered"), "delivered")).toBe(true);
  });

  it("keeps a canceled load in All only", () => {
    const voided = load("canceled");
    expect(["in_transit", "upcoming", "uncovered", "delivered"].some((q) => inQueue(voided, q as never))).toBe(false);
    expect(inQueue(voided, "all")).toBe(true);
  });
});
