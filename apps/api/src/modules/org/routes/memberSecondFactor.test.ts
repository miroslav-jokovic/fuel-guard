import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { mintStepUpToken, STEP_UP_TOKEN_HEADER } from "../../../lib/stepUpToken.js";

/**
 * An admin removes a colleague's authenticator (INSTALLED-APP-PLAN IA-S1, Q-IA11 (a)). Held to: the admin
 * role and the password again; only a member of the admin's own company; never oneself; every factor removed
 * through the auth server's own API; the person signed out everywhere; and an audit row that says it happened
 * and nothing of the factor.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ME = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const STRANGER = "99999999-9999-4999-8999-999999999999";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));
const forgetMembership = vi.hoisted(() => vi.fn());
vi.mock("../../../middleware/membershipCurrent.js", async (orig) => ({ ...(await orig<typeof import("../../../middleware/membershipCurrent.js")>()), forgetMembership }));

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
let me: AuthContext;
let factors: Array<{ id: string; status: string; secret?: string }>;
let deleteAnswer: unknown;
let base = "";
let server: Server;

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => me;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; resolve(); });
  });
});
afterAll(async () => closeTestServer(server));

beforeEach(() => {
  me = { userId: ME, email: "ana@example.test", orgId: ORG, role: "admin" };
  factors = [{ id: F1, status: "verified", secret: "TOTP-SECRET" }, { id: F2, status: "unverified" }];
  deleteAnswer = { data: {}, error: null };
  forgetMembership.mockClear();
  holder.rec = createSupabaseRecorder({
    rpc: (fn) => (fn === "revoke_user_sessions" ? 2 : undefined),
    tables: {
      memberships: (q: { filters: () => Array<{ col: string; val: unknown }> }) =>
        (q.filters().find((f) => f.col === "user_id")?.val === BEN ? [{ role: "admin", suspended_at: null }] : []),
      audit_logs: [],
    } as never,
    auth: {
      "mfa.listFactors": () => ({ data: { factors }, error: null }),
      "mfa.deleteFactor": () => deleteAnswer,
    } as never,
  });
});

const confirmed = () => ({ [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, ME, ORG)!.token });
const call = (userId: string, headers: Record<string, string> = confirmed()) =>
  fetch(`${base}/api/members/${userId}/second-factor`, { method: "DELETE", headers: { Authorization: "Bearer token", ...headers } });
const auth = (fn: string) => holder.rec!.authCalls.filter((c) => c.fn === fn).map((c) => c.args[0]);
const audits = () => holder.rec!.forTable("audit_logs").filter((q) => q.write).map((q) => q.write!.payload as Record<string, unknown>);
const ended = () => holder.rec!.rpcs().filter((c) => c.fn === "revoke_user_sessions").map((c) => c.args);

describe("DELETE /api/members/:userId/second-factor", () => {
  it("removes every factor of the member through the auth server, signs them out everywhere, and records it", async () => {
    const res = await call(BEN);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true });
    expect(auth("mfa.listFactors")).toEqual([{ userId: BEN }]);
    expect(auth("mfa.deleteFactor")).toEqual([{ id: F1, userId: BEN }, { id: F2, userId: BEN }]);
    expect(ended()).toEqual([{ p_user_id: BEN }]);
    expect(forgetMembership).toHaveBeenCalledWith(BEN);
    expect(audits()).toEqual([
      expect.objectContaining({ org_id: ORG, actor_id: ME, action: "member.second_factor_removed", entity: "member", entity_id: BEN, meta: { factors: 2, verified: 1 } }),
    ]);
    expect(JSON.stringify(audits())).not.toContain("TOTP-SECRET");
    expectOrgScoped(holder.rec!, ORG);
  });

  it("will not do it without the admin's password again", async () => {
    const res = await call(BEN, {});
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("step_up_required");
    expect(auth("mfa.deleteFactor")).toEqual([]);
  });

  it("is the admin's alone", async () => {
    for (const role of ["fleet_manager", "dispatcher", "safety_manager", "driver"] as const) {
      me = { ...me, role };
      expect((await call(BEN)).status, role).toBe(403);
    }
    expect(auth("mfa.listFactors")).toEqual([]);
  });

  it("refuses oneself, and says what to do instead", async () => {
    const res = await call(ME);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("cannot_remove_own");
    expect(auth("mfa.listFactors")).toEqual([]);
  });

  it("answers 404 for somebody who is not of the admin's company, before the auth server is asked anything", async () => {
    expect((await call(STRANGER)).status).toBe(404);
    expect((await call("not-an-id")).status).toBe(404);
    expect(auth("mfa.listFactors")).toEqual([]);
  });

  it("says so when the member has none — and signs nobody out and records nothing", async () => {
    factors = [];
    const res = await call(BEN);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("no_second_factor");
    expect(ended()).toEqual([]);
    expect(audits()).toEqual([]);
  });

  it("does not report success, sign anybody out or write an audit row when the auth server refuses", async () => {
    deleteAnswer = { data: null, error: { message: "factor not found" } };
    expect((await call(BEN)).status).toBe(500);
    expect(ended()).toEqual([]);
    expect(audits()).toEqual([]);
  });
});
