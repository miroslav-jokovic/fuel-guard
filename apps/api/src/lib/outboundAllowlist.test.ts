import { describe, it, expect, vi, afterEach } from "vitest";
import { outboundAllowed, partitionRecipients, WITHHELD_DETAIL } from "./outboundAllowlist.js";
import { sendEmail } from "./mailer.js";
import { sendSms } from "./sms.js";
import { testEnv } from "../testing/testEnv.js";
import { loadEnv } from "../env.js";

// Through the real parser, so the comma/space/case handling of the variable is what is under test.
const staging = loadEnv({
  NODE_ENV: "test",
  OUTBOUND_ALLOWLIST: " Tester@example.com, @example.org,+1 (312) 555-0123 ,",
} as NodeJS.ProcessEnv);
const production = testEnv({});

function stubFetch() {
  const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { id: "m" } }) });
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

describe("outboundAllowed", () => {
  it("allows everything when OUTBOUND_ALLOWLIST is unset, which is production", () => {
    expect(production.OUTBOUND_ALLOWLIST).toBeNull();
    expect(loadEnv({ NODE_ENV: "test", OUTBOUND_ALLOWLIST: "  " } as NodeJS.ProcessEnv).OUTBOUND_ALLOWLIST).toBeNull();
    expect(outboundAllowed(production, "anyone@example.com")).toBe(true);
    expect(outboundAllowed(production, "+15559998888")).toBe(true);
  });

  it("allows an exact email and a whole domain, case-insensitively, and nothing else", () => {
    expect(outboundAllowed(staging, "Tester@Example.com")).toBe(true);
    expect(outboundAllowed(staging, "anyone@example.org")).toBe(true);
    expect(outboundAllowed(staging, "dispatch@example.com")).toBe(false);
    expect(outboundAllowed(staging, "applicant@gmail.com")).toBe(false);
  });

  it("matches a number on its digits, so a formatted entry matches the E.164 the sender holds", () => {
    expect(outboundAllowed(staging, "+13125550123")).toBe(true);
    expect(outboundAllowed(staging, "+13125550124")).toBe(false);
  });

  it("never lets an email entry admit a number or a number entry admit an email", () => {
    expect(outboundAllowed(testEnv({ OUTBOUND_ALLOWLIST: ["@x.com"] }), "+13125550123")).toBe(false);
    expect(outboundAllowed(testEnv({ OUTBOUND_ALLOWLIST: ["+13125550123"] }), "13125550123@x.com")).toBe(false);
    // An all-digit mailbox reduces to the same digits as a bare number; it must still not admit one.
    expect(outboundAllowed(testEnv({ OUTBOUND_ALLOWLIST: ["13125550123@x.com"] }), "13125550123")).toBe(false);
  });

  it("splits recipients and counts the withheld ones", () => {
    expect(partitionRecipients(staging, ["tester@example.com", "a@gmail.com", "b@gmail.com"])).toEqual({
      allowed: ["tester@example.com"],
      withheld: 2,
    });
  });
});

describe("the transports honour it", () => {
  const brevo = { MAIL_PROVIDER: "brevo" as const, BREVO_API_KEY: "k", MAIL_FROM: "S <s@example.com>" };
  const telnyx = { SMS_PROVIDER: "telnyx" as const, TELNYX_API_KEY: "k", TELNYX_FROM: "+15550001111" };

  it("sendEmail delivers only to the allowed recipients", async () => {
    const fetchFn = stubFetch();
    const env = testEnv({ ...brevo, OUTBOUND_ALLOWLIST: ["tester@example.com"] });
    const r = await sendEmail(env, { to: ["tester@example.com", "applicant@gmail.com"], subject: "s", html: "h", text: "t" });
    expect(r.ok).toBe(true);
    expect(JSON.parse((fetchFn.mock.calls[0]![1] as { body: string }).body).to).toEqual([{ email: "tester@example.com" }]);
  });

  it("sendEmail calls no provider and reports a failure when every recipient is withheld", async () => {
    const fetchFn = stubFetch();
    const env = testEnv({ ...brevo, OUTBOUND_ALLOWLIST: ["tester@example.com"] });
    const r = await sendEmail(env, { to: ["applicant@gmail.com"], subject: "s", html: "h", text: "t" });
    expect(r).toEqual({ ok: false, provider: "none", detail: WITHHELD_DETAIL });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sendSms calls no provider for a number off the list", async () => {
    const fetchFn = stubFetch();
    const env = testEnv({ ...telnyx, OUTBOUND_ALLOWLIST: ["+13125550123"] });
    expect(await sendSms(env, { to: "+15559998888", body: "x" })).toEqual({
      ok: false,
      provider: "none",
      detail: WITHHELD_DETAIL,
    });
    expect(fetchFn).not.toHaveBeenCalled();
    await sendSms(env, { to: "+13125550123", body: "x" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
