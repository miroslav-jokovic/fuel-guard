import { describe, it, expect, vi, afterEach } from "vitest";
import { inboundSmsLine, sendSms, smsConfigured, parseTelnyxDeliveryReceipt, parseTelnyxInboundSms, redactNumber } from "./sms.js";
import { testEnv } from "../testing/testEnv.js";

const configured = testEnv({
  SMS_PROVIDER: "telnyx",
  TELNYX_API_KEY: "KEY-test",
  TELNYX_FROM: "+15550001111",
});

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

describe("sendSms", () => {
  it("posts the Telnyx v2 message shape and returns the provider's id", async () => {
    const fetchFn = stubFetch(200, { data: { id: "msg-1" } });

    const result = await sendSms(configured, { to: "+15559998888", body: "Hi from Silvicom" });

    expect(result).toEqual({ ok: true, provider: "telnyx", status: 200, detail: undefined, messageId: "msg-1" });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.telnyx.com/v2/messages");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer KEY-test");
    // `text` and `from`, not Twilio's `Body` and `From` — the shape is the thing under test.
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      from: "+15550001111",
      to: "+15559998888",
      text: "Hi from Silvicom",
    });
  });

  it("sends from a messaging profile when no number is pinned", async () => {
    const fetchFn = stubFetch(200, { data: { id: "msg-2" } });
    const env = testEnv({ SMS_PROVIDER: "telnyx", TELNYX_API_KEY: "KEY-test", TELNYX_MESSAGING_PROFILE_ID: "mp-1" });

    await sendSms(env, { to: "+15559998888", body: "x" });

    expect(JSON.parse((fetchFn.mock.calls[0]![1] as { body: string }).body).messaging_profile_id).toBe("mp-1");
  });

  // The state the account is actually in on 2026-09-06: key valid, zero numbers, zero profiles. A
  // send must be a clean no-op rather than a request that cannot name a sender.
  it("is a no-op when the account has no number and no messaging profile", async () => {
    const fetchFn = stubFetch(200, {});
    const env = testEnv({ SMS_PROVIDER: "telnyx", TELNYX_API_KEY: "KEY-test" });

    const result = await sendSms(env, { to: "+15559998888", body: "x" });

    expect(result).toEqual({ ok: false, provider: "none", detail: "No SMS provider configured" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("is a no-op while the provider is off, whatever else is configured", async () => {
    const fetchFn = stubFetch(200, {});
    const result = await sendSms(testEnv({ TELNYX_API_KEY: "KEY-test", TELNYX_FROM: "+1" }), {
      to: "+15559998888",
      body: "x",
    });
    expect(result.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // The recruiting number is verified with the mobile carriers for applicant texts only (2026-11-13),
  // so an office alert has a number of its own and there is no road from one to the other.
  describe("the staff-alert line", () => {
    const both = testEnv({ SMS_PROVIDER: "telnyx", TELNYX_API_KEY: "KEY-test", TELNYX_FROM: "+15550001111", TELNYX_ALERTS_FROM: "+15550002222" });

    it("sends an office alert from the alert number, and an applicant text from the recruiting one", async () => {
      const fetchFn = stubFetch(200, { data: { id: "msg-3" } });
      await sendSms(both, { to: "+15559998888", body: "alert", line: "staff_alerts" });
      await sendSms(both, { to: "+15559998888", body: "applicant" });
      const from = (n: number) => JSON.parse((fetchFn.mock.calls[n]![1] as { body: string }).body).from;
      expect([from(0), from(1)]).toEqual(["+15550002222", "+15550001111"]);
    });

    it("sends from the alert line's messaging profile when it has no pinned number", async () => {
      const fetchFn = stubFetch(200, { data: { id: "msg-4" } });
      const env = testEnv({ SMS_PROVIDER: "telnyx", TELNYX_API_KEY: "KEY-test", TELNYX_FROM: "+15550001111", TELNYX_ALERTS_MESSAGING_PROFILE_ID: "mp-alerts" });
      await sendSms(env, { to: "+15559998888", body: "alert", line: "staff_alerts" });
      expect(JSON.parse((fetchFn.mock.calls[0]![1] as { body: string }).body)).toEqual({ messaging_profile_id: "mp-alerts", to: "+15559998888", text: "alert" });
    });

    it("never falls back to the recruiting number: with no alert sender an alert text is a no-op and the line reads not configured", async () => {
      const fetchFn = stubFetch(200, {});
      expect(smsConfigured(configured)).toBe(true);
      expect(smsConfigured(configured, "staff_alerts")).toBe(false);
      expect(await sendSms(configured, { to: "+15559998888", body: "alert", line: "staff_alerts" })).toEqual({ ok: false, provider: "none", detail: "No SMS provider configured" });
      expect(fetchFn).not.toHaveBeenCalled();
      // …and the other way round: an alert number alone does not make applicant texts sendable.
      const alertsOnly = testEnv({ SMS_PROVIDER: "telnyx", TELNYX_API_KEY: "KEY-test", TELNYX_ALERTS_FROM: "+15550002222" });
      expect([smsConfigured(alertsOnly), smsConfigured(alertsOnly, "staff_alerts")]).toEqual([false, true]);
    });
  });

  it("surfaces a Telnyx error without putting the message body in the log", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(422, { errors: [{ title: "Invalid destination", detail: "Not a valid number" }] });

    const result = await sendSms(configured, { to: "+15559998888", body: "names a driver" });

    expect(result.ok).toBe(false);
    expect(result.detail).toBe("Invalid destination: Not a valid number");
    const logged = err.mock.calls[0]![0] as string;
    expect(logged).not.toContain("names a driver");
    expect(logged).toContain(redactNumber("+15559998888"));
    err.mockRestore();
  });
});

describe("parseTelnyxInboundSms", () => {
  const received = (text: string) => ({
    data: {
      event_type: "message.received",
      payload: { from: { phone_number: "+15559998888" }, to: [{ phone_number: "+15550001111" }], text },
    },
  });

  it("reads the sender out of Telnyx's nested shape", () => {
    expect(parseTelnyxInboundSms(received("STOP"))).toEqual({
      isInbound: true,
      from: "+15559998888",
      text: "STOP",
      to: "+15550001111",
      messagingProfileId: "",
    });
  });

  it("reads which of our numbers was texted, and the profile it arrived on", () => {
    const body = received("HELP");
    (body.data.payload as Record<string, unknown>).messaging_profile_id = "mp-9";
    expect(parseTelnyxInboundSms(body)).toMatchObject({ to: "+15550001111", messagingProfileId: "mp-9" });
    expect(parseTelnyxInboundSms({ data: { event_type: "message.received", payload: { from: { phone_number: "+15559998888" }, text: "x" } } })).toMatchObject({ isInbound: true, to: "", messagingProfileId: "" });
  });

  // The dangerous one. `message.sent` carries a `from` too — our own number — so a parser that keyed
  // on the presence of a sender would read our outbound message back as an inbound opt-out and
  // revoke the consent it had just used.
  it("does not read our own outbound message back as an inbound one", () => {
    const outbound = { ...received("STOP"), data: { ...received("STOP").data, event_type: "message.sent" } };
    expect(parseTelnyxInboundSms(outbound).isInbound).toBe(false);
  });

  it("treats a delivery receipt or junk as not-a-message rather than an empty one", () => {
    expect(parseTelnyxInboundSms({ data: { event_type: "message.finalized" } }).isInbound).toBe(false);
    expect(parseTelnyxInboundSms(null).isInbound).toBe(false);
    expect(parseTelnyxInboundSms({}).isInbound).toBe(false);
  });
});

describe("inboundSmsLine — a reply is about the number it was sent to", () => {
  const env = testEnv({ SMS_PROVIDER: "telnyx", TELNYX_API_KEY: "KEY-test", TELNYX_FROM: "+15550001111", TELNYX_ALERTS_FROM: "+15550002222" });

  it("is the staff-alert line for a text to the alert number, however the number is written", () => {
    expect(inboundSmsLine(env, { to: "+15550002222", messagingProfileId: "" })).toBe("staff_alerts");
    expect(inboundSmsLine(env, { to: "+1 (555) 000-2222", messagingProfileId: "" })).toBe("staff_alerts");
  });

  it("is the applicant line for the recruiting number, for an unknown number, and whenever no alert sender is set", () => {
    expect(inboundSmsLine(env, { to: "+15550001111", messagingProfileId: "" })).toBe("applicants");
    expect(inboundSmsLine(env, { to: "", messagingProfileId: "" })).toBe("applicants");
    expect(inboundSmsLine(configured, { to: "+15550002222", messagingProfileId: "mp-1" })).toBe("applicants");
    // An unset alert number is not "every number": an inbound with no `to` must not match it.
    expect(inboundSmsLine(testEnv({ TELNYX_ALERTS_MESSAGING_PROFILE_ID: "mp-alerts" }), { to: "", messagingProfileId: "" })).toBe("applicants");
  });

  it("goes by the alert line's own messaging profile when that is what it sends from — but not by a profile both lines share", () => {
    const byProfile = testEnv({ TELNYX_MESSAGING_PROFILE_ID: "mp-1", TELNYX_ALERTS_MESSAGING_PROFILE_ID: "mp-alerts" });
    expect(inboundSmsLine(byProfile, { to: "+15550003333", messagingProfileId: "mp-alerts" })).toBe("staff_alerts");
    expect(inboundSmsLine(byProfile, { to: "+15550003333", messagingProfileId: "mp-1" })).toBe("applicants");
    const shared = testEnv({ TELNYX_MESSAGING_PROFILE_ID: "mp-1", TELNYX_ALERTS_MESSAGING_PROFILE_ID: "mp-1" });
    expect(inboundSmsLine(shared, { to: "+15550001111", messagingProfileId: "mp-1" })).toBe("applicants");
  });
});

describe("parseTelnyxDeliveryReceipt (A-11, C2d)", () => {
  const finalized = (to: unknown, id: unknown = "tx-1") => ({ data: { event_type: "message.finalized", payload: { id, to } } });

  it("reads the message id and the first recipient's final status", () => {
    expect(parseTelnyxDeliveryReceipt(finalized([{ status: "delivered" }]))).toEqual({ messageId: "tx-1", status: "delivered" });
  });

  it("is not a receipt for any other event, or without an id or a status", () => {
    expect(parseTelnyxDeliveryReceipt({ data: { event_type: "message.sent", payload: { id: "tx-1", to: [{ status: "queued" }] } } })).toBeNull();
    expect(parseTelnyxDeliveryReceipt({ data: { event_type: "message.received", payload: { id: "tx-1" } } })).toBeNull();
    expect(parseTelnyxDeliveryReceipt(finalized([{ status: "delivered" }], null))).toBeNull();
    expect(parseTelnyxDeliveryReceipt(finalized([]))).toBeNull();
    expect(parseTelnyxDeliveryReceipt(null)).toBeNull();
  });
});
