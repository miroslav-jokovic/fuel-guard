import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyTwilioSignature } from "./twilioSignature.js";

/**
 * The check that makes an inbound `STOP` believable (A11b).
 *
 * The dangerous direction is not a forged opt-out — that costs a driver an email instead of a text.
 * It is anything that lets an attacker shape what we BELIEVE about opt-outs, because the carrier then
 * keeps texting somebody who said stop at $500 to $1,500 a message. So every test here is about
 * refusing, and the one acceptance is computed the way Twilio documents it rather than asserted
 * against a captured string nobody can re-derive.
 */

const TOKEN = "test-auth-token";
const URL = "https://api.test/api/webhooks/sms";

const sign = (url: string, params: Record<string, string>, token = TOKEN): string =>
  createHmac("sha1", token)
    .update(Buffer.from(
      Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url),
      "utf8",
    ))
    .digest("base64");

describe("verifying an inbound message", () => {
  const params = { From: "+17082365732", Body: "STOP", MessageSid: "SM1" };

  it("accepts a request signed with the account's token", () => {
    expect(verifyTwilioSignature(TOKEN, URL, params, sign(URL, params))).toBe(true);
  });

  it("is insensitive to the order parameters arrive in, because the algorithm sorts them", () => {
    const reordered = { MessageSid: "SM1", Body: "STOP", From: "+17082365732" };
    expect(verifyTwilioSignature(TOKEN, URL, reordered, sign(URL, params))).toBe(true);
  });

  it("refuses a body that was changed after signing", () => {
    expect(verifyTwilioSignature(TOKEN, URL, { ...params, Body: "START" }, sign(URL, params))).toBe(false);
  });

  it("refuses a signature made with a different token", () => {
    expect(verifyTwilioSignature(TOKEN, URL, params, sign(URL, params, "someone-elses-token"))).toBe(false);
  });

  /** A proxy rewrote the path, or somebody replayed the request at another endpoint. */
  it("refuses a signature made over a different URL", () => {
    expect(verifyTwilioSignature(TOKEN, "https://api.test/api/webhooks/other", params, sign(URL, params)))
      .toBe(false);
  });

  /**
   * ⚠ The one that matters most. A missing token means nothing CAN be verified, and the tempting
   * behaviour — skip the check when unconfigured, "it is only development" — is a production bypass
   * one misconfiguration later.
   */
  it("refuses everything when no auth token is configured", () => {
    expect(verifyTwilioSignature(undefined, URL, params, sign(URL, params))).toBe(false);
    expect(verifyTwilioSignature("", URL, params, sign(URL, params))).toBe(false);
  });

  it("refuses a request with no signature at all", () => {
    expect(verifyTwilioSignature(TOKEN, URL, params, null)).toBe(false);
    expect(verifyTwilioSignature(TOKEN, URL, params, undefined)).toBe(false);
    expect(verifyTwilioSignature(TOKEN, URL, params, "")).toBe(false);
  });
});
