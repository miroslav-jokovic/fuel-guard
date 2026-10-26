import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";

/**
 * Realtime's state on `GET /api/version` (OFFICE-CHAT-PLAN CHA4). What it can get wrong: read a stopped
 * probe as healthy, an unreadable table as healthy, or the ten minutes before 0515 applies as an alarm.
 */

const mocks = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: mocks.admin }));

const { getRealtimeHealth, realtimeHealthy, resetRealtimeHealthCache, toRealtimeHealth, PROBE_FRESH_MS } = await import("./realtimeHealth.js");

const NOW = Date.parse("2026-10-24T15:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" } as never;

afterEach(() => resetRealtimeHealthCache());

describe("toRealtimeHealth", () => {
  it("is pending before the first probe", () => {
    expect(toRealtimeHealth(null, 0, NOW)).toEqual({ state: "pending", lastProbeAt: null, latencyMs: null, sendFailures24h: 0 });
  });

  it("is ok on a fresh probe that arrived, degraded when a chat signal failed today", () => {
    const probe = { at: ago(5 * 60_000), ok: true, latency_ms: "142" };
    expect(toRealtimeHealth(probe, 0, NOW)).toEqual({ state: "ok", lastProbeAt: probe.at, latencyMs: 142, sendFailures24h: 0 });
    expect(toRealtimeHealth(probe, 2, NOW).state).toBe("degraded");
  });

  it("is failing when the latest probe did not arrive", () => {
    expect(toRealtimeHealth({ at: ago(60_000), ok: false, latency_ms: null }, 0, NOW).state).toBe("failing");
  });

  it("is stale once the latest probe is three intervals old, whatever it said", () => {
    expect(toRealtimeHealth({ at: ago(PROBE_FRESH_MS), ok: true, latency_ms: 50 }, 0, NOW).state).toBe("stale");
    expect(toRealtimeHealth({ at: ago(PROBE_FRESH_MS - 1), ok: true, latency_ms: 50 }, 0, NOW).state).toBe("ok");
  });
});

describe("realtimeHealthy", () => {
  it("accepts pending, ok and degraded, and nothing else", () => {
    const states = ["pending", "ok", "degraded", "failing", "stale", "unknown"] as const;
    expect(Object.fromEntries(states.map((s) => [s, realtimeHealthy(s)]))).toEqual({
      pending: true, ok: true, degraded: true, failing: false, stale: false, unknown: false,
    });
  });
});

describe("getRealtimeHealth", () => {
  it("reads the latest probe and the day's failure count from the platform table", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        platform_realtime_health: (q) =>
          q.filters().some((f) => f.col === "kind" && f.val === "probe")
            ? [{ at: ago(60_000), ok: true, latency_ms: 90 }]
            : { data: [], count: 1 },
      },
    });
    mocks.admin.mockReturnValue(rec.client);
    const h = await getRealtimeHealth(ENV, NOW);
    expect(h).toEqual({ state: "degraded", lastProbeAt: ago(60_000), latencyMs: 90, sendFailures24h: 1 });
    const reads = rec.queries.filter((q) => q.table === "platform_realtime_health");
    expect(reads).toHaveLength(2);
    expect(reads[1]!.filters()).toEqual(expect.arrayContaining([{ col: "kind", val: "chat_send_failed" }]));
  });

  it("is pending, not an alarm, while the table does not exist yet — the window before 0515 applies", async () => {
    const rec = createSupabaseRecorder({ tables: { platform_realtime_health: { error: { code: "42P01", message: "relation does not exist" } } } });
    mocks.admin.mockReturnValue(rec.client);
    expect((await getRealtimeHealth(ENV, NOW)).state).toBe("pending");
  });

  it("is unknown — never healthy — when the table cannot be read for any other reason", async () => {
    const rec = createSupabaseRecorder({ tables: { platform_realtime_health: { error: { code: "57014", message: "timeout" } } } });
    mocks.admin.mockReturnValue(rec.client);
    expect((await getRealtimeHealth(ENV, NOW)).state).toBe("unknown");
    mocks.admin.mockImplementation(() => { throw new Error("not configured"); });
    resetRealtimeHealthCache();
    expect((await getRealtimeHealth(ENV, NOW)).state).toBe("unknown");
  });

  it("answers from its 30-second cache", async () => {
    const rec = createSupabaseRecorder({ tables: { platform_realtime_health: [] } });
    mocks.admin.mockReturnValue(rec.client);
    await getRealtimeHealth(ENV, NOW);
    await getRealtimeHealth(ENV, NOW + 10_000);
    expect(rec.queries.filter((q) => q.table === "platform_realtime_health")).toHaveLength(2);
  });
});
