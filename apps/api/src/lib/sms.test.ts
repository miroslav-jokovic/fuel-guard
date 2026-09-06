import { describe, it, expect, vi, afterEach } from "vitest";
import { sendSms, parseTelnyxInboundSms, redactNumber } from "./sms.js";
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
    });
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
