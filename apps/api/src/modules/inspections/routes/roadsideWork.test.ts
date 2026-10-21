import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { RoadsideInspectionWorkDto } from "@silvicom/shared";
import { closeTestServer } from "../../../testing/httpServer.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * The inbox's line of work per inspection — `GET /api/roadside-inspections/work` (Q-IC17, IC15). What it can
 * get wrong that the page's own tests would not see, because the reads are batched here:
 *
 *   1. **Another inspection's rows** — a reading, a repair or a violation filed under the wrong inspection.
 *   2. **Another carrier's rows.**
 *   3. **Stops at the first hundred inspections** (the `.in()` chunk).
 *   4. **Disagrees with the page**: a strong roster reading asked again, an old weak one put in Needs action.
 */

const ORG = "org-1";
let rec: SupabaseRecorder;

vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: ORG, role: "safety_manager", email: "s@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
// Pinned to a Chicago afternoon: "today" is 2026-10-19 on the carrier's calendar.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-10-19T17:00:00Z"));

const { roadsideInspectionsRouter } = await import("./roadside.js");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const inspection = (n: number, date: string) => ({
  id: id(n), org_id: ORG, report_number: `IL${n}`, report_state: "IL", inspection_date: date, level: 2, location_desc: null,
  hazmat_placard_required: false, post_accident: false, violations: 1, driver_oos_total: 0, vehicle_oos_total: 0, hazmat_oos_total: 0,
  vanished_at: null, raw: { mcmis_add_date: "2026-10-01" },
});
/** 120 inspections, so every batch crosses its hundred-id chunk; the three that matter are 1, 2 and 120. */
const INSPECTIONS = Array.from({ length: 120 }, (_, k) => inspection(k + 1, k === 1 ? "2026-05-01" : "2026-10-06"));
const engine = (n: number, o: Record<string, unknown> = {}) => ({
  id: `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, org_id: ORG, inspection_id: id(n), source: "engine", engine_version: "ic5.1",
  created_at: "2026-10-07T00:00:00Z", outcome: "one_driver", confidence: "high", basis: "covering", zone: "America/Chicago", zone_method: "gps",
  started_at: null, ended_at: null, location_check: "confirmed", vehicle_id: null, samsara_vehicle_id: null, samsara_driver_id: "s-ann",
  samsara_driver_name: "Ann (Samsara)", candidates: [], decided_by: null, driver_id: null, note: null, ...o,
});
const ATTRIBUTIONS = [
  // An older, weak reading of inspection 1, listed first: only the newest reading of a source counts.
  engine(1, { id: "a0000000-0000-4000-8000-0000000000aa", created_at: "2026-10-01T00:00:00Z", confidence: "low", basis: "before_only" }),
  engine(1), // strong, on the roster: answered
  engine(2, { confidence: "low", basis: "before_only" }), // weak but older than 90 days: waits
  engine(120, { confidence: "low", basis: "before_only" }), // weak and recent: asks — past the first chunk
  engine(3, { org_id: "org-2", confidence: "low" }), // another carrier's row under our inspection's id
];
const UNIT = "10000000-0000-4000-8000-000000000120";
const REPAIRS = [{
  id: "r0000000-0000-4000-8000-000000000001", org_id: ORG, inspection_id: id(120), inspection_unit_id: UNIT, source: "engine", engine_version: "ic11.1",
  outcome: "no_candidate", due_on: "2026-10-21", candidates: [], decided_by: null, work_order_fleetpal_id: null, note: null, created_at: "2026-10-16T00:00:00Z",
}];
const VIOLATIONS = [
  { id: "v-1", org_id: ORG, inspection_id: id(120), viol_code: "39347D", out_of_service: false, vanished_at: null, unit_id: UNIT, description: "Brakes", part_no: "393" },
];

const inList = (q: RecordedQuery, col: string): unknown[] | undefined => {
  const f = q.filters().find((x) => x.col === col);
  return f === undefined ? undefined : Array.isArray(f.val) ? f.val : [f.val];
};
function scoped<T extends Record<string, unknown>>(rows: T[], q: RecordedQuery, cols: string[]): T[] {
  const out = rows.filter((r) => cols.every((c) => inList(q, c) === undefined || inList(q, c)!.includes(r[c])));
  const range = q.ops.find((o) => o.method === "range")?.args as [number, number] | undefined;
  return range ? out.slice(range[0], range[1] + 1) : out;
}

beforeEach(() => {
  rec = createSupabaseRecorder({
    tables: {
      organizations: () => ({ data: [{ operating_hours: { tz: "America/Chicago" } }] }),
      // The day window applied, not just recorded (the recorder does not filter): the window test needs it.
      roadside_inspections: (q) => {
        const day = (m: string) => q.ops.find((o) => o.method === m && o.args[0] === "inspection_date")?.args[1] as string | undefined;
        const [lo, hi] = [day("gte"), day("lte")];
        return { data: scoped(INSPECTIONS.filter((i) => (!lo || i.inspection_date >= lo) && (!hi || i.inspection_date <= hi)), q, ["org_id"]) };
      },
      roadside_violations: (q) => ({ data: scoped(VIOLATIONS, q, ["org_id", "inspection_id"]) }),
      roadside_citations: () => ({ data: [] }),
      roadside_inspection_units: (q) => ({ data: scoped([{ id: UNIT, org_id: ORG, inspection_id: id(120), unit_seq: 1, unit_type_id: "11", company_number: "612" }], q, ["org_id", "inspection_id"]) }),
      inspection_attributions: (q) => ({ data: scoped(ATTRIBUTIONS, q, ["org_id", "inspection_id"]) }),
      inspection_repairs: (q) => ({ data: scoped(REPAIRS, q, ["org_id", "inspection_id"]) }),
      inspection_repair_certifications: () => ({ data: [] }),
      documents: () => ({ data: [] }),
      drivers: (q) => ({ data: scoped([{ id: "d-ann", org_id: ORG, full_name: "Ann Roster", samsara_driver_id: "s-ann" }], q, ["org_id", "samsara_driver_id", "id"]) }),
      memberships: () => ({ data: [] }),
      profiles: () => ({ data: [] }),
    },
  });
});

async function get(path = "/work"): Promise<{ status: number; data: RoadsideInspectionWorkDto[] }> {
  const app = express();
  app.use("/api/roadside-inspections", roadsideInspectionsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/roadside-inspections${path}`);
    return { status: res.status, data: ((await res.json()) as { data: RoadsideInspectionWorkDto[] }).data };
  } finally {
    await closeTestServer(server);
  }
}
const of = (rows: RoadsideInspectionWorkDto[], n: number) => rows.find((r) => r.id === id(n))!;

describe("the inbox's line of work", () => {
  it("answers a strong roster reading, asks a recent weak one, and leaves an old one waiting", async () => {
    const { status, data } = await get();
    expect(status).toBe(200);
    expect(data).toHaveLength(120);
    expect(of(data, 1)).toMatchObject({ driver: { name: "Ann Roster", by: "samsara" }, open: { total: 0 }, next: null });
    expect(of(data, 2)).toMatchObject({ driver: { name: "Ann Roster", by: "samsara" }, open: { total: 0 } });
    expect(of(data, 120).open).toEqual({ total: 3, byOwner: { safety: 2, maintenance: 1 } });
    expect(of(data, 120).next).toEqual({ title: "Truck 612: name the repair", owner: "maintenance", dueOn: "2026-10-21", clock: { overdue: false, days: 2 } });
  });

  it("never reads another carrier's row into one of ours", async () => {
    const { data } = await get();
    // org-2's weak reading under inspection 3's id would have opened its driver step.
    expect(of(data, 3)).toMatchObject({ driver: null, open: { total: 0 } });
    expectOrgScoped(rec, ORG, { exempt: ["memberships", "profiles"] });
  });

  it("gives each inspection its own CSA points", async () => {
    const { data } = await get();
    expect(of(data, 120).points).toBeGreaterThan(0);
    expect(of(data, 1).points).toBe(0);
  });

  it("refuses a day that does not exist", async () => {
    expect((await get("/work?from=2026-02-31")).status).toBe(400);
  });

  // D-RLY10: the window's repairs only. Inspection 2 is inside the year's repair horizon but outside this
  // window, so before the fix its repair rows were read on every card refresh and thrown away.
  it("reads the repairs of the window's inspections and no others", async () => {
    const { data } = await get("/work?from=2026-10-01");
    expect(data).toHaveLength(119);
    expect(of(data, 120).next).toMatchObject({ title: "Truck 612: name the repair" });
    const asked = ["inspection_repairs", "roadside_inspection_units"].flatMap((t) => rec.forTable(t).flatMap((q) => inList(q, "inspection_id") ?? []));
    expect(asked).toContain(id(120));
    expect(asked).not.toContain(id(2));
  });
});
