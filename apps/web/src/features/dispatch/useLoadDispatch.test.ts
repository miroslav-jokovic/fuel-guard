import { describe, it, expect } from "vitest";
import type { LoadDispatchSummary } from "@silvicom/shared";
import { dispatchHeadline, smsReasonText } from "./useLoadDispatch";
import { availableActions, type DispatchLoad } from "./useDispatchLoads";

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
};

describe("dispatch wording", () => {
  it("says dispatched, to whom, and when — never 'sent'", () => {
    expect(dispatchHeadline(d)).toMatch(/^Dispatched to Dana Kelly · \d{2}\/\d{2}\/2026 \d{1,2}:\d{2} [AP]M$/);
    expect(dispatchHeadline(d)).not.toMatch(/sent/i);
    expect(dispatchHeadline(null)).toBe("Not dispatched");
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

describe("availableActions", () => {
  const approved = (source: string) =>
    ({ status: "approved", source, stops: [], driver_id: "d", vehicle_id: "v" }) as unknown as DispatchLoad;
  it("no longer offers Release on a McLeod load — Dispatch reaches the driver since 0371", () => {
    expect(availableActions(approved("tms")).release).toBe(false);
    expect(availableActions(approved("manual")).release).toBe(true);
  });
});
