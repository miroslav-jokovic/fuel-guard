import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/chat/push/quiet` (CHAT-WEB-PUSH-PLAN WP5). Whether a person is quiet and who may set it is 0603's,
 * executed by `supabase/tests/chat-do-not-disturb.test.mjs`. These routes are held to what reaches it: the
 * person and the org from the token, never the body; a malformed pause or half a window never reaches it; the
 * database's refusals in words; the answer in the control's shape; and chat's gates, not the bell's module.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
let me: AuthContext;
let rpc: Record<string, unknown>;
let url = "";
let server: Server;

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => me;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chat/push/quiet`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

const PAUSED = { paused_until: "2026-11-14T14:00:00+00:00", quiet_hours_start: "22:00:00", quiet_hours_end: "07:00:00", timezone: "America/Chicago", quiet_now: true };
beforeEach(() => {
  me = { userId: USER, email: "ana@example.test", orgId: ORG, role: "dispatcher" };
  rpc = { org_module_enabled: (_fn: string, args: { p_module: string }) => args.p_module === "messages", chat_dnd_state: [PAUSED], chat_dnd_pause: null, chat_dnd_schedule: null };
  holder.rec = createSupabaseRecorder({ rpc: (fn, args) => (typeof rpc[fn] === "function" ? (rpc[fn] as (f: string, a: unknown) => unknown)(fn, args) : rpc[fn]) });
});

const call = (path = "", method = "GET", body?: unknown) =>
  fetch(`${url}${path}`, { method, headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const calls = (fn: string) => holder.rec!.rpcs().filter((c) => c.fn === fn).map((c) => c.args as Record<string, unknown>);

describe("GET /api/chat/push/quiet", () => {
  it("answers the caller's own state, in the control's shape", async () => {
    expect(await (await call()).json()).toEqual({
      paused_until: PAUSED.paused_until, quiet_start: "22:00", quiet_end: "07:00", timezone: "America/Chicago", quiet_now: true,
    });
    expect(calls("chat_dnd_state")).toEqual([{ p_org: ORG, p_user: USER }]);
  });

  it("says nothing is set for a person who never set anything", async () => {
    rpc.chat_dnd_state = [];
    expect(await (await call()).json()).toEqual({ paused_until: null, quiet_start: null, quiet_end: null, timezone: "UTC", quiet_now: false });
  });

  it("is chat's: it needs Messages, not the Notifications module — and a driver is refused", async () => {
    expect((await call()).status).toBe(200);
    me = { ...me, role: "driver" };
    expect((await call()).status).toBe(403);
  });
});

describe("PUT /api/chat/push/quiet/pause", () => {
  it("pauses the caller of the token, whatever the body says about who, and answers the new state", async () => {
    const res = await call("/pause", "PUT", { until: "2026-11-14T14:00:00.000Z", user_id: OTHER });
    expect(res.status).toBe(200);
    expect(calls("chat_dnd_pause")).toEqual([{ p_org: ORG, p_user: USER, p_until: "2026-11-14T14:00:00.000Z" }]);
    expect(((await res.json()) as { quiet_now: boolean }).quiet_now).toBe(true);
  });

  it("resumes with null", async () => {
    expect((await call("/pause", "PUT", { until: null })).status).toBe(200);
    expect(calls("chat_dnd_pause")[0]).toMatchObject({ p_until: null });
  });

  it("never sends the database something that is not an instant", async () => {
    expect((await call("/pause", "PUT", { until: "in an hour" })).status).toBe(400);
    expect(calls("chat_dnd_pause")).toEqual([]);
  });

  it("answers the database's refusals in words: too long a pause 422, not a member 403", async () => {
    rpc.chat_dnd_pause = { error: { code: "22023", message: "a pause is at most seven days" } };
    const long = await call("/pause", "PUT", { until: "2027-01-01T00:00:00.000Z" });
    expect(long.status).toBe(422);
    expect(((await long.json()) as { error: { message: string } }).error.message).toBe("a pause is at most seven days");
    rpc.chat_dnd_pause = { error: { code: "WP001", message: "not an active office member" } };
    expect((await call("/pause", "PUT", { until: null })).status).toBe(403);
  });
});

describe("PUT /api/chat/push/quiet/schedule", () => {
  it("sets the nightly window for the caller, in the zone given", async () => {
    expect((await call("/schedule", "PUT", { start: "22:00", end: "07:00", timezone: "America/Chicago" })).status).toBe(200);
    expect(calls("chat_dnd_schedule")).toEqual([{ p_org: ORG, p_user: USER, p_start: "22:00", p_end: "07:00", p_tz: "America/Chicago" }]);
  });

  it("refuses half a window before the database is asked, and clears with both null", async () => {
    expect((await call("/schedule", "PUT", { start: "22:00", end: null, timezone: "UTC" })).status).toBe(400);
    expect(calls("chat_dnd_schedule")).toEqual([]);
    expect((await call("/schedule", "PUT", { start: null, end: null, timezone: "UTC" })).status).toBe(200);
  });

  it("answers an unknown timezone, which only the database can judge, as 422", async () => {
    rpc.chat_dnd_schedule = { error: { code: "22023", message: "unknown timezone" } };
    expect((await call("/schedule", "PUT", { start: "22:00", end: "07:00", timezone: "Mars/Olympus" })).status).toBe(422);
  });
});
