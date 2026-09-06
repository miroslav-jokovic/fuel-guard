import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { closeTestServer } from "../testing/httpServer.js";
import { SAMSARA_WEBHOOK_PATH } from "../modules/samsara/index.js";

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

beforeAll(async () => {
  // Dummy Supabase credentials so the service-role client can be constructed; nothing here queries,
  // because an unsigned delivery is refused before any read.
  const env = loadEnv({
    NODE_ENV: "test",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    SUPABASE_JWT_SECRET: "test-secret-test-secret-test-secret!!",
    TELNYX_PUBLIC_KEY,
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
