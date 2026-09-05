import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The fuel exports as ROUTES (FUEL-P2, D-FUI15).
 *
 * The service's own suite covers what the file says and which rows it covers. What only exists at this
 * layer is the three things D-FUI15 asks of every export in this repository:
 *
 *   1. THE GATE IS THE MATRIX'S, not a list. An export is a READ, so it takes `fuel: view` — which is
 *      the accountant and the auditor, the two roles FUEL-T2 found being shown a page and then refused
 *      by the API (A2). A recruiter, who holds `fuel: none`, gets 403.
 *   2. AN AUDIT ROW PER EXPORT. Rows leave the building; who pulled them, when, and how many is the
 *      only durable record of it.
 *   3. THE URL IS THE PAGE'S OWN. `?unit=654,696` is what the Fuel Log is already holding, and it must
 *      reach the query as trucks rather than being dropped on the way.
 */

const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const V1 = "11111111-2222-4333-8444-555555555555";
const V2 = "22222222-3333-4444-8555-666666666666";

const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);

const ADMIN: AuthContext = { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" };
const ACCOUNTANT: AuthContext = { userId: "u-acct", email: "b@x.test", orgId: ORG, role: "accountant" };
const RECRUITER: AuthContext = { userId: "u-rec", email: "c@x.test", orgId: ORG, role: "recruiter" };

const fill = {
  id: "f1", vehicle_id: V1, driver_id: null, fueled_at: "2026-08-15T14:00:00Z", business_date: "2026-08-15",
  odometer: 100_000, miles_since_last: 620, gallons: 98.4, price_per_gal: 3.499, total_cost: 344.29,
  location_text: "Pilot 412", state: "TX", computed_mpg: 6.3, has_anomaly: false, max_severity: null,
  ai_risk_level: null, samsara_location_confidence: null, tank_type: "tractor", case_level: "clear",
};

let server: Server;
let baseUrl = "";
let auth: AuthContext = ADMIN;

const seed = (over: Record<string, unknown> = {}) =>
  createSupabaseRecorder({
    tables: {
      vehicles: [{ id: V1, unit_number: "654" }, { id: V2, unit_number: "655" }],
      drivers: [],
      fuel_transactions: [fill],
      declined_transactions: [],
      audit_logs: [],
      ...over,
    },
  });

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
  auth = ADMIN;
  holder.rec = seed();
});

const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { Authorization: "Bearer token" } });

describe("the gate is the fuel section's view set, derived rather than listed", () => {
  it("lets an accountant pull the file — the role the API used to show a page and then refuse", async () => {
    auth = ACCOUNTANT;
    const res = await get("/api/fueling/exports/fills.csv?from=2026-08-01&to=2026-08-31");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  it("refuses a role with no fuel section at all", async () => {
    auth = RECRUITER;
    expect((await get("/api/fueling/exports/fills.csv")).status).toBe(403);
    expect((await get("/api/fueling/exports/declines.csv")).status).toBe(403);
    expect((await get("/api/fueling/exports/source-records.csv")).status).toBe(403);
    expect((await get("/api/fueling/exports/cards.csv")).status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    expect((await fetch(`${baseUrl}/api/fueling/exports/fills.csv`)).status).toBe(401);
  });
});

describe("every export leaves a trace", () => {
  it("writes one audit row naming the report, the window and how many rows left", async () => {
    await get("/api/fueling/exports/fills.csv?from=2026-08-01&to=2026-08-31&unit=654,655");
    const [row] = holder.rec!.writtenRows("audit_logs");
    expect(row).toMatchObject({
      org_id: ORG,
      action: "export.generated",
      entity: "fuel_transactions",
    });
    expect(row!.meta).toMatchObject({ report: "fills.csv", from: "2026-08-01", to: "2026-08-31", rows: 1, units: 2 });
  });

  it("names the table each export actually read", async () => {
    await get("/api/fueling/exports/declines.csv");
    expect(holder.rec!.writtenRows("audit_logs")[0]).toMatchObject({ entity: "declined_transactions" });
    holder.rec = seed({ efs_transactions: [] });
    await get("/api/fueling/exports/source-records.csv");
    expect(holder.rec!.writtenRows("audit_logs")[0]).toMatchObject({ entity: "efs_transactions" });
    holder.rec = seed({ efs_cards: [] });
    await get("/api/fueling/exports/cards.csv");
    expect(holder.rec!.writtenRows("audit_logs")[0]).toMatchObject({ entity: "efs_cards", action: "export.generated" });
  });

  /**
   * ⚠ The card inventory is the one export where the audit row is the POINT rather than the record: it
   * carries every driver name and every masked card in the account, and "who took a copy of the card
   * list, and when" is a question an auditor asks about this file and no other.
   */
  it("records a card export with the filter it was taken under", async () => {
    holder.rec = seed({ efs_cards: [] });
    await get("/api/fueling/exports/cards.csv?status=Active");
    expect(holder.rec!.writtenRows("audit_logs")[0]!.meta).toMatchObject({ report: "cards.csv", status: "Active" });
  });
});

describe("the URL the page holds is the URL the file comes from", () => {
  it("turns `?unit=654,655` into the trucks the query narrows to", async () => {
    await get("/api/fueling/exports/fills.csv?unit=654,655");
    const q = holder.rec!.forTable("fuel_transactions").at(-1)!;
    expect(q.filters().map((f) => [f.col, f.val])).toEqual(expect.arrayContaining([["vehicle_id", [V1, V2]]]));
  });

  /**
   * ⚠ A hand-edited or forwarded link naming units this fleet does not have must produce an EMPTY
   * file, not the whole fleet's. Four such units exist in this carrier's feed today — 696, T005, T001
   * and T004 (measured 2026-09-04) — so the case is real rather than defensive.
   */
  it("produces an empty file for a truck this fleet does not have, never the whole fleet's", async () => {
    await get("/api/fueling/exports/fills.csv?unit=696");
    const q = holder.rec!.forTable("fuel_transactions").at(-1)!;
    expect(q.filters().map((f) => [f.col, f.val])).toEqual(expect.arrayContaining([["vehicle_id", []]]));
  });

  it("ignores a date that is not a date rather than passing it to the database", async () => {
    await get("/api/fueling/exports/fills.csv?from=yesterday");
    const q = holder.rec!.forTable("fuel_transactions").at(-1)!;
    expect(q.ops.some((o) => o.method === "gte")).toBe(false);
  });

  it("puts the window and the truck count in the filename and on the first line", async () => {
    const res = await get("/api/fueling/exports/fills.csv?from=2026-08-01&to=2026-08-31&unit=654");
    expect(res.headers.get("content-disposition")).toContain("fuel-log-fills-2026-08-01-to-2026-08-31.csv");
    const body = await res.text();
    expect(body.split("\r\n")[0]).toContain("2026-08-01 → 2026-08-31 · 1 truck");
  });

  /**
   * The BOM: without it Excel reads the first header cell as mojibake for any file carrying an accent,
   * which every station list does.
   *
   * ⚠ Asserted over the BYTES. `Response.text()` decodes UTF-8 and strips a leading BOM on the way, so
   * a string assertion here passes whether the bytes are on the wire or not — the vacuous shape this
   * repo keeps finding. It cost one red test to notice, which is the test doing its job.
   */
  it("sends a UTF-8 byte-order mark, because the reader opens this in Excel", async () => {
    const bytes = new Uint8Array(await (await get("/api/fueling/exports/fills.csv")).arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe("an oversized selection is refused with the number, not truncated", () => {
  it("answers 400 and says how big the selection is", async () => {
    holder.rec = seed({ fuel_transactions: { pages: [[fill]], count: 50_001 } });
    const res = await get("/api/fueling/exports/fills.csv");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("export_too_large");
    expect(body.error?.message).toContain("50,001 rows");
    // ⚠ And it does NOT write an audit row: nothing left the building, so a log saying an export
    // happened would be a record of an event that did not.
    expect(holder.rec!.writtenRows("audit_logs")).toHaveLength(0);
  });
});
