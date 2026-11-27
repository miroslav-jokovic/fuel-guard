import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/me/second-factor` — two-step sign-in by an emailed code (INSTALLED-APP-PLAN IA-S1 rev 2, Q-IA20). The rule is
 * shared's (`secondFactorContract.test.ts`); the functions are 0662's (`two-step-email-codes.test.mjs`). Held here:
 * every fact is the TOKEN's — person, company, session, and the address the code goes to — the code is never
 * stored or answered in clear, a refused email leaves no live code, and a token that owes its code reaches these
 * three routes and only these.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ME = "11111111-1111-4111-8111-111111111111";
const SESSION = "5e551011-0000-4000-8000-000000000001";
const DEVICE = "the-office-pc-in-dispatch";
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString();

const holder = vi.hoisted(() => ({
  rec: null as unknown as import("../../../testing/supabaseRecorder.js").SupabaseRecorder | null,
  mail: [] as Array<{ to: string[]; subject: string; text: string }>,
  mailOk: true,
}));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));
vi.mock("../../../lib/mailer.js", async (orig) => ({
  ...(await orig<object>()),
  makeSender: () => async (m: { to: string[]; subject: string; text: string }) => {
    holder.mail.push(m);
    return holder.mailOk;
  },
}));

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  MAIL_PROVIDER: "brevo",
  BREVO_API_KEY: "test-key",
} as NodeJS.ProcessEnv);
let me: AuthContext;
let gate: Record<string, unknown> | null | { error: unknown };
let issue: Record<string, unknown>;
let verdict: string;
let base = "";
let server: Server;

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => me;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/me/second-factor`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

beforeEach(() => {
  me = { userId: ME, email: "ana@example.test", orgId: ORG, role: "dispatcher", sessionId: SESSION };
  gate = { role: "dispatcher", suspended_at: null, session_alive: true, two_step_at: null };
  issue = { outcome: "issued", code_id: "c0de0000-0000-4000-8000-000000000001", expires_at: "2026-12-01T12:10:00.000Z" };
  verdict = "ok";
  holder.mail = [];
  holder.mailOk = true;
  holder.rec = createSupabaseRecorder({
    rpc: (fn) => {
      if (fn === "member_access_gate") return gate && "error" in gate ? gate : gate === null ? [] : [gate];
      if (fn === "two_step_code_issue") return [issue];
      if (fn === "two_step_code_verify") return verdict;
      if (fn === "two_step_code_revoke") return [];
      return undefined;
    },
  });
});
const call = async (path = "", init: { method?: string; body?: unknown } = {}) => {
  const r = await fetch(base + path, {
    method: init.method ?? "GET",
    headers: { Authorization: "Bearer token", "content-type": "application/json", "x-silvicom-device": DEVICE },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> & { error?: { code: string } } };
};
const rpc = (fn: string) => holder.rec!.rpcs().filter((c) => c.fn === fn);

describe("GET /api/me/second-factor", () => {
  it("a device that never gave its code: required, not satisfied, the address masked — and it reaches the route", async () => {
    expect(await call()).toEqual({ status: 200, body: { required: true, satisfied: false, email_hint: "a•••@example.test", trusted_until: null } });
    expect(rpc("member_access_gate")[0]!.args).toMatchObject({ p_org: ORG, p_user: ME, p_session: SESSION, p_device_key: DEVICE, p_two_step_required: true });
  });

  it("a device that gave it yesterday: satisfied, and says until when", async () => {
    gate = { ...(gate as object), two_step_at: YESTERDAY };
    const { body } = await call();
    expect(body.satisfied).toBe(true);
    expect(Date.parse(body.trusted_until as string) - Date.parse(YESTERDAY)).toBe(7 * 86_400_000);
  });

  it("does not guess when the database cannot say", async () => {
    gate = { error: { code: "57014", message: "down" } };
    expect((await call()).status).toBe(503);
  });

  it("needs a sign-in and a company", async () => {
    expect((await fetch(base)).status).toBe(401);
    me = { ...me, orgId: null, role: null };
    expect((await call()).status).toBe(403);
  });
});

describe("POST /api/me/second-factor/code", () => {
  it("emails a 6-digit code to the TOKEN's address and stores only its 64-hex HMAC", async () => {
    const res = await call("/code", { method: "POST", body: { email: "attacker@evil.test" } });
    expect(res).toEqual({ status: 200, body: { outcome: "sent", expires_at: issue.expires_at } });
    expect(holder.mail).toHaveLength(1);
    expect(holder.mail[0]!.to).toEqual(["ana@example.test"]);
    const code = /(\d{6}) is your/.exec(holder.mail[0]!.subject)![1]!;
    const args = rpc("two_step_code_issue")[0]!.args as Record<string, unknown>;
    expect(args).toMatchObject({ p_org: ORG, p_user: ME, p_session: SESSION, p_device_key: DEVICE, p_ttl_minutes: 10, p_max_per_hour: 5, p_resend_seconds: 60 });
    expect(args.p_code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(holder.rec!.rpcs())).not.toContain(code);
  });

  it("a code sent moments ago: nothing new is mailed", async () => {
    issue = { ...issue, outcome: "recent" };
    expect((await call("/code", { method: "POST" })).body).toMatchObject({ outcome: "recent" });
    expect(holder.mail).toHaveLength(0);
  });

  it("over the hourly budget: 429, nothing mailed", async () => {
    issue = { outcome: "throttled", code_id: null, expires_at: null };
    const res = await call("/code", { method: "POST" });
    expect([res.status, res.body.error?.code]).toEqual([429, "too_many_codes"]);
    expect(holder.mail).toHaveLength(0);
  });

  it("an email the provider refused: 502, and the code is revoked at once", async () => {
    holder.mailOk = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call("/code", { method: "POST" })).status).toBe(502);
    expect(rpc("two_step_code_revoke")[0]!.args).toEqual({ p_org: ORG, p_user: ME, p_code: issue.code_id });
  });

  // That a token owing its code reaches these routes and no others is requireAuth's, held by
  // requireAuthMembership.test.ts ("lets that token through the one gate made for it, and nothing else"): this
  // file injects `verifyToken`, which replaces the whole check.
});

describe("POST /api/me/second-factor/verify", () => {
  it("the right code: ok, checked by its HMAC for this person, company and device", async () => {
    expect(await call("/verify", { method: "POST", body: { code: "042 917" } })).toEqual({ status: 200, body: { ok: true } });
    const args = rpc("two_step_code_verify")[0]!.args as Record<string, unknown>;
    expect(args).toMatchObject({ p_org: ORG, p_user: ME, p_session: SESSION, p_device_key: DEVICE, p_max_attempts: 5 });
    expect(args.p_code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain("042917");
  });

  it("the same code hashes the same way it was sent", async () => {
    await call("/code", { method: "POST" });
    const code = /(\d{6}) is your/.exec(holder.mail[0]!.subject)![1]!;
    await call("/verify", { method: "POST", body: { code } });
    expect((rpc("two_step_code_verify")[0]!.args as Record<string, unknown>).p_code_hash).toBe(
      (rpc("two_step_code_issue")[0]!.args as Record<string, unknown>).p_code_hash,
    );
  });

  it("each refusal says what to do next", async () => {
    for (const [v, code] of [["wrong", "wrong_code"], ["too_many", "too_many_attempts"], ["expired", "code_expired"]] as const) {
      verdict = v;
      const res = await call("/verify", { method: "POST", body: { code: "123456" } });
      expect([res.status, res.body.error?.code], v).toEqual([422, code]);
    }
  });

  it("refuses anything but six digits before asking the database", async () => {
    for (const code of ["12345", "abcdef", ""]) expect((await call("/verify", { method: "POST", body: { code } })).status, code).toBe(400);
    expect(rpc("two_step_code_verify")).toHaveLength(0);
  });
});
