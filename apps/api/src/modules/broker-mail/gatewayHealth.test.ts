import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/**
 * The gateway's state on `GET /api/version` (BROKER-MAIL-READER-PLAN §6 Verify). What it can get
 * wrong: call a stopped heartbeat healthy, call a gateway nobody switched on an alarm, hide a canary
 * shut-off, or read cycles without the org filter.
 */

const mocks = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: mocks.admin }));

const { getGatewayHealth, gatewayHealthy, resetGatewayHealthCache, toGatewayHealth, GATEWAY_FRESH_MS } = await import("./gatewayHealth.js");

const NOW = Date.parse("2026-11-24T16:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" } as never;
const ORG = "00000000-0000-0000-0000-0000000000aa";

afterEach(() => resetGatewayHealthCache());

describe("toGatewayHealth", () => {
  it("is off with no config row or when switched off — and that is healthy", () => {
    expect(toGatewayHealth(null, null, NOW)).toEqual({ state: "off", commit: null, lastCycleAt: null });
    expect(toGatewayHealth({ org_id: ORG, enabled: false, canary_result: "refused" }, null, NOW).state).toBe("off");
    expect(gatewayHealthy("off")).toBe(true);
  });

  it("is ok on a fresh cycle and publishes its commit", () => {
    const cycle = { started_at: ago(60_000), commit: "abc1234" };
    expect(toGatewayHealth({ org_id: ORG, enabled: true, canary_result: null }, cycle, NOW)).toEqual({ state: "ok", commit: "abc1234", lastCycleAt: cycle.started_at });
  });

  it("is stale when switched on with no cycle in five minutes, or none at all", () => {
    expect(toGatewayHealth({ org_id: ORG, enabled: true, canary_result: null }, { started_at: ago(GATEWAY_FRESH_MS), commit: null }, NOW).state).toBe("stale");
    expect(toGatewayHealth({ org_id: ORG, enabled: true, canary_result: null }, null, NOW).state).toBe("stale");
    expect(gatewayHealthy("stale")).toBe(false);
  });

  it("is stopped — not healthy — when the canary switched it off", () => {
    expect(toGatewayHealth({ org_id: ORG, enabled: false, canary_result: "opened" }, null, NOW).state).toBe("stopped");
    expect(gatewayHealthy("stopped")).toBe(false);
  });
});

describe("getGatewayHealth", () => {
  it("reads the cycles of the config row's org only", async () => {
    const rec = createSupabaseRecorder({ tables: {
      mail_gateway_config: [{ org_id: ORG, enabled: true, canary_result: null }],
      mail_gateway_cycles: [{ started_at: ago(30_000), commit: "abc1234" }],
    } });
    mocks.admin.mockReturnValue(rec.client);
    expect((await getGatewayHealth(ENV, NOW)).state).toBe("ok");
    // The config row is WHERE the org comes from (one gateway per database, D-BMR12), so it is the one
    // read that cannot carry the filter; every read after it must.
    expectOrgScoped(rec, ORG, { exempt: ["mail_gateway_config"] });
  });

  it("is off, not unknown, before 0643 exists", async () => {
    const rec = createSupabaseRecorder({ tables: { mail_gateway_config: { error: { code: "42P01", message: "missing" } } } });
    mocks.admin.mockReturnValue(rec.client);
    expect((await getGatewayHealth(ENV, NOW)).state).toBe("off");
  });

  it("is unknown when a table cannot be read", async () => {
    const rec = createSupabaseRecorder({ tables: { mail_gateway_config: { error: { code: "XX000", message: "boom" } } } });
    mocks.admin.mockReturnValue(rec.client);
    expect((await getGatewayHealth(ENV, NOW)).state).toBe("unknown");
  });
});
