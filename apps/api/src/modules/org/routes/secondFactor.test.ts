import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `GET /api/me/second-factor` (INSTALLED-APP-PLAN IA-S1). The rule is `secondFactorRequired` in shared and
 * the facts are 0617's; this route is held to: the caller's own facts, from the token; each of the four
 * answers a person can be in; the 14-day notice shown to an admin and to nobody else; and no guess when the
 * database cannot say.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ME = "11111111-1111-4111-8111-111111111111";
const SESSION = "5e551011-0000-4000-8000-000000000001";
const SOON = new Date(Date.now() + 10 * 86_400_000).toISOString();
const PAST = "2026-01-01T00:00:00.000Z";

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
let me: AuthContext;
let row: Record<string, unknown> | null | { error: unknown };
let url = "";
let server: Server;

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => me;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/me/second-factor`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

beforeEach(() => {
  me = { userId: ME, email: "ana@example.test", orgId: ORG, role: "admin", sessionId: SESSION, aal: "aal1" };
  row = { role: "admin", suspended_at: null, session_alive: true, second_factor_required_from: SOON, has_second_factor: false };
  holder.rec = createSupabaseRecorder({
    rpc: (fn) => (fn !== "member_access_state" ? undefined : row && "error" in row ? row : row === null ? [] : [row]),
  });
});
const get = async () => { const r = await fetch(url, { headers: { Authorization: "Bearer token" } }); return { status: r.status, body: (await r.json()) as Record<string, unknown> }; };
const set = (over: Record<string, unknown>) => { row = { ...(row as Record<string, unknown>), ...over }; };

describe("GET /api/me/second-factor", () => {
  it("an admin inside the 14 days: not required yet, and told the date", async () => {
    expect(await get()).toEqual({ status: 200, body: { required: false, satisfied: false, has_factor: false, due_from: SOON, must_keep: false } });
    expect(holder.rec!.rpcs().find((c) => c.fn === "member_access_state")!.args).toEqual({ p_org: ORG, p_user: ME, p_session: SESSION });
  });

  it("an admin past the date: required, not yet given, no date to wait for", async () => {
    set({ second_factor_required_from: PAST });
    expect((await get()).body).toEqual({ required: true, satisfied: false, has_factor: false, due_from: null, must_keep: true });
  });

  it("somebody with an authenticator who has not entered the code this session", async () => {
    me = { ...me, role: "dispatcher" };
    set({ role: "dispatcher", has_second_factor: true });
    expect((await get()).body).toEqual({ required: true, satisfied: false, has_factor: true, due_from: null, must_keep: false });
  });

  it("...and once they have", async () => {
    me = { ...me, role: "dispatcher", aal: "aal2" };
    set({ role: "dispatcher", has_second_factor: true });
    expect((await get()).body).toEqual({ required: true, satisfied: true, has_factor: true, due_from: null, must_keep: false });
  });

  it("a dispatcher without one is asked nothing and shown no date — the notice is the admin's", async () => {
    me = { ...me, role: "dispatcher" };
    set({ role: "dispatcher", second_factor_required_from: PAST });
    expect((await get()).body).toEqual({ required: false, satisfied: false, has_factor: false, due_from: null, must_keep: false });
  });

  it("does not guess when the database cannot say", async () => {
    row = { error: { code: "57014", message: "down" } };
    expect((await get()).status).toBe(503);
  });

  it("needs a sign-in and a company", async () => {
    expect((await fetch(url)).status).toBe(401);
    me = { ...me, orgId: null, role: null };
    expect((await get()).status).toBe(403);
  });
});
