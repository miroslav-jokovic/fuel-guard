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
 *   • every read names the org (D-FC1).
 */

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const V1 = "11111111-2222-4333-8444-555555555555";
const S1 = "21111111-2222-4333-8444-555555555555";

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const ADMIN: AuthContext = { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" };

let server: Server;
let baseUrl = "";

const dayRow = (day: string, network: string, spend: number, tank = "tractor") => ({
  day, network, tank, fills: "1", gallons: String(spend / 5), spend: String(spend),
  retail_fills: "0", retail_gallons: "0", retail_spend: "0", retail: "0",
  contract_fills: "0", contract_gallons: "0", contract_spend: "0", contract: "0",
});

// The CURRENT and PREVIOUS calls are told apart by their window, so a swap of the two would show.
const seed = (brands: string[] | null = ["pilot", "flying_j", "one9"]) =>
  createSupabaseRecorder({
    tables: { route_fuel_settings: brands == null ? [] : [{ org_id: ORG, preferred_brands: brands }] },
    rpc: (fn, args) => {
      const a = args as { p_from: string };
      if (fn === "fuel_report_days") {
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
    expectOrgScoped(holder.rec!, ORG);
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
});
