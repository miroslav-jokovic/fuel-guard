import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LOAD_RATES_PERMISSION, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";

/**
 * Load rates are WITHHELD by the server, not hidden by the screen (LOAD-RATES-PLAN D-RATE7), on all three
 * readers that carry them — the Loads list, one load, the Dispatch board — through the real mount: a
 * dispatcher the carrier has not switched on gets NO `charges` key, one it has gets the price, and the
 * admin always does (D-RATE6). The switch is read from `org_role_permissions` per request.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

/**
 * A fresh org per test: the board caches its rows per ORG for 20 s, and this test must not reach into
 * livemap's internals to clear that cache (`lint:boundaries`) — a new key is a cold cache.
 */
let ORG = "";
let orgSeq = 0;
const LOAD = "11111111-2222-4333-8444-000000000001";
const EMPTY_LEG = "11111111-2222-4333-8444-000000000002";

const ROLES: Record<string, string> = { dispatcher: "dispatcher", admin: "admin" };

const loadRow = (id: string, ref: string, status: string) => ({
  id, org_id: ORG, ref, status, source: "tms", external_status: status === "in_transit" ? "P" : "A", vehicle_id: "veh-773",
  driver_id: "drv-1", customer_name: "Viking Packing", dispatcher_external_id: null, created_at: "2026-11-19T10:00:00Z",
  drivers: { full_name: "Ana Ruiz" }, vehicles: { unit_number: "773" }, trailers: null,
});
const stop = (loadId: string, seq: number, kind: string) => ({
  load_id: loadId, seq, kind, name: null, location_name: "Kroger DC", city: "Indianapolis", state: "IN", postal_code: "46241",
  appointment_start: "2026-11-21T02:00:00Z", appointment_end: null, status: "pending", external_status: null,
  actual_arrival_at: null, lat: 39.7684, lon: -86.1581,
});
// PostgREST answers numeric as a string. EMPTY_LEG has no row: McLeod states no price for it (D-RATE3).
const PRICE = {
  load_id: LOAD, total_charge: "3620.00", linehaul: "3400.00", other_charges: "220.00", currency: "USD",
  billed_miles: "836.0", order_loaded_movements: 2,
};
const CHARGES = { total_charge: 3620, linehaul: 3400, other_charges: 220, currency: "USD", billed_miles: 836, order_loaded_movements: 2 };

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

function seed(grants: Record<string, unknown>[] = []): void {
  rec = createSupabaseRecorder({
    tables: {
      org_role_surface_access: [],
      user_surface_access: [],
      org_role_permissions: postgrestFixture(grants.map((g) => ({ org_id: ORG, ...g }))),
      loads: postgrestFixture([loadRow(LOAD, "0132143", "in_transit"), loadRow(EMPTY_LEG, "0132144", "pending_approval")]),
      load_stops: [stop(LOAD, 2, "dropoff"), stop(EMPTY_LEG, 1, "pickup")],
      load_charges: [{ ...PRICE, org_id: ORG }],
      vehicles: [{ id: "veh-773", unit_number: "773", status: "active", assigned_driver_id: "drv-1", mcleod_fleet_code: null }],
      drivers: [{ id: "drv-1", full_name: "Ana Ruiz", status: "active" }],
    },
    rpc: (fn: string) => (fn === "org_module_enabled" ? true : null),
  });
  holder.client = rec.client;
}
const GRANT_DISPATCHER = [{ role: "dispatcher", permission: LOAD_RATES_PERMISSION, allowed: true }];

const get = async (path: string, who: string) => {
  const res = await fetch(`${baseUrl}/api${path}`, { headers: { Authorization: `Bearer ${who}` } });
  expect(res.status, path).toBe(200);
  return (await res.json()) as Body;
};
type Body = { loads: Record<string, unknown>[]; load: Record<string, unknown>; data: { rows: Record<string, unknown>[] } };
/** The three readers, each answering the load or loads it carries. */
const READERS: [string, (who: string) => Promise<Record<string, unknown>[]>][] = [
  ["GET /dispatch/loads", async (who) => (await get("/dispatch/loads", who)).loads],
  ["GET /dispatch/loads/:id", async (who) => [(await get(`/dispatch/loads/${LOAD}`, who)).load]],
  [
    "GET /livemap/dispatch-board",
    async (who) => {
      const row = (await get("/livemap/dispatch-board", who)).data.rows[0]!;
      return [row.current, row.next] as Record<string, unknown>[];
    },
  ],
];

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const role = ROLES[t];
    if (!role) throw new Error("bad token");
    return { userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext;
  };
  await new Promise<void>((done) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      done();
    });
  });
});
afterAll(async () => closeTestServer(server));
beforeEach(() => {
  ORG = `0a1b2c3d-4e5f-4a6b-8c7d-${String(++orgSeq).padStart(12, "0")}`;
});

describe("load rates are withheld by the server (D-RATE7)", () => {
  it.each(READERS)("%s sends a dispatcher without the switch no `charges` key, and never reads a price", async (_name, read) => {
    seed();
    const loads = await read("dispatcher");
    expect(loads.length).toBeGreaterThan(0);
    for (const l of loads) {
      expect(l).toBeTruthy();
      expect(l).not.toHaveProperty("charges");
    }
    expect(rec.forTable("load_charges")).toHaveLength(0);
  });

  it.each(READERS)("%s sends a dispatcher the carrier switched on each load's price, null where McLeod states none", async (_name, read) => {
    seed(GRANT_DISPATCHER);
    const loads = await read("dispatcher");
    const priced = loads.find((l) => (l.id ?? l.loadId) === LOAD);
    expect(priced?.charges).toEqual(CHARGES);
    for (const l of loads.filter((x) => (x.id ?? x.loadId) !== LOAD)) expect(l.charges).toBeNull();
    expect(rec.forTable("load_charges").length).toBeGreaterThan(0);
    expectOrgScoped(rec, ORG);
  });

  it.each(READERS)("%s always sends the admin the price, whatever the rows say", async (_name, read) => {
    seed([{ role: "admin", permission: LOAD_RATES_PERMISSION, allowed: false }]);
    const priced = (await read("admin")).find((l) => (l.id ?? l.loadId) === LOAD);
    expect(priced?.charges).toEqual(CHARGES);
  });

  it("follows a switch turned off: a dispatcher once granted, then refused, gets no key", async () => {
    seed([{ role: "dispatcher", permission: LOAD_RATES_PERMISSION, allowed: false }]);
    for (const [, read] of READERS) for (const l of await read("dispatcher")) expect(l).not.toHaveProperty("charges");
  });
});

/**
 * D-RATE7's other half — the readers that must NEVER carry a price (the driver app's `/api/me/loads`,
 * hazmat loads, ⌘K search, Exceptions, Activity, Ask AI, the live map's positions) — held by who may
 * touch the figures at all: `load_charges` is named, and its reader called, only in these files.
 * Adding a reader means adding it here, on purpose, with its permission check.
 */
describe("only the three readers touch a load's price", () => {
  const API_SRC = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
  const ALLOWED = new Set([
    "modules/loads/loadCharges.ts", // the reader
    "modules/loads/mirrorLoads.ts", // the writer (R2, `writeCharges`)
    "modules/mcleod/dispatchProjection.ts", // the projection that hands the price to the writer (R2)
    "modules/loads/index.ts", // the export
    "modules/loads/routes/dispatch.ts", // Loads list + one load
    "modules/livemap/dispatchBoard.ts", // the board, per reader after its cache
  ]);
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
    });

  it("names `load_charges` or calls its reader nowhere else in the API", () => {
    const touching = files(API_SRC)
      .filter((p) => /load_charges|readLoadCharges|withLoadCharges/.test(readFileSync(p, "utf8")))
      .map((p) => relative(API_SRC, p));
    expect(touching.length).toBeGreaterThan(0);
    expect(touching.filter((p) => !ALLOWED.has(p))).toEqual([]);
  });
});
