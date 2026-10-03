import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IDLE_BURN_PRIOR_GAL_PER_HOUR, IDLE_COST_BASIS_DEFAULTS } from "@silvicom/shared";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { setAppLocals } from "./appLocals.js";
import type { PlatformToken } from "./auth.js";
import type { PlatformAdmin } from "./platformAdmins.js";
import { readOrgIdleEngine } from "./idleEngine.js";

/**
 * IE-ADMIN (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md §4 Q-FSV17): the console's read of one customer's idle
 * engine checks. The verdicts are `@silvicom/shared`'s and tested there; what is testable here is the
 * read — that it asks for THIS org's rows and nobody else's, that finality comes from the latest
 * finished nightly on the org's clock, and that the route audits the cross-tenant look.
 *
 * The fake APPLIES `eq`/`lte`/`gte` to its rows (unlike a recorder that only logs them), and seeds a
 * second org's rows into every table: a read that dropped its org filter returns them and lands on a
 * different number, rather than passing on a fixture with only one tenant in it.
 */

const ORG = "org-1";
const OTHER = "org-2";
const H = 3600;

type Row = Record<string, unknown>;
interface Call {
  table: string;
  filters: [string, string, unknown][];
}

const field = (row: Row, key: string): unknown => {
  // `stats->>mode`: PostgREST's JSON text operator, one level deep is all the reader uses.
  const [col, sub] = key.split("->>");
  const v = row[col!];
  return sub == null ? v : (v as Row | null)?.[sub];
};

function fakeClient(tables: Record<string, Row[]>, rpcRows: Row[] = []) {
  const calls: Call[] = [];
  const rpcArgs: Row[] = [];
  const audits: Row[] = [];
  const from = (table: string) => {
    const call: Call = { table, filters: [] };
    calls.push(call);
    const rows = () =>
      (tables[table] ?? []).filter((r) =>
        call.filters.every(([op, k, v]) => {
          const x = field(r, k) as string;
          return op === "eq" ? x === v : op === "lte" ? x <= (v as string) : x >= (v as string);
        }),
      );
    const b: Record<string, unknown> = {};
    for (const op of ["eq", "lte", "gte"]) {
      b[op] = (k: string, v: unknown) => {
        call.filters.push([op, k, v]);
        return b;
      };
    }
    b.select = b.order = b.limit = b.range = () => b;
    b.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
    b.insert = async (row: Row) => {
      audits.push(row);
      return { error: null };
    };
    (b as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null });
    return b;
  };
  const rpc = (_name: string, args: Row) => {
    rpcArgs.push(args);
    return { range: async () => ({ data: rpcRows.filter((r) => r.org === args.p_org), error: null }) };
  };
  return { client: { from, rpc } as unknown as SupabaseClient, calls, rpcArgs, audits };
}

const stored = (org: string, vehicle_id: string, day: string, o: Row = {}): Row => ({
  org_id: org,
  vehicle_id,
  day,
  hours: 24,
  driving_sec: 6 * H,
  stopped_running_sec: 3 * H,
  brief_stop_sec: H,
  engine_sec: String(10 * H + 360),
  engine_sec_hours: 24,
  ...o,
});

function seed(o: { tz?: string; nightlyFrom?: string; idleGalPerHour?: string | null } = {}) {
  return fakeClient(
    {
      organizations: [
        { id: ORG, operating_hours: { tz: o.tz ?? "America/Chicago" } },
        { id: OTHER, operating_hours: { tz: "America/Chicago" } },
      ],
      jobs: [
        { org_id: ORG, kind: "idle_engine", status: "done", stats: { mode: "nightly", from: o.nightlyFrom ?? "2026-10-01T05:00:00.000Z" } },
        // A later nightly for ANOTHER org: read without the org filter, 10/02 would be final here too.
        { org_id: OTHER, kind: "idle_engine", status: "done", stats: { mode: "nightly", from: "2026-10-02T05:00:00.000Z" } },
      ],
      idle_engine_days: [
        stored(ORG, "v1", "2026-10-01"),
        // v2 runs 9 h against the ECU's 10.1 h: −10.9%, a disagreement.
        stored(ORG, "v2", "2026-10-01", { driving_sec: 5 * H }),
        // Not final yet (the nightly that started on it has not run): not judged.
        stored(ORG, "v1", "2026-10-02", { driving_sec: 0 }),
        stored(OTHER, "x1", "2026-10-01", { driving_sec: 0 }),
      ],
      vehicle_engine_days: [
        { org_id: ORG, vehicle_id: "v1", day: "2026-10-01", idle_sec: 4 * H + 360, coverage_sec: 24 * H },
        { org_id: OTHER, vehicle_id: "v2", day: "2026-10-01", idle_sec: 1, coverage_sec: 24 * H },
      ],
      vehicles: [
        { org_id: ORG, id: "v1", unit_number: "650", has_apu: false, apu_type: null },
        { org_id: ORG, id: "v2", unit_number: "661", has_apu: true, apu_type: "battery_hvac" },
        { org_id: OTHER, id: "x1", unit_number: "999", has_apu: false, apu_type: null },
      ],
      idle_settings: [
        ...(o.idleGalPerHour === null ? [] : [{ org_id: ORG, idle_gal_per_hour: o.idleGalPerHour ?? "0.9" }]),
        { org_id: OTHER, idle_gal_per_hour: "2.5" },
      ],
    },
    [
      { org: ORG, vehicle_id: "v1", band: 2, hours: 60, fuel_ml: String(Math.round(60 * 0.8 * 3785.411784)) },
      { org: OTHER, vehicle_id: "x1", band: 2, hours: 500, fuel_ml: "1" },
    ],
  );
}

describe("readOrgIdleEngine", () => {
  const NOW = new Date("2026-10-03T12:00:00.000Z");

  it("judges this org's final days only, and names the disagreeing truck by unit", async () => {
    const r = (await readOrgIdleEngine(seed().client, ORG, NOW))!;
    expect(r.parity.finalThrough).toBe("2026-10-01");
    expect(r.parity.timezone).toBe("America/Chicago");
    expect(r.parity.days).toEqual(["2026-10-01"]);
    // v1 passes running and is compared with Samsara; v2 fails running and has no Samsara row of its own.
    expect(r.parity.truckDays).toMatchObject({ judged: 2, passed: 1, stoppedJudged: 1, stoppedPassed: 1 });
    expect(r.parity.disagreements.map((d) => [d.unit, d.failedDays])).toEqual([["661", 1]]);
  });

  it("reads the final day on the ORG's clock", async () => {
    // 10/01 00:00 in Tokyo is 09/30 15:00Z, still 09/30 in UTC.
    const r = (await readOrgIdleEngine(seed({ tz: "Asia/Tokyo", nightlyFrom: "2026-09-30T15:00:00.000Z" }).client, ORG, NOW))!;
    expect(r.parity.finalThrough).toBe("2026-10-01");
  });

  it("learns burn rates from this org's engines over the shared window, beside its configured rate", async () => {
    const f = seed();
    const r = (await readOrgIdleEngine(f.client, ORG, NOW))!;
    expect(f.rpcArgs).toEqual([expect.objectContaining({ p_org: ORG, p_to: NOW.toISOString() })]);
    // One truck: measured, not yet believed (five trucks are the bar), so it reads the prior.
    expect(r.burnRates.fleet).toMatchObject({ trucks: 1, runningHours: 60, measuredGalPerHour: 0.8 });
    expect(r.burnRates.cells).toEqual([
      expect.objectContaining({ equipment: "no_apu", band: 2, measuredGalPerHour: 0.8, learned: false, source: "prior", galPerHour: IDLE_BURN_PRIOR_GAL_PER_HOUR }),
    ]);
    expect(r.burnRates.priorGalPerHour).toBe(IDLE_BURN_PRIOR_GAL_PER_HOUR);
    expect(r.burnRates.configuredGalPerHour).toBe(0.9);
    expect(r.burnRates.to).toBe(NOW.toISOString());
  });

  it("an org with no idle settings is priced at the cost basis default, never another org's rate", async () => {
    const r = (await readOrgIdleEngine(seed({ idleGalPerHour: null }).client, ORG, NOW))!;
    expect(r.burnRates.configuredGalPerHour).toBe(IDLE_COST_BASIS_DEFAULTS.idleGalPerHour);
  });

  it("every table read is filtered to the org in the URL", async () => {
    const f = seed();
    await readOrgIdleEngine(f.client, ORG, NOW);
    const tables = new Set(f.calls.map((c) => c.table));
    expect(tables).toEqual(new Set(["organizations", "jobs", "idle_engine_days", "vehicle_engine_days", "vehicles", "idle_settings"]));
    for (const c of f.calls) {
      const key = c.table === "organizations" ? "id" : "org_id";
      expect(c.filters, c.table).toContainEqual(["eq", key, ORG]);
    }
  });

  it("returns null for an org that does not exist, and reads nothing else", async () => {
    const f = seed();
    expect(await readOrgIdleEngine(f.client, "org-missing", NOW)).toBeNull();
    expect(f.calls.map((c) => c.table)).toEqual(["organizations"]);
  });
});

describe("GET /admin/orgs/:id/idle-engine", () => {
  const owner: PlatformAdmin = { id: "a1", email: "owner@uncdevelopment.com", userId: "u1", role: "platform_owner", status: "active", mfaEnrolledAt: "x", lastReauthAt: null };
  const readonly: PlatformAdmin = { ...owner, id: "a2", role: "platform_readonly" };
  const token = (aal: string): PlatformToken => ({ userId: "u1", email: "owner@uncdevelopment.com", aal, amr: null, sessionId: "s1" });

  async function start(locals: Parameters<typeof setAppLocals>[1]) {
    const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
    setAppLocals(app, locals);
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
  }
  const H_AUTH = { authorization: "Bearer x" };
  let f: ReturnType<typeof seed>;
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => {
    f = seed();
    ctx = await start({ verifyToken: async () => token("aal2"), lookupPlatformAdmin: async () => readonly, supabaseAdmin: f.client });
  });
  afterAll(async () => new Promise<void>((r) => ctx.server.close(() => r())));

  it("serves the checks to any platform role, read-only included, and audits the cross-tenant look", async () => {
    const res = await fetch(`${ctx.baseUrl}/admin/orgs/${ORG}/idle-engine`, { headers: H_AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { idleEngine: { parity: { finalThrough: string }; burnRates: { configuredGalPerHour: number } } };
    expect(body.idleEngine.parity.finalThrough).toBe("2026-10-01");
    expect(body.idleEngine.burnRates.configuredGalPerHour).toBe(0.9);
    expect(f.audits).toContainEqual(
      expect.objectContaining({ action: "idle_engine.view", target_org_id: ORG, admin_email: readonly.email }),
    );
  });

  it("404s an org that does not exist, and audits no read it did not make", async () => {
    const before = f.audits.length;
    const res = await fetch(`${ctx.baseUrl}/admin/orgs/org-missing/idle-engine`, { headers: H_AUTH });
    expect(res.status).toBe(404);
    expect(f.audits.length).toBe(before);
  });

  it("is behind the platform chain: 401 without a token, 403 for a verified non-admin and for aal1", async () => {
    const url = `/admin/orgs/${ORG}/idle-engine`;
    const anon = await start({ supabaseAdmin: f.client });
    const stranger = await start({ verifyToken: async () => token("aal2"), lookupPlatformAdmin: async () => null, supabaseAdmin: f.client });
    const noMfa = await start({ verifyToken: async () => token("aal1"), lookupPlatformAdmin: async () => owner, supabaseAdmin: f.client });
    try {
      expect((await fetch(`${anon.baseUrl}${url}`)).status).toBe(401);
      expect((await fetch(`${stranger.baseUrl}${url}`, { headers: H_AUTH })).status).toBe(403);
      expect((await fetch(`${noMfa.baseUrl}${url}`, { headers: H_AUTH })).status).toBe(403);
    } finally {
      for (const c of [anon, stranger, noMfa]) await new Promise<void>((r) => c.server.close(() => r()));
    }
  });
});
