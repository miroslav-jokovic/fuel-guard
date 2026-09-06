import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, RECORDER_AUTH_USER_ID, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { hashLinkToken } from "../../../lib/linkToken.js";

/** Whatever the endpoint answered — the tests read named fields off it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/**
 * Redeeming an invitation with nothing but the link (2026-09-04).
 *
 * Pinned here are the properties that replaced three production failures:
 *
 *  · LOOKUP SPENDS NOTHING. A scanner that renders the page and lets the lookup run has learned an
 *    org name and stopped. No GoTrue call, no write.
 *  · THE INVITATION'S OWN CLOCK IS THE ONLY CLOCK. An invitation inside its `expires_at` redeems
 *    twenty hours after it was sent — the GoTrue one-hour OTP expiry that killed the 2026-09-03
 *    invitation has no say, because nothing of GoTrue's is in the link.
 *  · ONE REFUSAL FOR EVERY DEAD LINK. Expired, revoked, accepted, unknown: `invalid_link`, 404.
 *  · THE ADDRESS GOTRUE ALREADY KNOWS still gets in. Every invitation before this date created the
 *    auth user up front, so an unfinished one from the old flow — exactly the state the 2026-09-03
 *    recipient's account is in — redeems by setting that account's password.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const INVITE = "11111111-2222-4333-8444-555555555555";
const TOKEN = "t".repeat(43);
const NOW = new Date("2026-09-04T13:00:00Z");

let rec: SupabaseRecorder;
const lookupByEmail = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => rec.client,
  findAuthUserIdByEmail: vi.fn(async () => lookupByEmail.id),
}));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: { MAIL_PROVIDER: "none" } }) }));
vi.mock("../../../lib/audit.js", () => ({ writeAudit: vi.fn(async () => true) }));

const { publicInvitesRouter } = await import("./publicInvites.js");
const { writeAudit } = await import("../../../lib/audit.js");

async function call(path: string, body: unknown): Promise<{ status: number; json: Json }> {
  const app = express();
  app.use(express.json());
  app.use("/api/public/invites", publicInvitesRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/public/invites${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    await closeTestServer(server);
  }
}

const inviteRow = (over: Record<string, unknown> = {}) => ({
  id: INVITE,
  org_id: ORG,
  email: "vinnie@example.test",
  role: "dispatcher",
  status: "pending",
  full_name: "Vinnie Dispatcher",
  // Sent yesterday evening; a seven-day invitation. Twenty hours old at NOW.
  expires_at: "2026-09-10T17:37:00Z",
  token: hashLinkToken(TOKEN),
  ...over,
});

/** The invites fixture answers by TOKEN HASH, the way the table's unique index would. */
function seed(rows: Record<string, unknown>[], auth: Record<string, (...a: unknown[]) => unknown> = {}) {
  return createSupabaseRecorder({
    tables: {
      invites: (q) => {
        const tok = q.filters().find((f) => f.col === "token")?.val;
        return { data: tok ? rows.filter((r) => r.token === tok) : rows, error: null };
      },
      organizations: [{ id: ORG, name: "Silvicom Inc", allowed_domains: ["example.test"] }],
    },
    auth,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW });
  lookupByEmail.id = null;
});

describe("POST /api/public/invites/lookup", () => {
  it("answers who the invitation is for, without touching GoTrue or writing anything", async () => {
    rec = seed([inviteRow()]);
    const { status, json } = await call("/lookup", { token: TOKEN });
    expect(status).toBe(200);
    expect(json).toEqual({
      email: "vinnie@example.test",
      orgName: "Silvicom Inc",
      role: "dispatcher",
      fullName: "Vinnie Dispatcher",
      expiresAt: "2026-09-10T17:37:00Z",
    });
    expect(rec.authCalls).toEqual([]);
    expect(rec.writes()).toEqual([]);
  });

  it("looks the row up by the token's HASH — the plaintext never reaches the table", async () => {
    rec = seed([inviteRow()]);
    await call("/lookup", { token: TOKEN });
    const q = rec.forTable("invites")[0]!;
    expect(q.filters()).toContainEqual({ col: "token", val: hashLinkToken(TOKEN) });
    expect(q.filters().some((f) => f.val === TOKEN)).toBe(false);
  });

  it.each([
    ["expired", inviteRow({ expires_at: "2026-09-04T12:59:59Z" })],
    ["revoked", inviteRow({ status: "revoked" })],
    ["accepted", inviteRow({ status: "accepted" })],
  ])("refuses a %s invitation with the same answer as an unknown token", async (_label, row) => {
    rec = seed([row]);
    const dead = await call("/lookup", { token: TOKEN });
    rec = seed([]);
    const unknown = await call("/lookup", { token: TOKEN });
    expect(dead.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(dead.json).toEqual(unknown.json);
    expect(dead.json.error.code).toBe("invalid_link");
  });

  it("rejects a body with no token as a bad request, not a dead link", async () => {
    rec = seed([inviteRow()]);
    expect((await call("/lookup", {})).status).toBe(400);
  });
});

describe("POST /api/public/invites/redeem", () => {
  const body = { token: TOKEN, password: "correct-horse-battery", fullName: "Vincent D." };

  it("creates the login with the chosen password, confirmed, then the membership, then marks the row accepted", async () => {
    rec = seed([inviteRow()]);
    const { status, json } = await call("/redeem", body);
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, email: "vinnie@example.test", orgId: ORG, role: "dispatcher" });

    expect(rec.authCalls).toEqual([
      { fn: "createUser", args: [{ email: "vinnie@example.test", password: "correct-horse-battery", email_confirm: true }] },
    ]);
    expect(rec.writtenRows("memberships")).toEqual([{ org_id: ORG, user_id: RECORDER_AUTH_USER_ID, role: "dispatcher" }]);
    expect(rec.writtenRows("user_profiles")[0]).toMatchObject({ user_id: RECORDER_AUTH_USER_ID, full_name: "Vincent D." });
    const accepted = rec.forTable("invites").find((q) => q.write?.method === "update")!;
    expect(accepted.write!.payload).toEqual({ status: "accepted" });
    expect(accepted.filters()).toContainEqual({ col: "id", val: INVITE });
    expect(accepted.filters()).toContainEqual({ col: "org_id", val: ORG });
    expect(writeAudit).toHaveBeenCalledWith(
      rec.client,
      expect.objectContaining({ orgId: ORG, actorId: RECORDER_AUTH_USER_ID, action: "invite.accepted" }),
    );
    // `invites` is exempt because its FIRST query — the lookup by token — is the one read on this
    // surface that cannot know the org yet: the token is what resolves it. The update that follows is
    // pinned org-scoped three lines up. `organizations` is read by its own id; `user_profiles` is a
    // per-user row with no org column.
    expectOrgScoped(rec, ORG, { exempt: ["invites", "organizations", "user_profiles"] });
    const byToken = rec.forTable("invites")[0]!;
    expect(byToken.filters()).toEqual([{ col: "token", val: hashLinkToken(TOKEN) }]);
  });

  /**
   * THE 2026-09-03 LOSS, inverted. The invitation was twenty hours old, its own expiry a week away,
   * and the click said "expired" because the GoTrue token in the link had lived for one hour.
   * Nothing here consults GoTrue about validity at all.
   */
  it("redeems an invitation twenty hours after it was sent — its own expires_at is the only clock", async () => {
    rec = seed([inviteRow({ expires_at: "2026-09-10T17:37:00Z" })]);
    expect((await call("/redeem", body)).status).toBe(200);
    expect(rec.authCalls.map((c) => c.fn)).not.toContain("verifyOtp");
    expect(rec.authCalls.map((c) => c.fn)).not.toContain("generateLink");
  });

  it("sets the password on an account GoTrue already holds for the address — an unfinished old-flow invitation", async () => {
    lookupByEmail.id = "f067bed0-0000-4000-8000-000000000000";
    rec = seed([inviteRow()], {
      createUser: () => ({ data: { user: null }, error: { code: "email_exists", message: "A user with this email address has already been registered" } }),
    });
    const { status } = await call("/redeem", body);
    expect(status).toBe(200);
    expect(rec.authCalls).toEqual([
      { fn: "createUser", args: [{ email: "vinnie@example.test", password: "correct-horse-battery", email_confirm: true }] },
      { fn: "updateUserById", args: ["f067bed0-0000-4000-8000-000000000000", { password: "correct-horse-battery", email_confirm: true }] },
    ]);
    expect(rec.writtenRows("memberships")).toEqual([{ org_id: ORG, user_id: "f067bed0-0000-4000-8000-000000000000", role: "dispatcher" }]);
  });

  it("passes the project's password policy through as a 422 the form can show", async () => {
    rec = seed([inviteRow()], {
      createUser: () => ({ data: { user: null }, error: { code: "weak_password", message: "Password should be at least 12 characters." } }),
    });
    const { status, json } = await call("/redeem", body);
    expect(status).toBe(422);
    expect(json.error).toEqual({ code: "weak_password", message: "Password should be at least 12 characters." });
    expect(rec.writes()).toEqual([]);
  });

  it("refuses a dead link before creating any login", async () => {
    rec = seed([inviteRow({ status: "revoked" })]);
    const { status, json } = await call("/redeem", body);
    expect(status).toBe(404);
    expect(json.error.code).toBe("invalid_link");
    expect(rec.authCalls).toEqual([]);
    expect(rec.writes()).toEqual([]);
  });

  it("refuses an address the organisation no longer allows, after the link resolved", async () => {
    rec = createSupabaseRecorder({
      tables: {
        invites: [inviteRow({ email: "vinnie@elsewhere.test" })],
        organizations: [{ id: ORG, name: "Silvicom Inc", allowed_domains: ["example.test"] }],
      },
    });
    const { status, json } = await call("/redeem", body);
    expect(status).toBe(422);
    expect(json.error.code).toBe("domain_not_allowed");
    expect(rec.writtenRows("memberships")).toEqual([]);
  });

  it("uses the invitation's name when the person leaves theirs blank", async () => {
    rec = seed([inviteRow()]);
    await call("/redeem", { token: TOKEN, password: "correct-horse-battery" });
    expect(rec.writtenRows("user_profiles")[0]).toMatchObject({ full_name: "Vinnie Dispatcher" });
  });
});
