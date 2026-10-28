import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { shopSummarySchema, type AnnualDisagreementDto, type ShopDefectDto, type ShopWorkOrderDto } from "@silvicom/shared";
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

/**
 * The annual check (Q-DBV2), judged on 2026-10-16 (the clock is set below). Our record per unit, and
 * FleetPal's annual schedule for it:
 * - 654: ours 2027-03-01, FleetPal 12 months from 2026-04-01 → 31 days apart, both valid: disagrees.
 *   Its schedule also carries a 24-month interval; whichever comes first decides, so 2027-04-01.
 * - 655: ours 2027-03-01, FleetPal 365 days from 2026-03-05 → 4 days apart: agrees.
 * - 656: no record of ours, FleetPal due 2027-01-01: disagrees (the board shows it nothing).
 * - 657: ours, and FleetPal schedules no annual (only an oil change): nothing to compare.
 * - 658: retired, with a stale FleetPal annual: not in service, so not on the list.
 * - trailer 9001: ours valid to 2026-11-20, FleetPal's lapsed 2026-10-10 → verdicts differ.
 * - 659: two annual schedules (a typo'd duplicate) — the LATER one (2027-02-01) is FleetPal's word,
 *   one day off ours: agrees. Taking the earlier (2026-05-01) would flag it as lapsed.
 * - 660: ours 2027-03-01, FleetPal 2028-06-01 — the widest gap of all, but both valid, so it sorts
 *   AFTER the trailer whose verdicts differ.
 */
const inService = (q: RecordedQuery) => (r: { status: string }) => {
  const f = q.filters().find((x) => x.col === "status");
  return !f || (Array.isArray(f.val) && f.val.includes(r.status));
};
const VEHICLES = [
  { id: "v-654", unit_number: "654", status: "active", dot_annual_inspection_expires_at: "2027-03-01" },
  { id: "v-655", unit_number: "655", status: "active", dot_annual_inspection_expires_at: "2027-03-01" },
  { id: "v-656", unit_number: "656", status: "maintenance", dot_annual_inspection_expires_at: null },
  { id: "v-657", unit_number: "657", status: "active", dot_annual_inspection_expires_at: "2027-01-01" },
  { id: "v-658", unit_number: "658", status: "retired", dot_annual_inspection_expires_at: "2027-06-01" },
  { id: "v-659", unit_number: "659", status: "active", dot_annual_inspection_expires_at: "2027-01-31" },
  { id: "v-660", unit_number: "660", status: "active", dot_annual_inspection_expires_at: "2027-03-01" },
];
const TRAILERS = [{ id: "t-9001", unit_number: "9001", status: "active", dot_annual_inspection_expires_at: "2026-11-20" }];
const UNITS = [
  { fleetpal_id: "fpu-1", number: "654", vehicle_id: "v-654", trailer_id: null },
  { fleetpal_id: "fpu-2", number: "655", vehicle_id: "v-655", trailer_id: null },
  { fleetpal_id: "fpu-3", number: "656", vehicle_id: "v-656", trailer_id: null },
  { fleetpal_id: "fpu-4", number: "657", vehicle_id: "v-657", trailer_id: null },
  { fleetpal_id: "fpu-5", number: "658", vehicle_id: "v-658", trailer_id: null },
  { fleetpal_id: "fpu-6", number: "9001", vehicle_id: null, trailer_id: "t-9001" },
  { fleetpal_id: "fpu-7", number: "659", vehicle_id: "v-659", trailer_id: null },
  { fleetpal_id: "fpu-8", number: "660", vehicle_id: "v-660", trailer_id: null },
];
const sched = (id: string, unit: string, name: string, lastDone: string) => ({ fleetpal_id: id, unit_fleetpal_id: unit, name, last_done: lastDone });
const SCHEDULES = [
  sched("s1", "fpu-1", "Annual DOT Inspection", "2026-04-01T14:00:00Z"),
  sched("s2", "fpu-2", "DOT Annual", "2026-03-05T14:00:00Z"),
  sched("s3", "fpu-3", "Annual DOT Inspection", "2026-01-01T14:00:00Z"),
  sched("s4", "fpu-4", "Oil Change", "2026-09-01T14:00:00Z"),
  sched("s5", "fpu-5", "Annual DOT Inspection", "2024-01-01T14:00:00Z"),
  sched("s6", "fpu-6", "Annual lDOT Inspection", "2025-10-10T14:00:00Z"),
  sched("s7", "fpu-7", "Annual DOT Inspection", "2026-02-01T14:00:00Z"),
  sched("s8", "fpu-7", "Annual DOT Inspecton", "2025-05-01T14:00:00Z"),
  sched("s9", "fpu-8", "DOT Annual", "2027-06-01T14:00:00Z"),
];
const interval = (schedule: string, value: number, unit: string) => ({
  pm_schedule_fleetpal_id: schedule, interval_type: "TIME", value_int: value, value_time_type: unit, threshold_int: 30, threshold_time_type: "DAY", last_done_meter_value: null,
});
const INTERVALS = [
  interval("s1", 12, "MONTH"), interval("s1", 24, "MONTH"), interval("s9", 12, "MONTH"), interval("s2", 365, "DAY"), interval("s3", 12, "MONTH"), interval("s4", 6, "MONTH"),
  interval("s5", 12, "MONTH"), interval("s6", 12, "MONTH"), interval("s7", 12, "MONTH"), interval("s8", 1, "YEAR"),
];

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
      fleetpal_units: UNITS,
      fleetpal_pm_schedules: SCHEDULES,
      fleetpal_pm_intervals: INTERVALS,
      vehicles: (q) => VEHICLES.filter(inService(q)),
      trailers: (q) => TRAILERS.filter(inService(q)),
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
  // Only the Date: the routes' own server and fetch must keep real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T15:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
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
      annualDisagreements: 4,
    });
  });

  it("gives each count as the length of the list its door opens (D-FM7)", async () => {
    const summary = (await call("shop-summary")).body.data as { openWorkOrders: number; unresolvedDefects: number; annualDisagreements: number };
    rec = recorder();
    const orders = (await call("work-orders")).body.data as unknown[];
    rec = recorder();
    const defects = (await call("defects")).body.data as unknown[];
    rec = recorder();
    const annuals = (await call("annual-disagreements")).body.data as unknown[];
    expect([summary.openWorkOrders, summary.unresolvedDefects, summary.annualDisagreements])
      .toEqual([orders.length, defects.length, annuals.length]);
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

  it("lists the units whose annual FleetPal and our record disagree on, the ones the board would read differently first", async () => {
    const rows = (await call("annual-disagreements")).body.data as AnnualDisagreementDto[];
    // Verdicts that differ first — no record of ours at all, then the trailer the board calls valid and
    // FleetPal lapsed — then the widest gap among the rest.
    expect(rows.map((r) => r.unitNumber)).toEqual(["656", "9001", "660", "654"]);
    expect(rows[1]).toEqual({
      subjectType: "trailer", unitId: "t-9001", unitNumber: "9001", ourExpiresOn: "2026-11-20", fleetpalDueOn: "2026-10-10",
      ours: "valid", fleetpal: "expired", gapDays: -41,
    });
    expect(rows[3]).toMatchObject({ subjectType: "tractor", ours: "valid", fleetpal: "valid", gapDays: 31, fleetpalDueOn: "2027-04-01" });
    expect(rows[0]).toMatchObject({ ourExpiresOn: null, ours: "unknown", fleetpalDueOn: "2027-01-01", gapDays: null });
  });

  /**
   * The worklist's annual group (D-MX2, Q-MX5 (a)). The clock is 2026-10-16: 9001 (11/20) is 35 days
   * out and NOT due; 657 (2027-01-01) and 659 are valid; a unit with no record (656) is unknown, not
   * due. The fixture below adds one expiring and one overdue truck to prove membership and order.
   */
  it("lists the annual inspections due within 30 days or overdue, soonest first, by our record", async () => {
    rec = createSupabaseRecorder({
      tables: {
        vehicles: (q) =>
          [
            ...VEHICLES,
            { id: "v-700", unit_number: "700", status: "active", dot_annual_inspection_expires_at: "2026-10-30" },
            { id: "v-701", unit_number: "701", status: "active", dot_annual_inspection_expires_at: "2026-10-10" },
          ].filter(inService(q)),
        trailers: (q) => [...TRAILERS, { id: "t-9002", unit_number: "9002", status: "active", dot_annual_inspection_expires_at: "2026-11-14" }].filter(inService(q)),
      },
    });
    const { status, body } = await call("annual-due");
    expect(status).toBe(200);
    const rows = body.data as import("@silvicom/shared").AnnualDueDto[];
    expect(rows.map((r) => [r.unitNumber, r.daysRemaining])).toEqual([
      ["701", -6],
      ["700", 14],
      ["9002", 29],
    ]);
    expect(rows[2]).toEqual({ subjectType: "trailer", unitId: "t-9002", unitNumber: "9002", expiresOn: "2026-11-14", daysRemaining: 29 });
    expectOrgScoped(rec, ORG);
  });

  it("refuses the annual-due list whole when a read fails, never echoing the database", async () => {
    rec = createSupabaseRecorder({ tables: { vehicles: { data: null, error: { message: "relation vehicles: boom" } }, trailers: TRAILERS } });
    const { status, body } = await call("annual-due");
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("relation");
  });

  it("refuses the annual list whole when a read fails, never echoing the database", async () => {
    rec = createSupabaseRecorder({ tables: { vehicles: () => ({ data: null, error: { message: "relation vehicles: boom" } }) } });
    const { status, body } = await call("annual-disagreements");
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("boom");
  });

  it("scopes every read on all four routes to the caller's org", async () => {
    for (const path of ["shop-summary", "work-orders", "defects", "annual-disagreements"]) {
      rec = recorder();
      await call(path);
      expect(rec.forTable("fleetpal_units").length, path).toBeGreaterThan(0);
      expectOrgScoped(rec, ORG);
    }
  });
});
