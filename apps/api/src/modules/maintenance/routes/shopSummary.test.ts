import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { shopSummarySchema, type ShopDefectDto, type ShopWorkOrderDto } from "@silvicom/shared";
import { closeTestServer } from "../../../testing/httpServer.js";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  type RecordedQuery,
  type SupabaseRecorder,
} from "../../../testing/supabaseRecorder.js";

/**
 * `GET /api/maintenance/shop-summary`, `/work-orders` and `/defects` — the Operations tab's Shop card
 * and the two lists behind it (FLEET-MANAGER-HOME-PLAN FM3, Q-FM6 (a)).
 *
 * The recorder does not filter, so each table's fixture is a FUNCTION of the filters the query
 * actually applied: a work-order read that forgets `status = OPEN` gets the closed and cancelled rows
 * back too, and one that forgets `is_resolved = false` gets every defect. That is what makes "counts
 * only open ones" a test of the query and not of the fixture.
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

const wo = (id: string, status: string, at: string | null, unit: string | null = "fpu-1") => ({
  id, status, reference_number: `WO-${id}`, unit_fleetpal_id: unit, description: "Brake chamber", priority: "HIGH", vendor_created_at: at,
});
// Three OPEN — one undated, one on a unit nobody staged — beside the settled and the cancelled.
const WORK_ORDERS = [
  wo("w1", "OPEN", "2026-08-02T10:00:00+00:00"),
  wo("w2", "OPEN", "2026-06-24T15:12:00+00:00", "fpu-unknown"),
  wo("w3", "OPEN", null, null),
  wo("w4", "CLOSED", "2025-03-25T12:00:00+00:00"),
  wo("w5", "COMPLETED", "2026-09-19T12:00:00+00:00"),
  wo("w6", "CANCELED", "2025-04-01T12:00:00+00:00"),
];
const defect = (id: string, resolved: boolean | null) => ({
  id, is_resolved: resolved, unit_fleetpal_id: "fpu-1", name: "Air leak", description: "Left rear",
  driver_comment: "Hissing at the trailer glad hand", detected_on: "2026-09-30T13:00:00+00:00",
});
const DEFECTS = [defect("d1", false), defect("d2", false), defect("d3", true), defect("d4", null)];

const line = (partId: string, onHand: number, reorderPoint: number | null) => ({
  part_id: partId, location_id: "loc-1", quantity_on_hand: onHand, reorder_point: reorderPoint, reorder_quantity: 10,
  aisle: null, row: null, bin: null, tag_code: null, active: true,
  parts: { part_number: partId, description: "Oil filter", unit_of_measure: "each", last_cost: null },
  stock_locations: { name: "Main shop" },
});

/**
 * The fixture answers on the filters applied, and sorts the way the query asked, so the route's
 * "oldest first, undated last" is the database's order and not the fixture's.
 */
function recorder(o: { noneOpen?: boolean; workOrderError?: boolean } = {}) {
  return createSupabaseRecorder({
    tables: {
      fleetpal_work_orders: (q) => {
        if (o.workOrderError) return { data: null, error: { message: "relation fleetpal_work_orders: boom" } };
        const rows = WORK_ORDERS.filter((r) => !has(q, "status", "OPEN") || r.status === "OPEN").filter(() => !o.noneOpen);
        // The first `.order()` is the date; honour its direction, with undated rows last either way.
        const asc = (q.ops.find((op) => op.method === "order")?.args[1] as { ascending?: boolean } | undefined)?.ascending !== false;
        return [...rows].sort((x, y) => {
          if (!x.vendor_created_at || !y.vendor_created_at) return x.vendor_created_at ? -1 : y.vendor_created_at ? 1 : 0;
          return (asc ? 1 : -1) * x.vendor_created_at.localeCompare(y.vendor_created_at);
        });
      },
      fleetpal_defects: (q) => DEFECTS.filter((d) => !has(q, "is_resolved", false) || d.is_resolved === false),
      fleetpal_units: [{ fleetpal_id: "fpu-1", number: "654" }],
      part_stock: [line("p1", 1, 4), line("p2", 4, 4), line("p3", 9, 4)],
    },
  });
}

async function call(path: string): Promise<{ status: number; body: { ok?: boolean; data?: unknown } }> {
  const app = express();
  app.use("/api/maintenance", maintenanceRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/maintenance/${path}`);
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
    const { status, body } = await call("shop-summary");
    expect(status).toBe(200);
    expect(shopSummarySchema.parse(body.data)).toEqual({
      openWorkOrders: 3,
      oldestOpenWorkOrderAt: "2026-06-24T15:12:00+00:00",
      unresolvedDefects: 2,
      // p1 is under its point and p2 sits on it; p3 is above it. `isLowStock` decides, not this file.
      lowStockLines: 2,
    });
  });

  it("gives each count as the length of the list its door opens (D-FM7)", async () => {
    const summary = (await call("shop-summary")).body.data as { openWorkOrders: number; unresolvedDefects: number };
    rec = recorder();
    const orders = (await call("work-orders")).body.data as unknown[];
    rec = recorder();
    const defects = (await call("defects")).body.data as unknown[];
    expect([summary.openWorkOrders, summary.unresolvedDefects]).toEqual([orders.length, defects.length]);
  });

  it("has no oldest age when nothing is open, and says zero rather than nothing", async () => {
    rec = recorder({ noneOpen: true });
    const { body } = await call("shop-summary");
    expect(body.data).toMatchObject({ openWorkOrders: 0, oldestOpenWorkOrderAt: null });
  });

  it("refuses to answer with a partial summary when a read fails, and never echoes the database", async () => {
    rec = recorder({ workOrderError: true });
    const { status, body } = await call("shop-summary");
    expect(status).toBe(500);
    expect(body.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("boom");
  });
});

describe("the lists behind it", () => {
  it("lists only OPEN work orders, oldest first and undated last, with FleetPal's unit number", async () => {
    const rows = (await call("work-orders")).body.data as ShopWorkOrderDto[];
    expect(rows.map((r) => r.id)).toEqual(["w2", "w1", "w3"]);
    expect(rows[1]).toEqual({
      id: "w1", referenceNumber: "WO-w1", unitNumber: "654", description: "Brake chamber", priority: "HIGH",
      openedAt: "2026-08-02T10:00:00+00:00",
    });
    // A unit nobody staged, and an order naming no unit, both stay on the list — with no number.
    expect([rows[0]!.unitNumber, rows[2]!.unitNumber]).toEqual([null, null]);
  });

  it("lists only defects FleetPal says are unresolved — not resolved ones, and not ones it never said", async () => {
    const rows = (await call("defects")).body.data as ShopDefectDto[];
    expect(rows.map((r) => r.id)).toEqual(["d1", "d2"]);
    expect(rows[0]).toMatchObject({ unitNumber: "654", name: "Air leak", driverComment: "Hissing at the trailer glad hand" });
  });

  it("scopes every read on all three routes to the caller's org", async () => {
    for (const path of ["shop-summary", "work-orders", "defects"]) {
      rec = recorder();
      await call(path);
      expect(rec.forTable("fleetpal_units").length, path).toBeGreaterThan(0);
      expectOrgScoped(rec, ORG);
    }
  });
});
