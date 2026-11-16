import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { setAppLocals } from "../lib/appLocals.js";
import type { PlatformToken } from "../lib/auth.js";
import type { PlatformAdmin } from "../lib/platformAdmins.js";
import { STEP_UP_WINDOW_MS } from "../middleware/platformAuth.js";

/**
 * Silvicom staff remove a customer member's authenticator (INSTALLED-APP-PLAN IA-S1, Q-IA11 (b)). Held to:
 * owner or admin only, with their own second factor minutes old; a reason; a member of THAT customer; every
 * factor removed through the auth server; the person signed out; and both audit trails written.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "99999999-9999-4999-8999-999999999999";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";

let factors: Array<{ id: string; status: string }>;
let deleteError: { message: string } | null;
let endError: { message: string } | null;
let seen: { listed: unknown[]; deleted: unknown[]; rpcs: Array<{ fn: string; args: unknown }>; inserts: Array<{ table: string; row: Record<string, unknown> }>; memberFilters: Array<[string, unknown]> };

function fakeClient(): SupabaseClient {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => { filters.push([col, val]); return b; };
    b.maybeSingle = async () => {
      if (table !== "memberships") return { data: null, error: null };
      seen.memberFilters = filters;
      const org = filters.find(([c]) => c === "org_id")?.[1], user = filters.find(([c]) => c === "user_id")?.[1];
      return { data: org === ORG && user === MEMBER ? { role: "admin" } : null, error: null };
    };
    b.insert = async (row: Record<string, unknown>) => { seen.inserts.push({ table, row }); return { error: null }; };
    return b;
  };
  return {
    from,
    rpc: async (fn: string, args: unknown) => { seen.rpcs.push({ fn, args }); return { data: 1, error: fn === "revoke_user_sessions" ? endError : null }; },
    auth: { admin: { mfa: {
      listFactors: async (p: unknown) => { seen.listed.push(p); return { data: { factors }, error: null }; },
      deleteFactor: async (p: unknown) => { seen.deleted.push(p); return { data: deleteError ? null : {}, error: deleteError }; },
    } } },
  } as unknown as SupabaseClient;
}

const secondsAgo = (n: number) => Math.floor((Date.now() - n * 1000) / 1000);
const freshMfa = (): PlatformToken => ({ userId: "u1", email: "owner@uncdevelopment.com", aal: "aal2", amr: [{ method: "password", timestamp: secondsAgo(120) }, { method: "totp", timestamp: secondsAgo(30) }], sessionId: "s1" });
const staleMfa = (): PlatformToken => ({ ...freshMfa(), amr: [{ method: "totp", timestamp: secondsAgo(STEP_UP_WINDOW_MS / 1000 + 60) }] });
const owner: PlatformAdmin = { id: "a1", email: "owner@uncdevelopment.com", userId: "u1", role: "platform_owner", status: "active", mfaEnrolledAt: "x", lastReauthAt: null };

let server: Server;
let base = "";
async function start(who: PlatformAdmin = owner, token: () => PlatformToken = freshMfa) {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  setAppLocals(app, { verifyToken: async () => token(), lookupPlatformAdmin: async () => who, supabaseAdmin: fakeClient() });
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
beforeEach(() => {
  factors = [{ id: F1, status: "verified" }, { id: F2, status: "unverified" }];
  deleteError = null;
  endError = null;
  seen = { listed: [], deleted: [], rpcs: [], inserts: [], memberFilters: [] };
});
afterEach(async () => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

const REASON = "Phoned from the office line on file; confirmed last four of the fleet's DOT number.";
const call = (userId = MEMBER, body: unknown = { reason: REASON }, org = ORG) =>
  fetch(`${base}/admin/orgs/${org}/members/${userId}/second-factor/remove`, { method: "POST", headers: { authorization: "Bearer x", "content-type": "application/json" }, body: JSON.stringify(body) });
const inserted = (table: string) => seen.inserts.filter((i) => i.table === table).map((i) => i.row);

describe("POST /admin/orgs/:id/members/:userId/second-factor/remove", () => {
  it("removes every factor, signs the member out everywhere, and writes both audit trails with the reason", async () => {
    await start();
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true, sessionsEnded: true });
    expect(seen.memberFilters).toEqual(expect.arrayContaining([["org_id", ORG], ["user_id", MEMBER]]));
    expect(seen.listed).toEqual([{ userId: MEMBER }]);
    expect(seen.deleted).toEqual([{ id: F1, userId: MEMBER }, { id: F2, userId: MEMBER }]);
    expect(seen.rpcs).toEqual([{ fn: "revoke_user_sessions", args: { p_user_id: MEMBER } }]);
    expect(inserted("platform_audit_log")).toEqual([expect.objectContaining({ admin_id: "a1", action: "member.second_factor_removed", target_org_id: ORG, target_id: MEMBER, reason: REASON, after: { factors: 2 } })]);
    expect(inserted("audit_logs")).toEqual([expect.objectContaining({ org_id: ORG, action: "member.second_factor_removed", meta: expect.objectContaining({ userId: MEMBER, by: "Silvicom support" }) })]);
  });

  it("is refused to support and read-only staff", async () => {
    for (const role of ["platform_support", "platform_readonly"] as const) {
      await start({ ...owner, role });
      expect((await call()).status, role).toBe(403);
      await new Promise<void>((r) => server.close(() => r()));
    }
    expect(seen.deleted).toEqual([]);
    await start();
  });

  it("needs the operator's own second factor again, minutes old", async () => {
    await start(owner, staleMfa);
    expect((await call()).status).toBe(403);
    expect(seen.listed).toEqual([]);
  });

  it("needs a reason, and removes nothing without one", async () => {
    await start();
    for (const body of [{}, { reason: "" }, { reason: "lost it" }]) expect((await call(MEMBER, body)).status).toBe(400);
    expect(seen.listed).toEqual([]);
  });

  it("answers 404 for somebody who is not a member of THAT customer, before the auth server is asked", async () => {
    await start();
    expect((await call(STRANGER)).status).toBe(404);
    expect((await call(MEMBER, { reason: REASON }, "00000000-0000-4000-8000-0000000000b2")).status).toBe(404);
    expect((await call("not-an-id")).status).toBe(404);
    expect(seen.listed).toEqual([]);
  });

  it("says so when the member has none, and records and ends nothing", async () => {
    await start();
    factors = [];
    const res = await call();
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("no_second_factor");
    expect(seen.inserts).toEqual([]);
    expect(seen.rpcs).toEqual([]);
  });

  it("reports failure, with no audit row and nobody signed out, when the auth server refuses", async () => {
    await start();
    deleteError = { message: "factor not found" };
    expect((await call()).status).toBe(500);
    expect(seen.inserts).toEqual([]);
    expect(seen.rpcs).toEqual([]);
  });

  it("still records what was done, and says so, when the sessions could not be ended", async () => {
    await start();
    endError = { message: "down" };
    const res = await call();
    expect(await res.json()).toEqual({ removed: true, sessionsEnded: false });
    expect(inserted("platform_audit_log")).toHaveLength(1);
  });
});
