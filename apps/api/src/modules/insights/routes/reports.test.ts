import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/reports` — the fuel-transaction exports and the odometer-accuracy report.
 *
 * Two faults met on these readers on 2026-10-20. Migration 0459 gave fuel_transactions a second
 * foreign key to each of vehicles and drivers, so a bare `vehicles(...)` embed became ambiguous and
 * PostgREST refused it (PGRST201) — the selects must name `*_id_fkey`. And every reader took
 * `vehicles[0]` from a many-to-one embed that arrives as ONE object, so the unit and driver columns
 * were empty. The fixtures below are shaped the way production answered that day (object, not array).
 *
 * ⚠ The recorder does not run PostgREST: it can pin which relationship a select names, not prove that
 * PostgREST accepts it. That was checked by hand against production the same day.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const admin: AuthContext = { userId: "u-admin", email: "admin@x.test", orgId: ORG, role: "admin" };

let server: Server;
let baseUrl = "";
let rec: SupabaseRecorder;

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (): Promise<AuthContext> => admin;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeTestServer(server);
});

async function get(path: string, tables: Record<string, unknown[]>) {
  rec = createSupabaseRecorder({ tables });
  holder.client = rec.client;
  const res = await fetch(`${baseUrl}/api/reports${path}`, { headers: { Authorization: "Bearer admin" } });
  return { status: res.status, text: await res.text() };
}

const selectOf = (table: string) =>
  String(rec.queries.find((q) => q.table === table)?.ops.find((o) => o.method === "select")?.args[0] ?? "");

describe("GET /api/reports fuel-transaction readers", () => {
  it("odometer-accuracy names each driver and applies the truck's calibration offset", async () => {
    const { status, text } = await get("/odometer-accuracy?by=driver", {
      fuel_transactions: [
        // Entered reads 5 high, and the truck's learned offset is +5: calibrated, it agrees.
        { odometer: 1005, samsara_odometer: 1000, driver_id: "d1", vehicle_id: "v1", vehicles: { unit_number: "709", odometer_offset: 5 }, drivers: { full_name: "Ana Ruiz" } },
      ],
    });
    expect(status).toBe(200);
    const body = JSON.parse(text) as { rows: Array<{ label: string; checked: number; mismatches: number }> };
    expect(body.rows).toEqual([expect.objectContaining({ label: "Ana Ruiz", checked: 1, mismatches: 0 })]);
    expect(selectOf("fuel_transactions")).toContain("vehicles!fuel_transactions_vehicle_id_fkey(");
    expect(selectOf("fuel_transactions")).toContain("drivers!fuel_transactions_driver_id_fkey(");
    expectOrgScoped(rec, ORG);
  });

  it("transactions.csv fills the unit and driver columns", async () => {
    const { status, text } = await get("/transactions.csv", {
      fuel_transactions: [
        { fueled_at: "2026-10-19T14:00:00Z", gallons: 100, odometer: 1000, price_per_gal: 3.5, total_cost: 350, computed_mpg: 6.5, source: "efs", location_text: "Joliet, IL", max_severity: null, vehicles: { unit_number: "709" }, drivers: { full_name: "Ana Ruiz" } },
      ],
    });
    expect(status).toBe(200);
    expect(text).toContain("709");
    expect(text).toContain("Ana Ruiz");
    expect(selectOf("fuel_transactions")).toContain("vehicles!fuel_transactions_vehicle_id_fkey(");
    expectOrgScoped(rec, ORG);
  });

  it("anomalies.csv fills the unit column", async () => {
    const { status, text } = await get("/anomalies.csv", {
      anomalies: [
        { created_at: "2026-10-19T14:00:00Z", rule_id: "R1", severity: "high", status: "open", message: "m", vehicles: { unit_number: "664" } },
      ],
    });
    expect(status).toBe(200);
    expect(text).toContain("664");
    expectOrgScoped(rec, ORG);
  });
});
