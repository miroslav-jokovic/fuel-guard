import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { generateVapidKeys } from "./webPush.js";

/**
 * Chat push's state on `GET /api/version` (CHAT-WEB-PUSH-PLAN WP4, D-WP12). What it can get wrong: page on one
 * phone that dropped off while the rest deliver; stay quiet while the key pair is refused for every phone; read
 * a refusal as current when a success came after it; count a day-old answer; read an unreadable table as
 * healthy, or the minutes before 0599 applies as an alarm.
 */
const mocks = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: mocks.admin }));

const { getPushHealth, pushHealthy, resetPushHealthCache, toPushHealth } = await import("./pushHealth.js");

const NOW = Date.parse("2026-11-13T15:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const delivered = (m: number) => ({ last_success_at: ago(m), last_failure_at: null, last_failure: null });
const refused = (m: number, status = 403) => ({ last_success_at: null, last_failure_at: ago(m), last_failure: `${status}: invalid JWT` });
const failed = (m: number) => ({ last_success_at: null, last_failure_at: ago(m), last_failure: "500: try later" });

const pair = generateVapidKeys();
const base = { NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };
const ENV_ON = loadEnv({ ...base, WEB_PUSH_VAPID_PUBLIC_KEY: pair.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: pair.privateKey } as NodeJS.ProcessEnv);
const ENV_OFF = loadEnv(base as NodeJS.ProcessEnv);

afterEach(() => resetPushHealthCache());

describe("toPushHealth", () => {
  it("is ok when every device's latest answer was a delivery, and ok with no devices at all", () => {
    expect(toPushHealth([delivered(5), delivered(60)], NOW)).toEqual({ state: "ok", rejected24h: 0, failing24h: 0, delivered24h: 2 });
    expect(toPushHealth([], NOW).state).toBe("ok");
  });

  it("is key_rejected when more devices are refused the key than still deliver — every phone silent", () => {
    expect(toPushHealth([refused(5), refused(9, 401), delivered(20)], NOW)).toMatchObject({ state: "key_rejected", rejected24h: 2, delivered24h: 1 });
    expect(toPushHealth([refused(5)], NOW).state).toBe("key_rejected");
  });

  it("is only degraded when one phone is refused while the others deliver, or a push service has a bad minute", () => {
    expect(toPushHealth([refused(5), delivered(6), delivered(7)], NOW).state).toBe("degraded");
    expect(toPushHealth([failed(5), failed(6)], NOW)).toMatchObject({ state: "degraded", failing24h: 2 });
  });

  it("reads each device by its LATEST answer: a refusal followed by a delivery is a delivery", () => {
    const recovered = { last_success_at: ago(5), last_failure_at: ago(30), last_failure: "403: invalid JWT" };
    expect(toPushHealth([recovered], NOW)).toMatchObject({ state: "ok", delivered24h: 1, rejected24h: 0 });
  });

  it("ignores an answer older than a day", () => {
    expect(toPushHealth([refused(24 * 60 + 1)], NOW)).toEqual({ state: "ok", rejected24h: 0, failing24h: 0, delivered24h: 0 });
  });

  it("pages on a refused key and on not knowing, never on off, pending or degraded", () => {
    expect(["off", "pending", "ok", "degraded"].every((s) => pushHealthy(s as never))).toBe(true);
    expect(pushHealthy("key_rejected")).toBe(false);
    expect(pushHealthy("unknown")).toBe(false);
  });
});

describe("getPushHealth", () => {
  it("is off on a server without a key pair, without reading anything", async () => {
    mocks.admin.mockClear();
    expect((await getPushHealth(ENV_OFF, NOW)).state).toBe("off");
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("reads only live devices, only timestamps and the failure text", async () => {
    const rec = createSupabaseRecorder({ tables: { web_push_subscriptions: [refused(3)] } });
    mocks.admin.mockReturnValue(rec.client);
    expect((await getPushHealth(ENV_ON, NOW)).state).toBe("key_rejected");
    const q = rec.forTable("web_push_subscriptions")[0]!;
    expect(q.ops.some((o) => o.method === "is" && o.args[0] === "revoked_at" && o.args[1] === null)).toBe(true);
    expect(q.ops.find((o) => o.method === "select")!.args[0]).toBe("last_success_at, last_failure_at, last_failure");
  });

  it("is pending before the table exists, and unknown when it cannot be read", async () => {
    mocks.admin.mockReturnValue(createSupabaseRecorder({ tables: { web_push_subscriptions: { error: { code: "42P01", message: "missing" } } } }).client);
    expect((await getPushHealth(ENV_ON, NOW)).state).toBe("pending");
    resetPushHealthCache();
    mocks.admin.mockReturnValue(createSupabaseRecorder({ tables: { web_push_subscriptions: { error: { code: "57014", message: "timeout" } } } }).client);
    expect((await getPushHealth(ENV_ON, NOW)).state).toBe("unknown");
  });
});
