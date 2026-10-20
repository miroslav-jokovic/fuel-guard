import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { closeTestServer } from "../testing/httpServer.js";
import {
  SMS_CONSENT_LIMIT,
  UNLOCK_LIMIT,
  applicationLinkKey,
  smsConsentLimiter,
  unlockLimiter,
} from "./applicationLimits.js";

/**
 * The two per-link budgets added by the 2026-10-20 audit, on a bare router shaped like the public
 * application's: `/:token/unlock` and `/:token/sms-consent`. What is pinned is the COUNT, the KEY
 * (one link's tries never spend another's), and the envelope the page reads a code from — not the
 * route they sit on, which `publicApplication.test.ts` and `publicApplicationSms.test.ts` cover.
 */

let server: Server | null = null;

async function serve(limited: express.RequestHandler, path: string): Promise<string> {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.post(`/:token${path}`, limited, (_req, res) => {
    res.json({ ok: true });
  });
  return new Promise<string>((resolve) => {
    server = app.listen(0, () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
  });
}

afterEach(async () => {
  if (server) await closeTestServer(server);
  server = null;
});

let seq = 0;
/** Every call from a fresh address: the budget under test is the link's, not the address's. */
const post = (base: string, token: string, path: string) =>
  fetch(`${base}/${token}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${(seq++ % 250) + 1}` },
    body: "{}",
  });

describe("the date-of-birth unlock's budget", () => {
  it(`takes ${UNLOCK_LIMIT} answers on one link, refuses the next in the API's envelope, and leaves another link its own`, async () => {
    const base = await serve(unlockLimiter(), "/unlock");
    const link = "a".repeat(43);
    for (let i = 0; i < UNLOCK_LIMIT; i += 1) expect((await post(base, link, "/unlock")).status).toBe(200);

    const refused = await post(base, link, "/unlock");
    expect(refused.status).toBe(429);
    // JSON, with a code: a plain-text 429 is what `publicFetch` once read as `invalid_link` and told
    // the driver their good link was dead (`refuse`'s header).
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("too_many_requests");

    // The second link has its own ten; the first link's walk spent none of them.
    expect((await post(base, "b".repeat(43), "/unlock")).status).toBe(200);
  });
});

describe("agreeing to texts, per link", () => {
  it(`takes ${SMS_CONSENT_LIMIT} agreements on one link and refuses the next`, async () => {
    const base = await serve(smsConsentLimiter(), "/sms-consent");
    const link = "c".repeat(43);
    for (let i = 0; i < SMS_CONSENT_LIMIT; i += 1) expect((await post(base, link, "/sms-consent")).status).toBe(200);
    const refused = await post(base, link, "/sms-consent");
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("too_many_requests");
  });
});

describe("the key both count on", () => {
  it("is the link, hashed — never the token itself, and never the address", () => {
    const req = (path: string, ip: string) => ({ path, ip, get: () => undefined }) as unknown as express.Request;
    const token = "d".repeat(43);
    const key = applicationLinkKey(req(`/${token}/unlock`, "203.0.113.1"));
    expect(key.startsWith("link:")).toBe(true);
    expect(key).not.toContain(token);
    expect(applicationLinkKey(req(`/${token}/sms-consent`, "203.0.113.2"))).toBe(key);
    expect(applicationLinkKey(req(`/${"e".repeat(43)}/unlock`, "203.0.113.1"))).not.toBe(key);
  });
});
