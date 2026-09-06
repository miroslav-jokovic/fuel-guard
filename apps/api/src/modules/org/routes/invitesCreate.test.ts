import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { hashLinkToken } from "../../../lib/linkToken.js";

/** Whatever the endpoint answered — the tests read named fields off it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/**
 * Sending an invitation (2026-09-04): what goes in the table, what goes in the email, and what is
 * no longer asked of GoTrue.
 *
 * The properties pinned here are the ones whose absence lost invitations on production:
 *
 *  · the emailed link carries a token whose SHA-256 is what the row holds — a database read yields
 *    no working link, and the link is ours to expire, revoke and rotate;
 *  · `auth.admin.generateLink` is never called. That call is what created the one-hour GoTrue
 *    token and overwrote the previous one on every send;
 *  · a RESEND rotates the token and says so, because the earlier email is now dead.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "user-1";
const INVITE = "11111111-2222-4333-8444-555555555555";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client, findAuthUserIdByEmail: vi.fn() }));
vi.mock("../../../lib/appLocals.js", () => ({
  getAppLocals: () => ({ env: { MAIL_PROVIDER: "none", WEB_APP_URL: "https://app.example.test" } }),
}));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "admin", email: "admin@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../../../lib/audit.js", () => ({ writeAudit: vi.fn(async () => true) }));

const { invitesRouter } = await import("./invites.js");

async function post(path: string, body: unknown): Promise<{ status: number; json: Json }> {
  const app = express();
  app.use(express.json());
  app.use("/api/invites", invitesRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/invites${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    await closeTestServer(server);
  }
}

const tokenFromLink = (link: string) => new URL(link).searchParams.get("token")!;

beforeEach(() => {
  vi.clearAllMocks();
  rec = createSupabaseRecorder({
    tables: {
      organizations: [{ id: ORG, name: "Silvicom Inc", allowed_domains: ["example.test"] }],
      invites: [{ id: INVITE, org_id: ORG, email: "vinnie@example.test", role: "dispatcher", status: "pending" }],
    },
  });
});

describe("POST /api/invites", () => {
  it("stores the hash of the token the link carries, and never the token", async () => {
    const { status, json } = await post("/", { email: "vinnie@example.test", role: "dispatcher", fullName: "Vinnie D" });
    expect(status).toBe(201);
    const token = tokenFromLink(json.link);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(json.link).toBe(`https://app.example.test/accept-invite?token=${token}`);
    const inserted = rec.writtenRows("invites")[0]!;
    expect(inserted.token).toBe(hashLinkToken(token));
    expect(inserted.token).not.toBe(token);
    expect(inserted.org_id).toBe(ORG);
  });

  it("asks GoTrue for nothing — no auth user, no one-time token, no second clock", async () => {
    await post("/", { email: "vinnie@example.test", role: "dispatcher" });
    expect(rec.authCalls).toEqual([]);
  });

  it("promises the seven days the row actually holds", async () => {
    const before = Date.now();
    const { json } = await post("/", { email: "vinnie@example.test", role: "dispatcher" });
    const expires = new Date(rec.writtenRows("invites")[0]!.expires_at as string).getTime();
    expect(expires - before).toBeGreaterThan(6.9 * 86_400_000);
    expect(expires - before).toBeLessThan(7.1 * 86_400_000);
    expect(json.emailSent).toBe(false); // MAIL_PROVIDER none — the link is still returned
    expect(json.reason).toBe("mail_disabled");
  });
});

describe("POST /api/invites/:id/resend", () => {
  it("rotates the token, re-arms the row, and tells the admin the earlier link is dead", async () => {
    const { status, json } = await post(`/${INVITE}/resend`, {});
    expect(status).toBe(200);
    expect(json.rotated).toBe(true);
    const token = tokenFromLink(json.link);
    const update = rec.forTable("invites").find((q) => q.write?.method === "update")!;
    expect(update.write!.payload).toMatchObject({ status: "pending", token: hashLinkToken(token), invited_by: USER });
    expect(update.filters()).toContainEqual({ col: "id", val: INVITE });
    expect(update.filters()).toContainEqual({ col: "org_id", val: ORG });
    expect(rec.authCalls).toEqual([]);
  });
});
