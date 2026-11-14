import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { closeTestServer } from "../testing/httpServer.js";
import { SAMSARA_WEBHOOK_PATH } from "../modules/samsara/index.js";

// C2d: the receipt's write is `smsOutbox.test.ts`'s to prove; here only that a signed receipt reaches it.
const receipts = vi.hoisted(() => ({ fn: vi.fn(async () => true) }));
// HOME-TIME HT6: the same receipt is offered to the office alert texts, whose write is
// `messaging/alertTexts.test.ts`'s to prove.
const alertReceipts = vi.hoisted(() => ({ fn: vi.fn(async () => false) }));
// What each line's handler DOES with a reply is `applicationSms.test.ts`'s and `alertContacts.test.ts`'s
// to prove; here only which of the two a signed reply reaches.
const replies = vi.hoisted(() => ({ applicant: vi.fn(async () => ({ revoked: 0, helped: false, resumed: 0 })), alert: vi.fn(async () => ({ stopped: 0, resumed: 0, helped: false })) }));
vi.mock("../modules/recruiting/index.js", async (orig) => ({
  ...(await orig<object>()),
  recordDeliveryReceipt: receipts.fn,
  handleInboundSms: replies.applicant,
}));
vi.mock("../modules/messaging/index.js", async (orig) => ({
  ...(await orig<object>()),
  recordAlertTextReceipt: alertReceipts.fn,
  handleAlertInboundSms: replies.alert,
}));

/**
 * The path we PUBLISH is the path we LISTEN on.
 *
 * WHY THIS SUITE EXISTS. Measured 2026-09-01 against the live Samsara account: our webhook was
 * configured to post to `https://fleetguardweb-production.up.railway.app/api/webhooks`, while the
 * handler is mounted a segment deeper. Every delivery 404'd, `fuel_events` never held a row, and
 * nothing on either side raised anything — a 404 from a webhook receiver looks exactly like a vendor
 * that has nothing to send (docs/plans/HANDOFF-2026-09-01.md §5).
 *
 * The vendor half of that is a console setting and cannot be tested from here. The half that CAN be
 * pinned is that `SAMSARA_WEBHOOK_PATH` — the string the settings card tells an operator to paste —
 * still resolves to the receiver. Move the mount or rename the route and this fails, instead of the
 * integration failing silently in six months' time.
 */
let server: Server;
let baseUrl: string;

// A real Ed25519 keypair given to the app under test, so the SMS block below can post a genuinely
// signed delivery. Without a configured key every request is refused for the same reason and the
// tests cannot tell "no signature" apart from "no raw body" apart from "wrong key".
const { publicKey: telnyxPublic, privateKey: telnyxPrivate } = generateKeyPairSync("ed25519");
const TELNYX_PUBLIC_KEY = telnyxPublic.export({ format: "der", type: "spki" }).subarray(12).toString("base64");

function signTelnyx(body: string, timestamp: string): string {
  return edSign(null, Buffer.concat([Buffer.from(`${timestamp}|`, "utf8"), Buffer.from(body)]), telnyxPrivate).toString(
    "base64",
  );
}

const RECRUITING_NUMBER = "+15550001111";
const ALERT_NUMBER = "+15550002222";

beforeAll(async () => {
  // Dummy Supabase credentials so the service-role client can be constructed; nothing here queries,
  // because an unsigned delivery is refused before any read.
  const env = loadEnv({
    NODE_ENV: "test",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    SUPABASE_JWT_SECRET: "test-secret-test-secret-test-secret!!",
    TELNYX_PUBLIC_KEY,
    TELNYX_FROM: RECRUITING_NUMBER,
    TELNYX_ALERTS_FROM: ALERT_NUMBER,
  } as NodeJS.ProcessEnv);
  const app = createApp(env);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await closeTestServer(server);
});

describe("the Samsara webhook receiver", () => {
  it("is routed at the path we publish, and refuses an unsigned delivery there", async () => {
    const res = await fetch(`${baseUrl}${SAMSARA_WEBHOOK_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "e1" }),
    });
    // 401, not 404: the route exists and fails closed. A 404 here is the live defect.
    expect(res.status).toBe(401);
  });

  it("does not answer the mount prefix on its own — the path the vendor was given", async () => {
    const res = await fetch(`${baseUrl}/api/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "e1" }),
    });
    expect(res.status).toBe(404);
  });
});

/**
 * The SMS receiver's half of the same guarantee the Samsara block above asserts: the route EXISTS
 * and REFUSES. A 404 here would look exactly like a provider with nothing to say — which is the
 * failure that left the Samsara webhook silent for six months, and the reason inbound SMS gets the
 * same routing assertion rather than only a unit test of its verifier.
 */
describe("the inbound SMS receiver", () => {
  it("is routed, and refuses a delivery that carries no Telnyx signature", async () => {
    const res = await fetch(`${baseUrl}/api/webhooks/sms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { event_type: "message.received" } }),
    });
    // 401, not 404 and not 200: an unverifiable opt-out changes nothing.
    expect(res.status).toBe(401);
  });

  // The end-to-end proof, and the only test in this file that gets PAST a signature check: a real
  // Ed25519 delivery is accepted, so the 401s above are the guard refusing rather than the route
  // being broken. `message.finalized` is used deliberately — it is accepted and ignored, so nothing
  // reaches Supabase and the assertion stays about routing and verification.
  it("accepts a genuinely signed delivery", async () => {
    const body = JSON.stringify({ data: { event_type: "message.finalized" } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await fetch(`${baseUrl}/api/webhooks/sms`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "telnyx-timestamp": timestamp,
        "telnyx-signature-ed25519": signTelnyx(body, timestamp),
      },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: true });
  });

  // A-11 (C2d): a delivery receipt is no longer "ignored" — it reaches the outbox, with the provider's
  // message id and the first recipient's final status, and nothing about it is read from elsewhere.
  it("hands a signed delivery receipt to the outbox", async () => {
    const body = JSON.stringify({
      data: { event_type: "message.finalized", payload: { id: "tx-1", to: [{ phone_number: "+17082365732", status: "delivery_failed" }] } },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await fetch(`${baseUrl}/api/webhooks/sms`, {
      method: "POST",
      headers: { "content-type": "application/json", "telnyx-timestamp": timestamp, "telnyx-signature-ed25519": signTelnyx(body, timestamp) },
      body,
    });
    expect(res.status).toBe(200);
    expect(receipts.fn).toHaveBeenCalledWith(expect.anything(), { messageId: "tx-1", status: "delivery_failed" }, expect.any(Date));
    expect(alertReceipts.fn).toHaveBeenCalledWith(expect.anything(), { messageId: "tx-1", status: "delivery_failed" });
  });

  // Two numbers, one webhook (2026-11-13): a reply is about the number it was sent to. An office
  // person's STOP on the alert number must not revoke an applicant's consent, and an applicant's STOP
  // on the recruiting number must not be read as anything about alert texts.
  it("hands a signed reply to the line whose number it was sent to, and to that line only", async () => {
    const reply = async (to: string, text: string) => {
      const body = JSON.stringify({ data: { event_type: "message.received", payload: { from: { phone_number: "+17085550100" }, to: [{ phone_number: to }], text } } });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const res = await fetch(`${baseUrl}/api/webhooks/sms`, {
        method: "POST",
        headers: { "content-type": "application/json", "telnyx-timestamp": timestamp, "telnyx-signature-ed25519": signTelnyx(body, timestamp) },
        body,
      });
      expect(res.status).toBe(200);
    };

    await reply(ALERT_NUMBER, "STOP");
    expect(replies.alert).toHaveBeenCalledWith(expect.anything(), expect.anything(), "+17085550100", "STOP");
    expect(replies.applicant).not.toHaveBeenCalled();

    replies.alert.mockClear();
    await reply(RECRUITING_NUMBER, "STOP");
    expect(replies.applicant).toHaveBeenCalledWith(expect.anything(), expect.anything(), "+17085550100", "STOP");
    expect(replies.alert).not.toHaveBeenCalled();
  });

  // Telnyx posts JSON. The `express.urlencoded` mount this route used to sit behind was for Twilio,
  // and it would have consumed the stream before the `verify` hook could capture `rawBody`, leaving a
  // valid signature unverifiable against a body we no longer held.
  //
  // ⚠ The signature here is CORRECT for the bytes sent, and the route still refuses — but this test
  // does not isolate the `!rawBody` guard from the signature check, because neither can pass without
  // the bytes. Mutating the guard alone leaves it green, which was measured rather than assumed. It
  // pins the OUTCOME (a body we could not capture is never trusted), which is the thing that matters.
  it("refuses a correctly signed delivery whose raw body it never captured", async () => {
    const body = "From=%2B15559998888&Body=STOP";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await fetch(`${baseUrl}/api/webhooks/sms`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "telnyx-timestamp": timestamp,
        "telnyx-signature-ed25519": signTelnyx(body, timestamp),
      },
      body,
    });
    expect(res.status).toBe(401);
  });
});
