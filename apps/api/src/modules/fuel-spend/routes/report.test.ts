import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `GET /api/fueling/report` — FS1. The sums are the matrix's (`fuel-report-days.test.mjs`) and the
 * verdicts `reportDays.test.ts`'s. What only this boundary decides:
 *
 *   • the in-network brands are the CARRIER's `preferred_brands`, not a constant (D-FSV2);
 *   • the previous range is the same length, ending the day before (D-FSV3);
 *   • every filter value is validated before a service-role query sees it, and a value that isn't
 *     recognised is refused rather than dropped into an unfiltered answer;
 *   • every read names the org (D-FC1);
 *   • miles, MPG and cost per mile are composed beside the sums (FS2, D-FSV4/5) for a truck question
 *     and refused for a station question — the MPG arithmetic itself is `fleetMpg.test.ts`'s.
 */

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const V1 = "11111111-2222-4333-8444-555555555555";
const S1 = "21111111-2222-4333-8444-555555555555";
const V2 = "31111111-2222-4333-8444-555555555555";

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const ADMIN: AuthContext = { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" };

let server: Server;
let baseUrl = "";

const dayRow = (day: string, network: string, spend: number, tank = "tractor", price = 5) => ({
  day, network, tank, fills: "1", gallons: String(spend / price), spend: String(spend),
  retail_fills: "0", retail_gallons: "0", retail_spend: "0", retail: "0",
  contract_fills: "0", contract_gallons: "0", contract_spend: "0", contract: "0",
});

/** 800,000 m ≈ 497.1 miles a week for v1 — the week fixtures `fleetMpg.test.ts` proves its figures on. */
const READINGS = [
  { vehicle_id: V1, reading_at: "2026-08-30T23:50:00Z", meters: 663_000_000, source: "obd" },
  { vehicle_id: V1, reading_at: "2026-09-06T23:50:00Z", meters: 663_800_000, source: "obd" },
  // Inside the last week, so a week clamped to end 09/12 still has a closing reading to measure to.
  { vehicle_id: V1, reading_at: "2026-09-12T23:50:00Z", meters: 664_500_000, source: "obd" },
  { vehicle_id: V1, reading_at: "2026-09-13T23:50:00Z", meters: 664_600_000, source: "obd" },
];
/**
 * 100 gal in 08/31–09/06 → 4.97 MPG; 50 gal in 09/07–09/13 → 9.94 MPG. V2's 10 gal on 09/06 has no
 * odometer, so it only moves a measured share — and only of a period that reaches back to 09/06,
 * which is what tells a trailing WEEK from a trailing eight days.
 */
const SPEND_DAYS = [
  { day: "2026-09-02", vehicle_id: V1, gallons_tractor: 100 },
  { day: "2026-09-06", vehicle_id: V2, gallons_tractor: 10 },
  { day: "2026-09-09", vehicle_id: V1, gallons_tractor: 50 },
];
const bound = (q: { ops: { method: string; args: unknown[] }[] }, m: string, col: string) =>
  q.ops.find((o) => o.method === m && o.args[0] === col)?.args[1] as string | undefined;

// The CURRENT and PREVIOUS calls are told apart by their window, so a swap of the two would show.
// The odometer and roll-up tables are FUNCTION fixtures: the recorder records filters and applies none.
const seed = (brands: string[] | null = ["pilot", "flying_j", "one9"], fuelThrough: string | null = "2099-12-31") =>
  createSupabaseRecorder({
    tables: {
      route_fuel_settings: brands == null ? [] : [{ org_id: ORG, preferred_brands: brands }],
      organizations: [{ id: ORG, operating_hours: { tz: "America/Chicago" } }],
      samsara_odometer_readings: (q) =>
        READINGS.filter((r) => r.reading_at >= (bound(q, "gte", "reading_at") ?? "") && r.reading_at <= (bound(q, "lte", "reading_at") ?? "~")),
      fuel_spend_days: (q) => {
        const lo = bound(q, "gte", "day");
        const hi = bound(q, "lte", "day");
        if (lo === undefined && hi === undefined) return fuelThrough == null ? [] : [{ day: fuelThrough }];
        const scope = q.ops.find((o) => o.method === "in" && o.args[0] === "vehicle_id")?.args[1] as string[] | undefined;
        return SPEND_DAYS.filter((d) => d.day >= lo! && d.day <= hi! && (scope === undefined || scope.includes(d.vehicle_id)));
      },
    },
    rpc: (fn, args) => {
      const a = args as { p_from: string };
      if (fn === "fuel_report_days") {
        if (a.p_from === "2026-09-07") return [dayRow("2026-09-09", "in", 250)];
        if (a.p_from === "2026-08-31") return [dayRow("2026-09-02", "in", 500, "tractor", 4)];
        return a.p_from === "2026-09-01"
          ? [dayRow("2026-09-01", "in", 500), dayRow("2026-09-02", "unknown", 200), dayRow("2026-09-02", "in", 50, "reefer")]
          : [dayRow("2026-08-10", "out", 300)];
      }
      if (fn === "fuel_report_sites") {
        return [{ station_id: S1, brand: "pilot", site: "436", city: "Amarillo", state: "TX", fills: "3", gallons: "300" },
          { station_id: null, brand: null, site: null, city: null, state: "CA", fills: "1", gallons: "60" }];
      }
      return null;
    },
  });

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== "token") throw new Error("bad token");
    return ADMIN;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));
beforeEach(() => {
  holder.rec = seed();
});

const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { Authorization: "Bearer token" } });
type Body = {
  current: { from: string; to: string; totals: { tractor: { spend: number }; reefer: { spend: number }; byNetwork: Record<string, { spend: number }> } };
  previous: { from: string; to: string; totals: { tractor: { spend: number } } };
  inNetworkBrands: string[];
  sites: { stationId: string | null; state: string | null; fills: number }[];
};
const dayCalls = () => holder.rec!.rpcs().filter((c) => c.fn === "fuel_report_days").map((c) => c.args as Record<string, unknown>);

describe("GET /api/fueling/report", () => {
  it("sums the range and the previous one of equal length, ending the day before", async () => {
    const res = await get("/api/fueling/report?from=2026-09-01&to=2026-09-30");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect([body.current.from, body.current.to]).toEqual(["2026-09-01", "2026-09-30"]);
    expect([body.previous.from, body.previous.to]).toEqual(["2026-08-02", "2026-08-31"]);
    expect(body.current.totals.tractor.spend).toBe(700);
    expect(body.current.totals.reefer.spend).toBe(50);
    expect(body.current.totals.byNetwork.unknown!.spend).toBe(200);
    expect(body.previous.totals.tractor.spend).toBe(300);
    expect(dayCalls().map((a) => [a.p_from, a.p_to]).sort()).toEqual([["2026-08-02", "2026-08-31"], ["2026-09-01", "2026-09-30"]]);
  });

  it("counts in network what the CARRIER's settings name, and says which brands those were", async () => {
    const body = (await (await get("/api/fueling/report?from=2026-09-01&to=2026-09-30")).json()) as Body;
    expect(body.inNetworkBrands).toEqual(["pilot", "flying_j", "one9"]);
    for (const a of dayCalls()) expect(a.p_in_network_brands).toEqual(["pilot", "flying_j", "one9"]);
  });

  it("falls back to the policy default (Pilot, Flying J) for a carrier that never set one", async () => {
    holder.rec = seed(null);
    const body = (await (await get("/api/fueling/report?from=2026-09-01&to=2026-09-30")).json()) as Body;
    expect(body.inNetworkBrands).toEqual(["pilot", "flying_j"]);
  });

  it("passes every filter through to both ranges, and null where none was given", async () => {
    const res = await get(`/api/fueling/report?from=2026-09-01&to=2026-09-30&vehicles=${V1}&states=tx,CA&sites=${S1}&networks=out,unknown`);
    // Both ranges were READ — otherwise the loop below asserts nothing (a lower-case state once made it
    // a 400 here and the test still passed).
    expect(res.status).toBe(200);
    expect(dayCalls()).toHaveLength(2);
    for (const a of dayCalls()) {
      expect(a.p_vehicles).toEqual([V1]);
      expect(a.p_states).toEqual(["TX", "CA"]);
      expect(a.p_sites).toEqual([S1]);
      expect(a.p_network).toEqual(["out", "unknown"]);
    }
    holder.rec = seed();
    await get("/api/fueling/report?from=2026-09-01&to=2026-09-30");
    for (const a of dayCalls()) {
      expect([a.p_vehicles, a.p_states, a.p_sites, a.p_network]).toEqual([null, null, null, null]);
    }
  });

  it("returns the places fuelled in the range, unresolved fills by state", async () => {
    const body = (await (await get("/api/fueling/report?from=2026-09-01&to=2026-09-30")).json()) as Body;
    expect(body.sites).toHaveLength(2);
    expect(body.sites[1]).toMatchObject({ stationId: null, state: "CA", fills: 1 });
    const sitesCall = holder.rec!.rpcs().find((c) => c.fn === "fuel_report_sites")!.args as Record<string, unknown>;
    expect([sitesCall.p_from, sitesCall.p_to]).toEqual(["2026-09-01", "2026-09-30"]);
  });

  it("names the org on every read — RPC arguments and table filters alike", async () => {
    await get("/api/fueling/report?from=2026-09-01&to=2026-09-30");
    for (const c of holder.rec!.rpcs()) expect((c.args as { p_org: string }).p_org).toBe(ORG);
    // `organizations` is read by its primary key for the fleet's clock — there is no org_id to scope by.
    expectOrgScoped(holder.rec!, ORG, { exempt: ["organizations"] });
  });

  it.each([
    ["a missing end", "from=2026-09-01"],
    ["a reversed range", "from=2026-09-30&to=2026-09-01"],
    ["an impossible date", "from=2026-02-31&to=2026-03-01"],
    ["a range past a year", "from=2025-01-01&to=2026-01-02"],
    ["a truck that isn't an id", "from=2026-09-01&to=2026-09-30&vehicles=754"],
    ["a state that isn't two letters", "from=2026-09-01&to=2026-09-30&states=Texas"],
    ["a network that doesn't exist", "from=2026-09-01&to=2026-09-30&networks=pilot"],
    ["a site that isn't an id", `from=2026-09-01&to=2026-09-30&sites=${S1},436`],
  ])("refuses %s rather than answering for the whole fleet", async (_, q) => {
    const res = await get(`/api/fueling/report?${q}`);
    expect(res.status).toBe(400);
    expect(dayCalls()).toHaveLength(0);
  });

  it("accepts a full leap year", async () => {
    expect((await get("/api/fueling/report?from=2024-01-01&to=2024-12-31")).status).toBe(200);
  });

  // ── FS2: the truck figures ─────────────────────────────────────────────────────────────────────
  type Eff = { mpg: { mpg: number | null; from: string; to: string; partial: boolean }; costPerMile: number | null } | null;
  type Trail = { day: string; mpg: number | null; measuredShare: number | null; reason: string | null }[] | null;
  const week = async (extra = "") =>
    (await (await get(`/api/fueling/report?from=2026-09-07&to=2026-09-13${extra}`)).json()) as {
      current: { efficiency: Eff }; previous: { efficiency: Eff }; trailingMpg: Trail;
    };

  it("gives each range its measured MPG and cost per mile — the range's price per gallon over it", async () => {
    const body = await week();
    expect(body.current.efficiency!.mpg).toMatchObject({ from: "2026-09-07", to: "2026-09-13", mpg: 9.94 });
    expect(body.previous.efficiency!.mpg).toMatchObject({ from: "2026-08-31", to: "2026-09-06", mpg: 4.97 });
    // Each range at its OWN price: $5.00 a gallon now, $4.00 before, so a mile costs price ÷ MPG.
    expect(body.current.efficiency!.costPerMile).toBe(0.503);
    expect(body.previous.efficiency!.costPerMile).toBe(0.8048);
  });

  it("gives every day of the range its trailing week, and reads the odometer once for all of them", async () => {
    const body = await week();
    expect(body.trailingMpg!.map((t) => t.day)).toEqual(
      ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"],
    );
    // 09/13's week IS the range, so the two measurements must agree.
    expect(body.trailingMpg!.at(-1)).toMatchObject({ mpg: 9.94, measuredShare: 1, reason: null });
    expect(holder.rec!.forTable("samsara_odometer_readings")).toHaveLength(1);
    const gallonReads = holder.rec!.forTable("fuel_spend_days").filter((q) => bound(q, "gte", "day") !== undefined);
    expect(gallonReads.map((q) => [bound(q, "gte", "day"), bound(q, "lte", "day")])).toEqual([["2026-08-31", "2026-09-13"]]);
  });

  it("withholds a day whose week the fuel roll-up hasn't reached the end of, and says so", async () => {
    holder.rec = seed(undefined, "2026-09-12");
    const body = await week();
    // The RANGE is answered, clamped and labelled partial (that is `getFleetMpg`'s rule); only the day
    // row is withheld, because it would print an earlier week against 09/13.
    expect(body.current.efficiency!.mpg).toMatchObject({ to: "2026-09-12", partial: true });
    expect(body.current.efficiency!.mpg.mpg).not.toBeNull();
    const last = body.trailingMpg!.at(-1)!;
    expect(last.mpg).toBeNull();
    expect(last.reason).toMatch(/roll-up reaches 2026-09-12/);
  });

  it("measures only the named trucks under a truck filter", async () => {
    await week(`&vehicles=${V1}`);
    const scoped = holder.rec!.forTable("fuel_spend_days").filter((q) => bound(q, "gte", "day") !== undefined);
    expect(scoped[0]!.ops.find((o) => o.method === "in")?.args).toEqual(["vehicle_id", [V1]]);
  });

  it.each([["a state", "&states=TX"], ["a location", `&sites=${S1}`], ["a network", "&networks=out"]])(
    "has no truck figures under %s filter, and reads no odometer for them",
    async (_, q) => {
      const body = await week(q);
      expect([body.current.efficiency, body.previous.efficiency, body.trailingMpg]).toEqual([null, null, null]);
      expect(holder.rec!.forTable("samsara_odometer_readings")).toHaveLength(0);
    },
  );
});
