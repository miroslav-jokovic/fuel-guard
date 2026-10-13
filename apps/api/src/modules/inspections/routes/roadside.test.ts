import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { roadsideSummarySchema, type RoadsideInspectionDto } from "@silvicom/shared";
import { closeTestServer } from "../../../testing/httpServer.js";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  type RecordedQuery,
  type SupabaseRecorder,
} from "../../../testing/supabaseRecorder.js";

/**
 * `GET /api/roadside-inspections` and `/summary` — the Inspections inbox's first slice and the
 * Operations tab's Roadside card (INSPECTION-CHALLENGE-PLAN §6; FLEET-MANAGER-HOME-PLAN FM5, Q-FM7 (a)).
 *
 * The recorder does not filter, so each fixture is a FUNCTION of the filters the query applied: a
 * read that forgets `org_id` gets another carrier's inspection, one that forgets `vanished_at is null`
 * gets the aged-out and removed records, one that forgets `from` gets the whole record, and one that
 * stops after the first page loses the rest. Every one of those is then a failing count, not a
 * fixture that happened to agree.
 */

const ORG = "org-1";
let rec: SupabaseRecorder;

vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: ORG, role: "safety_manager", email: "safety@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { roadsideInspectionsRouter } = await import("./roadside.js");

type Insp = {
  id: string; org_id: string; inspection_date: string | null; vanished_at: string | null;
  report_number: string; report_state: string; level: number; location_desc: string; hazmat_placard_required: boolean;
  violations_total: number | null; driver_oos_total: number | null; vehicle_oos_total: number | null; hazmat_oos_total: number | null;
};
const insp = (id: string, day: string | null, oos: [number, number, number] = [0, 0, 0], extra: Partial<Insp> = {}): Insp => ({
  id, org_id: ORG, inspection_date: day, vanished_at: null, report_number: `R-${id}`, report_state: "IL", level: 2,
  location_desc: "I-55 MM 210", hazmat_placard_required: false, violations_total: oos[0] + oos[1] + 1,
  driver_oos_total: oos[0], vehicle_oos_total: oos[1], hazmat_oos_total: oos[2], ...extra,
});

/**
 * Today is 2026-10-12 in Los Angeles (the org's zone) and already 2026-10-13 in Chicago and in UTC,
 * so the 90-day window starts 2026-07-15 only if the server cuts it on the ORG's calendar.
 */
const NOW = new Date("2026-10-13T06:30:00Z");
const FROM = "2026-07-15";
const INSPECTIONS: Insp[] = [
  insp("i1", "2026-10-09", [0, 1, 1]), // vehicle + hazmat: the overlap, counted in both
  insp("i2", "2026-09-27", [1, 0, 0]),
  insp("i3", "2026-08-01", [0, 2, 0]),
  insp("i4", FROM), // the window's first day — in
  insp("i5", "2026-07-14", [1, 1, 1]), // the day before — out of the card, on the whole list
  insp("i6", "2026-09-01", [0, 1, 0], { vanished_at: "2026-10-01T12:00:00Z" }), // removed: off both
  insp("i7", null), // undated: never in a window, last on the whole list
  insp("x1", "2026-10-01", [1, 1, 1], { org_id: "org-2" }), // another carrier
];
const unit = (inspection_id: string, seq: number, type: string, method: string, org = ORG, vanished: string | null = null) => ({
  inspection_id, org_id: org, unit_seq: seq, unit_type_id: type, company_number: `${700 + seq}`, plate: "P123",
  plate_state: "IL", match_method: method, vanished_at: vanished,
});
const UNITS = [
  unit("i1", 1, "11", "vin"), unit("i1", 2, "9", "none"), unit("i1", 3, "9", "plate", ORG, "2026-10-01T00:00:00Z"),
  unit("i2", 1, "11", "kind_mismatch"), unit("i3", 1, "4", "unit_number"),
];

const val = (q: RecordedQuery, method: string, col: string) => q.ops.find((o) => o.method === method && o.args[0] === col)?.args[1];
const rangeOf = (q: RecordedQuery) => q.ops.find((o) => o.method === "range")?.args as [number, number] | undefined;

/** Applies what the query asked for — org, vanished, from, order and the page — and nothing it did not. */
function inspectionsFixture(all: Insp[]) {
  return (q: RecordedQuery) => {
    const org = val(q, "eq", "org_id");
    const from = val(q, "gte", "inspection_date") as string | undefined;
    const current = q.ops.some((o) => o.method === "is" && o.args[0] === "vanished_at" && o.args[1] === null);
    const rows = all
      .filter((r) => org === undefined || r.org_id === org)
      .filter((r) => !current || r.vanished_at === null)
      .filter((r) => from === undefined || (r.inspection_date !== null && r.inspection_date >= from))
      .sort((a, b) => (a.inspection_date === b.inspection_date ? a.id.localeCompare(b.id) : !a.inspection_date ? 1 : !b.inspection_date ? -1 : b.inspection_date.localeCompare(a.inspection_date)));
    const r = rangeOf(q);
    return r ? rows.slice(r[0], r[1] + 1) : rows;
  };
}

function recorder(o: { inspections?: Insp[]; error?: boolean } = {}) {
  return createSupabaseRecorder({
    tables: {
      organizations: [{ operating_hours: { tz: "America/Los_Angeles" } }],
      roadside_inspections: o.error
        ? () => ({ data: null, error: { message: "relation roadside_inspections: boom" } })
        : inspectionsFixture(o.inspections ?? INSPECTIONS),
      roadside_inspection_units: (q) => {
        const org = val(q, "eq", "org_id");
        const ids = (q.ops.find((op) => op.method === "in" && op.args[0] === "inspection_id")?.args[1] ?? []) as string[];
        const current = q.ops.some((op) => op.method === "is" && op.args[0] === "vanished_at");
        return UNITS.filter((u) => (org === undefined || u.org_id === org) && ids.includes(u.inspection_id) && (!current || !u.vanished_at));
      },
    },
  });
}

async function call(path: string): Promise<{ status: number; body: { ok?: boolean; data?: unknown; error?: unknown } }> {
  const app = express();
  app.use("/api/roadside-inspections", roadsideInspectionsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/roadside-inspections${path}`);
    return { status: res.status, body: (await res.json()) as never };
  } finally {
    await closeTestServer(server);
  }
}

const ids = (rows: unknown) => (rows as RoadsideInspectionDto[]).map((r) => r.id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  rec = recorder();
});
afterEach(() => vi.useRealTimers());

describe("the Roadside card's summary", () => {
  it("counts the last 90 days on the org's calendar, each OOS kind as inspections carrying one", async () => {
    const { status, body } = await call("/summary");
    expect(status).toBe(200);
    // i1 i2 i3 i4 — not i5 (a day early), i6 (removed), i7 (undated) or x1 (another carrier).
    // i1 is in both vehicle and hazmat: the kinds overlap and are never a sum.
    expect(roadsideSummarySchema.parse(body.data)).toEqual({ from: FROM, inspections: 4, driverOos: 1, vehicleOos: 2, hazmatOos: 1 });
  });

  it("gives each figure as the length of the list the card's door opens (D-FM7)", async () => {
    const summary = (await call("/summary")).body.data as { from: string; inspections: number };
    rec = recorder();
    const list = (await call(`/?from=${summary.from}`)).body.data as RoadsideInspectionDto[];
    expect(summary.inspections).toBe(list.length);
  });

  it("reads every page of a window longer than one", async () => {
    const many = Array.from({ length: 501 }, (_, i) => insp(`m${String(i).padStart(3, "0")}`, "2026-10-01", [0, i % 2, 0]));
    rec = recorder({ inspections: many });
    expect((await call("/summary")).body.data).toMatchObject({ inspections: 501, vehicleOos: 250 });
  });

  it("refuses with no figures when the read fails, and never echoes the database", async () => {
    rec = recorder({ error: true });
    const { status, body } = await call("/summary");
    expect(status).toBe(500);
    expect(body.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("boom");
  });
});

describe("the list", () => {
  it("is the whole current record, newest first and undated last, with FMCSA's counts", async () => {
    const { body } = await call("/");
    expect(ids(body.data)).toEqual(["i1", "i2", "i3", "i4", "i5", "i7"]);
    expect((body.data as RoadsideInspectionDto[])[0]).toMatchObject({
      reportNumber: "R-i1", reportState: "IL", inspectionDate: "2026-10-09", level: 2, locationDesc: "I-55 MM 210",
      violations: 2, driverOos: 0, vehicleOos: 1, hazmatOos: 1,
    });
  });

  it("starts at ?from= when given", async () => {
    expect(ids((await call(`/?from=${FROM}`)).body.data)).toEqual(["i1", "i2", "i3", "i4"]);
  });

  it("refuses a from that is not a real calendar day", async () => {
    for (const bad of ["2026-7-15", "yesterday", "2026-02-31"]) {
      rec = recorder();
      expect((await call(`/?from=${bad}`)).status, bad).toBe(400);
    }
  });

  it("carries each unit with whether 0458 matched it to our roster — an unmatched unit shows, never guessed (D-IC7)", async () => {
    const rows = (await call("/")).body.data as RoadsideInspectionDto[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("i1")!.units).toEqual([
      { seq: 1, kind: "tractor", companyNumber: "701", plate: "P123", plateState: "IL", matched: true },
      { seq: 2, kind: "trailer", companyNumber: "702", plate: "P123", plateState: "IL", matched: false },
      // seq 3 vanished with its record and is off, as its inspection would be.
    ]);
    expect(byId.get("i2")!.units!.map((u) => u.matched)).toEqual([false]); // kind_mismatch is not a match
    expect(byId.get("i3")!.units!.map((u) => [u.kind, u.matched])).toEqual([["other", true]]);
    expect(byId.get("i4")!.units).toEqual([]);
  });

  it("scopes every read on both routes to the caller's org", async () => {
    for (const path of ["/summary", "/"]) {
      rec = recorder();
      await call(path);
      expect(rec.forTable("roadside_inspections").length, path).toBeGreaterThan(0);
      expectOrgScoped(rec, ORG);
    }
    expect(rec.forTable("roadside_inspection_units").length).toBeGreaterThan(0);
  });
});
