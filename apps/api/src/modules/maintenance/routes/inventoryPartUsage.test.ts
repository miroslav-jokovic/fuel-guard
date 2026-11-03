import { describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Shop parts by use (SHOP-PARTS-USAGE-PLAN.md SP-U2) — the two routes and fleetpal's reader behind
 * them. The arithmetic is the matrix's (`supabase/tests/shop-parts-usage.test.mjs`); what is left here
 * is the translation:
 *
 *   · every function call carries THIS org (the service role bypasses RLS; the argument is the boundary);
 *   · the 90-day window is computed from the clock, not left to SQL;
 *   · strings from PostgREST ("12.000") become numbers, and a missing date stays null;
 *   · unit prices pass through (D-SPU10), a missing one stays null — never 0 — and a typical price
 *     standing on fewer than five repairs is withheld;
 *   · a unit matched to our trailer links as a trailer, an unmatched one links nowhere;
 *   · a part of another org is 404 BEFORE any usage function is called;
 *   · a database failure is a 500 with a reference, not an empty list that reads "nothing used".
 */

const ORG = "org-1";
const PART = "11111111-1111-4111-8111-111111111111";
const TRAILER = "66666666-6666-4666-8666-666666666666";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "user-1", orgId: ORG, role: "technician", email: "shop@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  // What each gate admits is proved in middleware/requireSection.test.ts against the real code.
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { inventoryPartUsageRouter } = await import("./inventoryPartUsage.js");
const { inventoryPartsRouter } = await import("./inventoryParts.js");

// The routes answer JSON whose shape each test asserts field by field; a loose record keeps those reads short.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function get(path: string): Promise<{ status: number; body: Json }> {
  const app = express();
  app.use("/api/maintenance/inventory/part-usage", inventoryPartUsageRouter());
  app.use("/api/maintenance/inventory/parts", inventoryPartsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/maintenance/inventory${path}`);
    return { status: res.status, body: (await res.json()) as Json };
  } finally {
    await closeTestServer(server);
  }
}

const listRow = (over: Record<string, unknown> = {}) => ({
  part_id: PART,
  part_number: "XK-4707",
  description: "Relined brake shoe kit",
  unit_of_measure: "each",
  fleetpal_id: "fpBrake",
  fleetpal_unit: null,
  used_quantity: "311.000",
  used_repairs: 93,
  last_used_at: "2026-10-30T15:00:00+00:00",
  last_price: "43.12",
  total_count: 392,
  ...over,
});

const PART_ROW = {
  id: PART, part_number: "XK-4707", description: "Relined brake shoe kit", manufacturer: null, category: null,
  unit_of_measure: "each", upc: null, image_path: null, last_cost: null, active: true, notes: null,
  fleetpal_id: "fpBrake", fleetpal_unit: null,
};

describe("GET /part-usage — the list", () => {
  it("passes the org, a 90-day window from now, and the defaults: used only, most used first", async () => {
    rec = createSupabaseRecorder({ rpc: { shop_parts_list: [listRow()] } });
    const before = Date.now();
    const { status, body } = await get("/part-usage");
    expect(status).toBe(200);
    const [call] = rec.rpcs();
    expect(call!.fn).toBe("shop_parts_list");
    const args = call!.args as Record<string, unknown>;
    expect(args.p_org_id).toBe(ORG);
    expect(args.p_used_only).toBe(true);
    expect(args.p_sort).toBe("used");
    expect(args.p_descending).toBe(true);
    expect(args.p_search).toBeNull();
    const days = (before - new Date(String(args.p_since)).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(89.99);
    expect(days).toBeLessThan(90.01);
    expect(body.windowDays).toBe(90);
  });

  it("turns PostgREST's strings into numbers and keeps a missing date or price null", async () => {
    rec = createSupabaseRecorder({ rpc: { shop_parts_list: [listRow(), listRow({ part_id: "p2", last_price: null, used_quantity: "0", used_repairs: "0", last_used_at: null })] } });
    const { body } = await get("/part-usage");
    expect(body.total).toBe(392);
    expect(body.rows[0]).toEqual({
      id: PART, partNumber: "XK-4707", description: "Relined brake shoe kit", unitOfMeasure: "each",
      fleetpalId: "fpBrake", usedQuantity: 311, usedRepairs: 93, lastUsedAt: "2026-10-30T15:00:00.000Z",
      lastPrice: 43.12,
    });
    expect(body.rows[1].lastPrice).toBeNull();
    expect(body.rows[1].lastUsedAt).toBeNull();
    expect(body.rows[1].usedQuantity).toBe(0);
  });

  it("passes search, show=all, sort, direction and paging through", async () => {
    rec = createSupabaseRecorder({ rpc: { shop_parts_list: [] } });
    const { body } = await get("/part-usage?search=%20brake%20&show=all&sort=last_used&dir=asc&limit=50&offset=100");
    const args = rec.rpcs()[0]!.args as Record<string, unknown>;
    expect(args).toMatchObject({ p_search: "brake", p_used_only: false, p_sort: "last_used", p_descending: false, p_limit: 50, p_offset: 100 });
    expect(body.total).toBe(0);
  });

  it("refuses a sort SQL does not know before calling it, and passes the price sort", async () => {
    rec = createSupabaseRecorder({ rpc: { shop_parts_list: [] } });
    expect((await get("/part-usage?sort=cost")).status).toBe(400);
    expect(rec.rpcs()).toHaveLength(0);
    expect((await get("/part-usage?sort=last_price")).status).toBe(200);
    expect((rec.rpcs()[0]!.args as Record<string, unknown>).p_sort).toBe("last_price");
  });

  it("a failed read is a 500 with a reference, never an empty list", async () => {
    rec = createSupabaseRecorder({ rpc: { shop_parts_list: { data: null, error: { message: "boom" } } } });
    const { status, body } = await get("/part-usage");
    expect(status).toBe(500);
    expect(body.error.message).toMatch(/Could not load parts \(ref: /);
  });
});

describe("GET /parts/:id/usage — one part", () => {
  const summary = {
    quantity_90d: "311", repairs_90d: 93, quantity_365d: "1200", repairs_365d: 380, units_365d: 140,
    first_used_at: "2025-03-25T00:00:00+00:00", last_used_at: "2026-10-30T15:00:00+00:00",
    last_price: "43.12", typical_price_365d: "43.10", low_price_365d: "40", high_price_365d: "88",
    priced_repairs_365d: 380,
  };
  const history = [
    { work_order_number: 5675, work_order_status: "CLOSED", used_at: "2026-10-30T15:00:00+00:00", unit_number: "T-88",
      vehicle_id: null, trailer_id: TRAILER, quantity: "2", unit_price: "88.00", days_since_previous_on_unit: 12, total_count: 380 },
    { work_order_number: 5600, work_order_status: "OPEN", used_at: null, unit_number: "999",
      vehicle_id: null, trailer_id: null, quantity: "1", unit_price: null, days_since_previous_on_unit: null, total_count: 380 },
  ];

  it("reads both functions with this org and the page's offset, after the part is found", async () => {
    rec = createSupabaseRecorder({
      tables: { parts: { data: PART_ROW } },
      rpc: { shop_part_summary: [summary], shop_part_history: history },
    });
    const { status, body } = await get(`/parts/${PART}/usage?page=3`);
    expect(status).toBe(200);
    expectOrgScoped(rec, ORG);
    const calls = Object.fromEntries(rec.rpcs().map((c) => [c.fn, c.args as Record<string, unknown>]));
    expect(calls.shop_part_summary!.p_org_id).toBe(ORG);
    expect(calls.shop_part_history).toMatchObject({ p_org_id: ORG, p_part_id: PART, p_limit: 25, p_offset: 50 });
    expect(body.total).toBe(380);
    expect(body.summary).toEqual({
      quantity90d: 311, repairs90d: 93, quantity365d: 1200, repairs365d: 380, units365d: 140,
      firstUsedAt: "2025-03-25T00:00:00.000Z", lastUsedAt: "2026-10-30T15:00:00.000Z",
      lastPrice: 43.12, typicalPrice: 43.1, lowPrice365d: 40, highPrice365d: 88, pricedRepairs365d: 380,
    });
  });

  it("a matched trailer links as a trailer; an unmatched unit keeps its number and links nowhere", async () => {
    rec = createSupabaseRecorder({ tables: { parts: { data: PART_ROW } }, rpc: { shop_part_summary: [summary], shop_part_history: history } });
    const { body } = await get(`/parts/${PART}/usage`);
    expect(body.uses[0].unit).toEqual({ kind: "trailer", id: TRAILER, number: "T-88" });
    expect(body.uses[0]).toEqual({
      workOrderNumber: 5675, workOrderStatus: "CLOSED", usedAt: "2026-10-30T15:00:00.000Z",
      unit: { kind: "trailer", id: TRAILER, number: "T-88" }, quantity: 2, unitPrice: 88, daysSincePreviousOnUnit: 12,
    });
    expect(body.uses[1].unitPrice).toBeNull();
    expect(body.uses[1].unit).toEqual({ kind: null, id: null, number: "999" });
    expect(body.uses[1].usedAt).toBeNull();
  });

  it("withholds a typical price that stands on fewer than five repairs, keeps the last price", async () => {
    rec = createSupabaseRecorder({
      tables: { parts: { data: PART_ROW } },
      rpc: { shop_part_summary: [{ ...summary, priced_repairs_365d: 4 }], shop_part_history: [] },
    });
    const { body } = await get(`/parts/${PART}/usage`);
    expect(body.summary.typicalPrice).toBeNull();
    expect(body.summary.lastPrice).toBe(43.12);
  });

  it("is 404 for a part that is not this org's, and calls no usage function", async () => {
    rec = createSupabaseRecorder({ tables: { parts: { data: null } }, rpc: { shop_part_summary: [summary], shop_part_history: history } });
    const { status } = await get(`/parts/${PART}/usage`);
    expect(status).toBe(404);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses page 0", async () => {
    rec = createSupabaseRecorder({ tables: { parts: { data: PART_ROW } } });
    expect((await get(`/parts/${PART}/usage?page=0`)).status).toBe(400);
  });

  it("a failed history read is a 500, not a part with no uses", async () => {
    rec = createSupabaseRecorder({
      tables: { parts: { data: PART_ROW } },
      rpc: { shop_part_summary: [summary], shop_part_history: { data: null, error: { message: "boom" } } },
    });
    const { status } = await get(`/parts/${PART}/usage`);
    expect(status).toBe(500);
  });
});
