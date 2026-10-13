import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { shopSummarySchema } from "@silvicom/shared";
import { closeTestServer } from "../../../testing/httpServer.js";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  type RecordedQuery,
  type SupabaseRecorder,
} from "../../../testing/supabaseRecorder.js";

/**
 * `GET /api/maintenance/shop-summary` — the Operations tab's Shop card (FLEET-MANAGER-HOME-PLAN FM3).
 *
 * The recorder does not filter, so each table's fixture is a FUNCTION of the filters the query
 * actually applied: a work-order read that forgets `status = OPEN` gets the whole table's count back,
 * and one that forgets `is_resolved = false` gets every defect. That is what makes "counts only open
 * ones" a test of the query and not of the fixture.
 */

const ORG = "org-1";
let rec: SupabaseRecorder;

vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: ORG, role: "fleet_manager", email: "office@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { maintenanceRouter } = await import("./index.js");

const has = (q: RecordedQuery, col: string, val: unknown) => q.filters().some((f) => f.col === col && f.val === val);

const line = (partId: string, onHand: number, reorderPoint: number | null) => ({
  part_id: partId, location_id: "loc-1", quantity_on_hand: onHand, reorder_point: reorderPoint, reorder_quantity: 10,
  aisle: null, row: null, bin: null, tag_code: null, active: true,
  parts: { part_number: partId, description: "Oil filter", unit_of_measure: "each", last_cost: null },
  stock_locations: { name: "Main shop" },
});

function recorder(o: { openOrders?: number; workOrderError?: boolean } = {}) {
  const open = o.openOrders ?? 24;
  return createSupabaseRecorder({
    tables: {
      // 24 OPEN of 5,465 — production's split on 2026-10-13 — so a read that drops the status
      // filter answers 5,465, and one that drops the org filter is caught by `expectOrgScoped`.
      fleetpal_work_orders: (q) =>
        o.workOrderError
          ? { data: null, error: { message: "boom" } }
          : has(q, "status", "OPEN")
            ? { data: open ? [{ vendor_created_at: "2026-06-24T15:12:00+00:00" }] : [], count: open }
            : { data: [{ vendor_created_at: "2025-03-25T12:00:00+00:00" }], count: 5465 },
      fleetpal_defects: (q) => (has(q, "is_resolved", false) ? { data: [], count: 52 } : { data: [], count: 60 }),
      part_stock: [line("p1", 1, 4), line("p2", 4, 4), line("p3", 9, 4)],
    },
  });
}

async function call(): Promise<{ status: number; body: { ok?: boolean; data?: unknown } }> {
  const app = express();
  app.use("/api/maintenance", maintenanceRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/maintenance/shop-summary`);
    return { status: res.status, body: (await res.json()) as never };
  } finally {
    await closeTestServer(server);
  }
}

beforeEach(() => {
  rec = recorder();
});

describe("the shop summary", () => {
  it("counts open work orders, unresolved defects and low shelves, in the contract's shape", async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(shopSummarySchema.parse(body.data)).toEqual({
      openWorkOrders: 24,
      oldestOpenWorkOrderAt: "2026-06-24T15:12:00+00:00",
      unresolvedDefects: 52,
      // p1 is under its point and p2 sits on it; p3 is above it. `isLowStock` decides, not this file.
      lowStockLines: 2,
    });
  });

  it("dates the oldest OPEN order, not the oldest order ever", async () => {
    await call();
    const oldest = rec.forTable("fleetpal_work_orders").find((q) => q.ops.some((op) => op.method === "order"));
    expect(oldest && has(oldest, "status", "OPEN")).toBe(true);
  });

  it("scopes every read to the caller's org", async () => {
    await call();
    expect(rec.queries.map((q) => q.table).sort()).toEqual(["fleetpal_defects", "fleetpal_work_orders", "fleetpal_work_orders", "part_stock"]);
    expectOrgScoped(rec, ORG);
  });

  it("has no oldest age when nothing is open, and says zero rather than nothing", async () => {
    rec = recorder({ openOrders: 0 });
    const { body } = await call();
    expect(body.data).toMatchObject({ openWorkOrders: 0, oldestOpenWorkOrderAt: null });
  });

  it("refuses to answer with a partial summary when a read fails", async () => {
    rec = recorder({ workOrderError: true });
    const { status, body } = await call();
    expect(status).toBe(500);
    expect(body.data).toBeUndefined();
    // The database's own text names tables; the caller gets a reference to grep for instead.
    expect(JSON.stringify(body)).not.toContain("boom");
  });
});
