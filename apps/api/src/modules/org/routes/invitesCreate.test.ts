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
const { writeAudit } = await import("../../../lib/audit.js");

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
/** The arguments of the one call to a 0395 function (SP8), or undefined when it was not called. */
const rpcArgs = (fn: string) => rec.rpcs().find((r) => r.fn === fn)?.args as Record<string, unknown> | undefined;
const auditActions = () => vi.mocked(writeAudit).mock.calls.map((c) => c[1].action);

const recorder = (rpc: Record<string, unknown> = {}) =>
  createSupabaseRecorder({
    tables: {
      organizations: [{ id: ORG, name: "Silvicom Inc", allowed_domains: ["example.test"] }],
      invites: [{ id: INVITE, org_id: ORG, email: "vinnie@example.test", role: "dispatcher", status: "pending" }],
    },
    rpc: { invite_create: INVITE, invite_reissue: "pending", invite_revoke: "pending", ...rpc },
  });

beforeEach(() => {
  vi.clearAllMocks();
  rec = recorder();
});

describe("POST /api/invites", () => {
  it("stores the hash of the token the link carries, and never the token", async () => {
    const { status, json } = await post("/", { email: "vinnie@example.test", role: "dispatcher", fullName: "Vinnie D" });
    expect(status).toBe(201);
    const token = tokenFromLink(json.link);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(json.link).toBe(`https://app.example.test/accept-invite?token=${token}`);
    const created = rpcArgs("invite_create")!;
    expect(created.p_token_hash).toBe(hashLinkToken(token));
    expect(created.p_token_hash).not.toBe(token);
    expect(created.p_org_id).toBe(ORG);
    // The response still carries the row, as the list shows it.
    expect(json.invite).toMatchObject({ id: INVITE, email: "vinnie@example.test" });
  });

  /**
   * SP8 (Q-SET7 (a)): the invite and its `invite.created` row are ONE transaction inside
   * `invite_create`, so the route writes no invite row itself and no `invite.created` beside it. The
   * email goes after that commits, and whether it went is the separate `invite.delivered` row.
   */
  it("creates the invite and its record in one call, then records the delivery separately", async () => {
    await post("/", { email: "vinnie@example.test", role: "dispatcher", fullName: "Vinnie D" });
    expect(rpcArgs("invite_create")).toMatchObject({
      p_org_id: ORG,
      p_email: "vinnie@example.test",
      p_role: "dispatcher",
      p_full_name: "Vinnie D",
      p_actor: USER,
    });
    expect(rec.writes()).toHaveLength(0);
    expect(auditActions()).toEqual(["invite.delivered"]);
    expect(vi.mocked(writeAudit).mock.calls[0]![1]).toMatchObject({
      orgId: ORG,
      entityId: INVITE,
      meta: { email: "vinnie@example.test", emailSent: false, reason: "mail_disabled" },
    });
  });

  it("answers 409 invite_exists on the function's unique violation, and sends nothing", async () => {
    rec = recorder({ invite_create: { error: { code: "23505", message: "duplicate key" } } });
    const { status, json } = await post("/", { email: "vinnie@example.test", role: "dispatcher" });
    expect(status).toBe(409);
    expect(json.error.code).toBe("invite_exists");
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("answers 500, not invite_exists, when the function fails for another reason", async () => {
    rec = recorder({ invite_create: { error: { code: "57014", message: "timeout" } } });
    const { status, json } = await post("/", { email: "vinnie@example.test", role: "dispatcher" });
    expect(status).toBe(500);
    expect(json.error.code).toBe("db_error");
  });

  it("refuses an address outside the allowed domains BEFORE the grant is attempted", async () => {
    const { status } = await post("/", { email: "vinnie@elsewhere.test", role: "dispatcher" });
    expect(status).toBe(422);
    expect(rpcArgs("invite_create")).toBeUndefined();
  });

  it("asks GoTrue for nothing — no auth user, no one-time token, no second clock", async () => {
    await post("/", { email: "vinnie@example.test", role: "dispatcher" });
    expect(rec.authCalls).toEqual([]);
  });

  it("promises the seven days the row actually holds", async () => {
    const before = Date.now();
    const { json } = await post("/", { email: "vinnie@example.test", role: "dispatcher" });
    const expires = new Date(rpcArgs("invite_create")!.p_expires_at as string).getTime();
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
    expect(rpcArgs("invite_reissue")).toMatchObject({
      p_org_id: ORG,
      p_invite_id: INVITE,
      p_token_hash: hashLinkToken(token),
      p_actor: USER,
    });
    expect(rec.writes()).toHaveLength(0);
    // `invite.resent` is written by the function; the route writes only the delivery.
    expect(auditActions()).toEqual(["invite.delivered"]);
    expect(rec.authCalls).toEqual([]);
  });

  it("answers 409 invalid_status when the function refuses the status under its lock (AM020)", async () => {
    rec = recorder({ invite_reissue: { error: { code: "AM020", message: "accepted" } } });
    const { status, json } = await post(`/${INVITE}/resend`, {});
    expect(status).toBe(409);
    expect(json.error.code).toBe("invalid_status");
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("answers 404 when the function finds no such invite in this org", async () => {
    rec = recorder({ invite_reissue: null });
    expect((await post(`/${INVITE}/resend`, {})).status).toBe(404);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe("POST /api/invites/:id/revoke", () => {
  it("revokes through invite_revoke with the token's org, and writes no audit row of its own", async () => {
    const { status } = await post(`/${INVITE}/revoke`, {});
    expect(status).toBe(200);
    expect(rpcArgs("invite_revoke")).toEqual({ p_org_id: ORG, p_invite_id: INVITE, p_actor: USER });
    expect(rec.writes()).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("answers 404 when there is no such invite in this org", async () => {
    rec = recorder({ invite_revoke: null });
    expect((await post(`/${INVITE}/revoke`, {})).status).toBe(404);
  });

  it("answers 500 when the function fails", async () => {
    rec = recorder({ invite_revoke: { error: { message: "boom" } } });
    expect((await post(`/${INVITE}/revoke`, {})).status).toBe(500);
  });
});
