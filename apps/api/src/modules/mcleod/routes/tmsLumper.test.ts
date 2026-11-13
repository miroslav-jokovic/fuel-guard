import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { hashIngestToken } from "../../../lib/ingestToken.js";

/**
 * `POST /api/tms/lumper` over the wire (LRC2): the token names the org, the shared contract checks the
 * sweep, and the whole sweep goes to the database as ONE function call.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TOKEN = "fgtms_" + "d".repeat(37);

let server: Server;
let baseUrl: string;

const post = (body: unknown, token = TOKEN) =>
  fetch(`${baseUrl}/api/tms/lumper`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

const seed = (): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      org_integrations: (q) =>
        q.filters().some((f) => f.col === "ingest_token_hash" && f.val === hashIngestToken(TOKEN))
          ? [{ org_id: ORG, provider: "mcleod", enabled: true, ingest_token_hash: hashIngestToken(TOKEN), config: {} }]
          : [],
    },
    rpc: { lumper_sweep_apply: { orders: 1, charges: 1, payments: 1, bills: 0, chargesRemoved: 0, paymentsRemoved: 2, billsRemoved: 0, casesOpened: 1 } },
  });

const order = {
  order_external_id: "0291013", company_id: "TMS", order_status: "D", ordered_at: "2026-10-01T00:00:00Z", bill_date: null,
  customer_id: "C1", customer_name: "A Broker", dispatcher_user_id: "kane", dispatcher_name: "Kane", movement_external_id: "M1",
  consignee_name: "A Warehouse", consignee_city: "Joliet", consignee_state: "IL", consignee_arrived_at: null, consignee_departed_at: null,
};
const charge = { external_id: "OC1", company_id: "TMS", order_external_id: "0291013", charge_code: "LUM", descr: "Unloading", amount: 310, sequence: 1 };
const payment = {
  external_id: "D1", company_id: "TMS", settlement_state: "paid", order_external_id: "0291013", movement_external_id: "M1", deduct_code: "UNL",
  deduction_type: "D", amount: 310, transacted_at: "2026-10-02T00:00:00Z", reference_no: "EFS-1", driver_external_id: "DRV1", payee_id: "DRV1",
  tractor_unit: "101", is_void: false,
};
const sweep = (over: Record<string, unknown> = {}) => ({ company_id: "TMS", since: "2026-08-15", orders: [order], charges: [charge], payments: [payment], bills: [], ...over });

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => closeTestServer(server));

describe("POST /api/tms/lumper", () => {
  it("applies the whole sweep in one call, for the token's org and the sweep's company", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post(sweep());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, orders: 1, charges: 1, payments: 1, bills: 0, chargesRemoved: 0, paymentsRemoved: 2, billsRemoved: 0, casesOpened: 1 });
    const calls = rec.rpcs();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("lumper_sweep_apply");
    expect(calls[0]!.args).toMatchObject({ p_org: ORG, p_company: "TMS", p_since: "2026-08-15" });
    expect((calls[0]!.args as { p_orders: unknown[] }).p_orders).toHaveLength(1);
  });

  it("takes the org from the token and ignores one in the body", async () => {
    const rec = seed();
    holder.client = rec.client;
    await post(sweep({ org_id: "11111111-1111-4111-8111-111111111111", p_org: "11111111-1111-4111-8111-111111111111" }));
    expect(rec.rpcs()[0]!.args).toMatchObject({ p_org: ORG });
  });

  it("refuses a sweep with a charge whose order it does not carry, naming the row, and writes nothing", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post(sweep({ charges: [{ ...charge, order_external_id: "0299999" }] }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("charges.0.order_external_id");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("does not apply an empty sweep, and says so, because it would read as every lumper having been removed", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post(sweep({ orders: [], charges: [], payments: [payment] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, orders: 0, charges: 0, payments: 0, bills: 0, chargesRemoved: 0, paymentsRemoved: 0, billsRemoved: 0, casesOpened: 0, skipped: "empty" });
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses an unknown token", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post(sweep(), "fgtms_" + "x".repeat(37));
    expect(res.status).toBe(401);
    expect(rec.rpcs()).toHaveLength(0);
  });
});
