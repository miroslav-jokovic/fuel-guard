import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { RoadsideRepairDto } from "@silvicom/shared";
import { closeTestServer } from "../../../testing/httpServer.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * The repair record — `GET`/`POST /api/roadside-inspections/:id/repairs` (INSPECTION-CHALLENGE-PLAN IC11,
 * D-IC14; Q-IC13). Pinned: the card reads on the safety section but the decision needs the MAINTENANCE
 * section's manage level; a decision restates the proposal it was made over, may only accept a proposed work
 * order, and is refused over a row that is no longer the unit's newest. Fixtures filter on the query's own
 * `org_id`, inspection and unit, so a read that forgets one gets another carrier's or another unit's rows.
 */

const ORG = "org-1";
const INSP = "11111111-1111-4111-8111-111111111111";
const UNIT = "22222222-2222-4222-8222-222222222222";
const ENGINE = "33333333-3333-4333-8333-333333333333";
const OLDER = "44444444-4444-4444-8444-444444444444";
const OTHER_UNIT = "55555555-5555-4555-8555-555555555555";

let rec: SupabaseRecorder;
/** The sections the caller manages; anything else they only view. */
let manages = new Set(["safety", "maintenance"]);

vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: ORG, role: "fleet_manager", email: "fm@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: (section: string, level = "manage") => (_req: Request, res: Response, next: NextFunction) =>
    level !== "view" && !manages.has(section) ? void res.status(403).json({ error: { code: "forbidden" } }) : next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { roadsideInspectionsRouter } = await import("./roadside.js");

const candidate = (id: string) => ({ workOrderId: id, reference: `WO-${id}`, openedOn: "2026-10-07", status: "CLOSED", completedAt: null, description: null, jobs: ["Brake chamber"] });
const row = (o: Record<string, unknown>) => ({
  id: ENGINE, org_id: ORG, inspection_id: INSP, inspection_unit_id: UNIT, source: "engine", engine_version: "ic11.1", outcome: "several_candidates",
  due_on: "2026-10-21", candidates: [candidate("wo-1"), candidate("wo-2")], decided_by: null, work_order_fleetpal_id: null, note: null,
  created_at: "2026-10-16T12:00:00Z", ...o,
});
const REPAIRS = [
  row({}),
  row({ id: OLDER, outcome: "one_candidate", candidates: [candidate("wo-1")], created_at: "2026-10-08T12:00:00Z" }),
  row({ id: "x-other-unit", inspection_unit_id: OTHER_UNIT, created_at: "2026-10-17T12:00:00Z" }),
  row({ id: "x-other-org", org_id: "org-2", created_at: "2026-10-18T12:00:00Z" }),
];

const val = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;
const filtered = <T extends Record<string, unknown>>(rows: T[], q: RecordedQuery, cols: string[]) =>
  rows.filter((r) => cols.every((c) => val(q, c) === undefined || r[c] === val(q, c)));

function recorder(extra: Record<string, unknown>[] = []) {
  return createSupabaseRecorder({
    tables: {
      inspection_repairs: (q) => (q.write ? { data: { id: "new-1" } } : { data: filtered([...REPAIRS, ...extra], q, ["org_id", "inspection_id", "inspection_unit_id"]) }),
      roadside_inspection_units: (q) =>
        ({ data: filtered([{ id: UNIT, org_id: ORG, inspection_id: INSP, unit_seq: 1, unit_type_id: "11", company_number: "1234" }], q, ["org_id", "inspection_id"]) }),
      roadside_violations: (q) =>
        ({ data: filtered([{ unit_id: UNIT, org_id: ORG, inspection_id: INSP, viol_code: "393.47D", description: "Brakes out of adjustment" }], q, ["org_id", "inspection_id"]) }),
      memberships: () => ({ data: [] }),
      profiles: () => ({ data: [] }),
      audit_logs: () => ({ data: [] }),
    },
  });
}

type Body = { ok?: boolean; data?: unknown; error?: { code: string } };
async function send(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: Body }> {
  const app = express();
  app.use(express.json());
  app.use("/api/roadside-inspections", roadsideInspectionsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/roadside-inspections${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Body };
  } finally {
    await closeTestServer(server);
  }
}

beforeEach(() => {
  rec = recorder();
  manages = new Set(["safety", "maintenance"]);
});

describe("the repair record", () => {
  it("shows each violated unit's latest proposal, its violations and the row to decide over", async () => {
    const res = await send("GET", `/${INSP}/repairs`);
    expect(res.status).toBe(200);
    const [unit, ...rest] = res.body.data as RoadsideRepairDto[];
    expect(rest).toHaveLength(1); // the other unit; never the other carrier's row
    expect(unit).toMatchObject({
      unitId: UNIT, unit: { seq: 1, kind: "tractor", companyNumber: "1234" }, dueOn: "2026-10-21", basedOn: ENGINE, decision: null,
      violations: [{ code: "393.47D", description: "Brakes out of adjustment" }],
    });
    expect(unit!.proposal.outcome).toBe("several_candidates");
    expectOrgScoped(rec, ORG, { exempt: ["memberships", "profiles"] });
  });

  it("is read on the safety section alone", async () => {
    manages = new Set();
    expect((await send("GET", `/${INSP}/repairs`)).status).toBe(200);
  });
});

describe("maintenance names the repair (Q-IC13)", () => {
  it("records an accepted work order as the signed-in person, restating the proposal", async () => {
    const res = await send("POST", `/${INSP}/repairs`, { action: "accept", unitId: UNIT, basedOn: ENGINE, workOrderId: "wo-2" });
    expect(res.status).toBe(201);
    expect(rec.writtenRows("inspection_repairs")[0]).toMatchObject({
      org_id: ORG, inspection_id: INSP, inspection_unit_id: UNIT, source: "person", decided_by: "u-1", outcome: "accepted",
      work_order_fleetpal_id: "wo-2", due_on: "2026-10-21", engine_version: "ic11.1", note: null,
    });
    expect(rec.writtenRows("audit_logs")[0]).toMatchObject({ action: "roadside.repair_accepted" });
  });

  it("records a repair outside FleetPal with where it was done", async () => {
    const res = await send("POST", `/${INSP}/repairs`, { action: "outside", unitId: UNIT, basedOn: ENGINE, note: "TA Joliet, invoice 8812" });
    expect(res.status).toBe(201);
    expect(rec.writtenRows("inspection_repairs")[0]).toMatchObject({ outcome: "repaired_outside_fleetpal", work_order_fleetpal_id: null, note: "TA Joliet, invoice 8812" });
  });

  it("⚠ refuses a work order the proposal did not list", async () => {
    const res = await send("POST", `/${INSP}/repairs`, { action: "accept", unitId: UNIT, basedOn: ENGINE, workOrderId: "wo-9" });
    expect([res.status, res.body.error?.code]).toEqual([422, "not_proposed"]);
    expect(rec.writtenRows("inspection_repairs")).toHaveLength(0);
  });

  it("⚠ refuses a decision over a row that is no longer the unit's newest", async () => {
    const res = await send("POST", `/${INSP}/repairs`, { action: "accept", unitId: UNIT, basedOn: OLDER, workOrderId: "wo-1" });
    expect([res.status, res.body.error?.code]).toEqual([409, "changed"]);
  });

  it("answers 404 for a unit with no repair record on this inspection", async () => {
    const res = await send("POST", `/${INSP}/repairs`, { action: "accept", unitId: "66666666-6666-4666-8666-666666666666", basedOn: ENGINE, workOrderId: "wo-1" });
    expect(res.status).toBe(404);
  });

  it("refuses 'outside FleetPal' without saying where", async () => {
    expect((await send("POST", `/${INSP}/repairs`, { action: "outside", unitId: UNIT, basedOn: ENGINE, note: "  " })).status).toBe(400);
  });

  it("⚠ needs the maintenance section's manage level — safety's is not enough", async () => {
    manages = new Set(["safety"]);
    const res = await send("POST", `/${INSP}/repairs`, { action: "accept", unitId: UNIT, basedOn: ENGINE, workOrderId: "wo-1" });
    expect(res.status).toBe(403);
    expect(rec.writtenRows("inspection_repairs")).toHaveLength(0);
  });
});
