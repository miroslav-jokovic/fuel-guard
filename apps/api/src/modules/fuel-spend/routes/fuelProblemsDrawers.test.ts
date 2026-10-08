import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_ROLES, type AuthContext, type FindingRow } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Chunk 8c4's acceptance: "each role in the matrix opens every row it can see" on Fuel problems.
 *
 * The queue decides per ROW who sees what (`visibleSections`), and each kind of row opens a drawer that
 * reads through its own route with its own gate. Those were written apart — the queue at C7b, the incident
 * drawer at 8c3 — so nothing but this test says they agree. Before 8c3 they did not: a fill case was
 * listed to a dispatcher and opened a page the dispatcher may not see. So for every role, every row the
 * queue returns is opened through the route its drawer calls, and none may be refused.
 */
const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CASE = "11111111-1111-4111-8111-111111111111";
const FINDING = "22222222-2222-4222-8222-222222222222";
const INCIDENT = "33333333-3333-4333-8333-333333333333";
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
beforeEach(() => {
  // One open row of each kind; each table answers its list read and its by-id read with the same row.
  holder.rec = createSupabaseRecorder({
    tables: {
      organizations: [{ detection_epoch: null }],
      anomalies: [{
        id: CASE, status: "open", disposition: null, message: "Fill short of the tank", fueled_at: "2026-10-07T14:00:00Z",
        created_at: "2026-10-07T14:05:00Z", assigned_to: null, vehicle_id: TRUCK,
      }],
      fuel_exceptions: [{
        id: FINDING, kind: "contract_variance", status: "open", occurred_on: "2026-10-06", amount: 41.2, credited_amount: null,
        unit_number: "555", assigned_to: null, first_seen_at: "2026-10-06T12:00:00Z",
      }],
      fuel_exception_events: [],
      card_fraud_incidents: [{
        id: INCIDENT, status: "open", version: 1, disposition: null, resolution_note: null, card_ref: "7083050000000107967",
        vehicle_id: TRUCK, opened_at: "2026-10-05T14:10:00Z", last_attempt_at: "2026-10-05T16:00:00Z", level: "alert",
        attempt_count: 1, fuel_taken: false, failed_prompts: [], places: [{ city: "Jacksonville", state: "FL", attempts: 1 }],
        last_truck: null, assigned_to: null,
      }],
      card_fraud_incident_attempts: [],
      vehicles: [{ id: TRUCK, unit_number: "555" }],
    },
  });
});

const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { Authorization: "Bearer token" } });

/**
 * The drawer each kind opens, as the page calls it (`FuelProblemDrawers.vue`). A fill case is read by the
 * browser straight from `anomalies` under RLS — `anomalies_select` is org-scoped and `anomalies_driver_deny`
 * (0422) refuses only a driver — so it has no API route to call and is checked against that policy instead.
 */
async function opens(row: FindingRow): Promise<boolean> {
  if (row.source === "anomaly") return auth.role !== "driver";
  const path = row.source === "exception" ? `/api/fueling/exceptions/${row.id}` : `/api/card-fraud-incidents/${row.id}`;
  return (await get(path)).status === 200;
}

describe("every row on Fuel problems opens for the role that sees it", () => {
  it("holds for every role in the matrix, and stays org-scoped", async () => {
    const seen: Record<string, string[]> = {};
    for (const role of USER_ROLES) {
      auth = as(role);
      const res = await get("/api/fueling/findings?state=open,investigating,working");
      expect(res.status).toBe(200);
      const { rows } = (await res.json()) as { rows: FindingRow[] };
      seen[role] = rows.map((r) => r.source).sort();
      for (const row of rows) expect({ role, source: row.source, opens: await opens(row) }).toEqual({ role, source: row.source, opens: true });
    }
    expectOrgScoped(holder.rec!, ORG);
    // Not vacuous: the matrix as a whole lists every kind, and somebody sees all three.
    expect(new Set(Object.values(seen).flat())).toEqual(new Set(["anomaly", "exception", "incident"]));
    expect(seen.admin).toEqual(["anomaly", "exception", "incident"]);
  });
});
