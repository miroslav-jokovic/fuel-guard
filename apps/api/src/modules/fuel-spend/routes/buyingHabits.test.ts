import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The buying-habits route (chunk 9a, Q-F2), through the real app. `buyingHabits.test.ts` in shared pins the
 * arithmetic; this pins the read: the fuel section's gate, org scope, the habit kinds and statuses only,
 * whole months from a mid-month window, and the September total to the cent on production's own shape.
 */
const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TRUCK = "66666666-6666-4666-8666-666666666666";
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const as = (role: AuthContext["role"]): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role });

let server: Server;
let baseUrl = "";
let auth: AuthContext = as("admin");

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== "token") throw new Error("bad token");
    return auth;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));
const ROWS = [
  { kind: "avoided_state_premium", occurred_on: "2026-09-01", unit_number: "809", amount: "114.72", evidence: { drivers: ["YOUNESS ALAM"], fills: 1, gallons: 123.79 } },
  { kind: "off_network_premium", occurred_on: "2026-09-01", unit_number: "809", amount: "58.04", evidence: { drivers: [], fills: 1, gallons: 93.04 } },
  { kind: "avoided_brand_premium", occurred_on: "2026-09-01", unit_number: "646", amount: "0.10", evidence: { drivers: ["ANA LIMA"], fills: 1, gallons: 10 } },
];
beforeEach(() => {
  auth = as("admin");
  holder.rec = createSupabaseRecorder({
    tables: { fuel_exceptions: { pages: [ROWS, []] }, vehicles: [{ id: TRUCK, unit_number: "809" }] },
  });
});
const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { Authorization: "Bearer token" } });

describe("GET /api/fueling/buying-habits", () => {
  it("returns one row per truck-month with the total to the cent, org-scoped", async () => {
    const res = await get("/api/fueling/buying-habits?from=2026-09-01&to=2026-09-30");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; rows: { unit: string; total: number; drivers: string[] }[] };
    expect(body.total).toBe(172.86);
    expect(body.rows.map((r) => [r.unit, r.total, r.drivers])).toEqual([["809", 172.76, ["YOUNESS ALAM"]], ["646", 0.1, ["ANA LIMA"]]]);
    expectOrgScoped(holder.rec!, ORG);
  });

  it("asks only for the habit kinds, without the findings the detector withdrew, from the window's first month", async () => {
    await get("/api/fueling/buying-habits?from=2026-07-12&to=2026-10-08");
    const q = holder.rec!.forTable("fuel_exceptions")[0]!;
    const filters = q.filters();
    expect([...(filters.find((x) => x.col === "kind")!.val as string[])].sort())
      .toEqual(["avoided_brand_premium", "avoided_state_premium", "off_network_premium"]);
    expect(filters.find((x) => x.col === "status")!.val).not.toContain("resolved_by_reingest");
    expect(q.ops.filter((o) => o.method === "gte" || o.method === "lte").map((o) => o.args))
      .toEqual([["occurred_on", "2026-07-01"], ["occurred_on", "2026-10-08"]]);
  });

  it("narrows to the trucks asked for, by their unit numbers", async () => {
    await get(`/api/fueling/buying-habits?from=2026-09-01&to=2026-09-30&vehicles=${TRUCK}`);
    expect(holder.rec!.forTable("fuel_exceptions")[0]!.filters()).toEqual(expect.arrayContaining([{ col: "unit_number", val: ["809"] }]));
  });

  it("refuses a role without the fuel section", async () => {
    auth = as("driver");
    expect((await get("/api/fueling/buying-habits")).status).toBe(403);
    expect(holder.rec!.forTable("fuel_exceptions")).toHaveLength(0);
  });
});
