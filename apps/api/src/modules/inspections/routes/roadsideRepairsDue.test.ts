import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { RoadsideRepairDueDto } from "@silvicom/shared";
import { closeTestServer } from "../../../testing/httpServer.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * The Shop's "Roadside repairs due" — `GET /api/roadside-inspections/repairs-due` (Q-IC16 (a), IC11 B2b).
 * What it can get wrong:
 *
 *   1. **Gated on safety** like the rest of the router — the technician it exists for is refused.
 *   2. **Another carrier's rows**, or a unit's row under the wrong inspection.
 *   3. **Stops at the first hundred inspections**, or at PostgREST's 1,000 rows, without saying so — a list
 *      that ends early is believed.
 *   4. **Not soonest-due first** — the Shop home cuts its preview from the top.
 */

const ORG = "org-1";
let rec: SupabaseRecorder;
const gates: { section: string; level: string }[] = [];

vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: ORG, role: "technician", email: "t@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  // Records which gate each route asked for; the order matches declaration.
  requireSection: (section: string, level = "manage") => {
    const gate = { section, level };
    return (_req: Request, _res: Response, next: NextFunction) => {
      gates.push(gate);
      next();
    };
  },
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { roadsideInspectionsRouter } = await import("./roadside.js");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** 130 inspections, so the read must cross its hundred-id chunk; each has one tractor. */
const INSPECTIONS = Array.from({ length: 130 }, (_, i) => ({
  id: id(i + 1), org_id: ORG, report_number: `IL${i + 1}`, report_state: "IL", inspection_date: "2026-10-01", level: 2, location_desc: "I-55",
  hazmat_placard_required: false, violations: 1, driver_oos_total: 0, vehicle_oos_total: 0, hazmat_oos_total: 0, vanished_at: null,
}));
const unitId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const UNITS = INSPECTIONS.map((i, k) => ({ id: unitId(k + 1), org_id: ORG, inspection_id: i.id, unit_seq: 1, unit_type_id: "11", company_number: String(600 + k) }));
const engineRow = (k: number, o: Record<string, unknown> = {}) => ({
  id: `20000000-0000-4000-8000-${String(k).padStart(12, "0")}`, org_id: ORG, inspection_id: id(k), inspection_unit_id: unitId(k), source: "engine",
  engine_version: "ic11.1", outcome: "no_candidate", due_on: "2026-10-16", candidates: [], decided_by: null, work_order_fleetpal_id: null, note: null,
  created_at: "2026-10-16T12:00:00Z", ...o,
});
/** One row on the FIRST and the LAST inspection (the last lies past the first chunk), a later due day first. */
let repairs: Record<string, unknown>[] = [];

const inList = (q: RecordedQuery, col: string): unknown[] | undefined => {
  const f = q.filters().find((x) => x.col === col);
  return f === undefined ? undefined : Array.isArray(f.val) ? f.val : [f.val];
};
function scoped<T extends Record<string, unknown>>(rows: T[], q: RecordedQuery, cols: string[]): T[] {
  const out = rows.filter((r) => cols.every((c) => inList(q, c) === undefined || inList(q, c)!.includes(r[c])));
  const range = q.ops.find((o) => o.method === "range")?.args as [number, number] | undefined;
  return range ? out.slice(range[0], range[1] + 1) : out;
}

function recorder() {
  return createSupabaseRecorder({
    tables: {
      organizations: () => ({ data: [{ operating_hours: { tz: "America/Chicago" } }] }),
      roadside_inspections: (q) => ({ data: scoped(INSPECTIONS, q, ["org_id"]) }),
      // Honours the order the query asks for, so "the FIRST engine reading" is a property of the read (RR4).
      inspection_repairs: (q) => {
        const rows = scoped(repairs, q, ["org_id", "inspection_id", "source"]);
        const order = q.ops.find((o) => o.method === "order" && o.args[0] === "created_at")?.args as [string, { ascending?: boolean }] | undefined;
        const sorted = order ? [...rows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) * (order[1]?.ascending === false ? -1 : 1)) : rows;
        return { data: sorted };
      },
      roadside_inspection_units: (q) => ({ data: scoped(UNITS, q, ["org_id", "inspection_id"]) }),
      roadside_violations: () => ({ data: [] }),
      memberships: () => ({ data: [] }),
      profiles: () => ({ data: [] }),
    },
  });
}

async function get(): Promise<{ status: number; data: RoadsideRepairDueDto[] }> {
  const app = express();
  app.use("/api/roadside-inspections", roadsideInspectionsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/roadside-inspections/repairs-due`);
    return { status: res.status, data: ((await res.json()) as { data: RoadsideRepairDueDto[] }).data };
  } finally {
    await closeTestServer(server);
  }
}

beforeEach(() => {
  rec = recorder();
  gates.length = 0;
  repairs = [
    engineRow(1, { due_on: "2026-10-25" }),
    engineRow(130, { due_on: "2026-10-16" }),
    engineRow(2, { org_id: "org-2", due_on: "2026-10-01" }),
  ];
});

describe("the Shop's roadside repairs", () => {
  it("is read on the MAINTENANCE section, not safety's", async () => {
    expect((await get()).status).toBe(200);
    expect(gates).toEqual([{ section: "maintenance", level: "view" }]);
  });

  it("lists every unit with its own inspection, past the first hundred inspections, soonest due first, never another carrier's", async () => {
    const { data } = await get();
    expect(data.map((r) => [r.inspection.reportNumber, r.unit.companyNumber, r.dueOn])).toEqual([
      ["IL130", "729", "2026-10-16"],
      ["IL1", "600", "2026-10-25"],
    ]);
    expect(data[0]!.inspection).toEqual({ id: id(130), reportNumber: "IL130", reportState: "IL", inspectionDate: "2026-10-01", locationDesc: "I-55" });
    expectOrgScoped(rec, ORG, { exempt: ["memberships", "profiles"] });
  });

  it("reads past PostgREST's 1,000 repair rows rather than stopping at them", async () => {
    // 1,200 re-reads of the first unit, the newest last — a read that stops at 1,000 shows a stale proposal.
    repairs = Array.from({ length: 1200 }, (_, k) =>
      engineRow(1, { id: `30000000-0000-4000-8000-${String(k).padStart(12, "0")}`, outcome: k === 1199 ? "one_candidate" : "no_candidate", created_at: new Date(Date.UTC(2026, 9, 1, 0, k)).toISOString() }),
    );
    const { data } = await get();
    expect(data).toHaveLength(1);
    expect(data[0]!.proposal.outcome).toBe("one_candidate");
  });

  it("marks a unit inspected before the carrier's repair record began — its first engine reading, on its own clock (RR4)", async () => {
    const at = (k: number, inspection_date: string) => Object.assign(INSPECTIONS[k - 1]!, { inspection_date });
    at(1, "2026-10-15");
    at(130, "2026-10-16");
    // The first reading: 03:00 UTC on 10-17 is still 10-16 in Chicago. A later reading must not move the start.
    repairs = [
      engineRow(1, { due_on: "2026-10-30", created_at: "2026-10-20T12:00:00Z" }),
      engineRow(130, { due_on: "2026-10-31", created_at: "2026-10-17T03:00:00Z" }),
      engineRow(2, { org_id: "org-2", created_at: "2026-01-01T00:00:00Z" }),
    ];
    const { data } = await get();
    expect(data.map((r) => [r.inspection.reportNumber, r.beforeRecord])).toEqual([["IL1", true], ["IL130", false]]);
    at(1, "2026-10-01");
    at(130, "2026-10-01");
  });
});
