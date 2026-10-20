import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { RoadsideInspectionDetailDto, RoadsideInspectionDto, RoadsideSummary } from "@silvicom/shared";
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
/** The caller holds the `safety` section at view only: a route asking for more must answer 403. */
let viewOnly = false;

vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: ORG, role: "safety_manager", email: "safety@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: (_section: string, level = "manage") => (_req: Request, res: Response, next: NextFunction) =>
    viewOnly && level !== "view" ? void res.status(403).json({ error: { code: "forbidden" } }) : next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { roadsideInspectionsRouter } = await import("./roadside.js");

type Insp = {
  id: string; org_id: string; inspection_date: string | null; vanished_at: string | null;
  report_number: string; report_state: string; level: number; location_desc: string; hazmat_placard_required: boolean;
  violations_total: number | null; driver_oos_total: number | null; vehicle_oos_total: number | null; hazmat_oos_total: number | null;
  /** The detail's embed of its raw record, for the MCMIS load date. */
  raw?: { mcmis_add_date: string | null } | null;
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
  plate_state: "IL", match_method: method, vanished_at: vanished, make: "FRHT", vin: `VIN${seq}`, decal: false,
  vehicle_id: method === "vin" && type === "11" ? "veh-701" : null,
});
type Viol = { id: string; org_id: string; inspection_id: string; seq_no: number; viol_code: string; description: string; viol_unit: string; out_of_service: boolean; category_id: number | null; defect_verification_id: string | null; citation_number: string | null; vanished_at: string | null };
const viol = (id: string, inspection_id: string, seq: number, unitCol: string, oos: boolean, extra: Partial<Viol> = {}): Viol => ({
  id, org_id: ORG, inspection_id, seq_no: seq, viol_code: `393.${seq}`, description: `Violation ${id}`, viol_unit: unitCol,
  out_of_service: oos, category_id: 16, defect_verification_id: oos ? "1" : "3", citation_number: null, vanished_at: null, ...extra,
});
const VIOLATIONS: Viol[] = [];
type Cit = { org_id: string; inspection_id: string; violation_id: string; adjseq: number; citation_code?: number | null; citation_result: string; vanished_at: string | null };
const CITATIONS: Cit[] = [];
/** Rows of a child table filtered by what the query asked for: org, inspection, vanished, and ordered by `col`. */
const childFixture = <T extends { org_id: string; inspection_id: string; vanished_at: string | null }>(rows: T[], col: keyof T) => (q: RecordedQuery) => {
  const org = val(q, "eq", "org_id");
  const insp = val(q, "eq", "inspection_id");
  const current = q.ops.some((op) => op.method === "is" && op.args[0] === "vanished_at");
  const ordered = q.ops.some((op) => op.method === "order" && op.args[0] === col);
  const out = rows.filter((r) => (org === undefined || r.org_id === org) && (insp === undefined || r.inspection_id === insp) && (!current || !r.vanished_at));
  return ordered ? [...out].sort((a, b) => Number(a[col]) - Number(b[col])) : out;
};
const UNITS: ReturnType<typeof unit>[] = [
  unit("i1", 1, "11", "vin"), unit("i1", 2, "9", "none"), unit("i1", 3, "9", "plate", ORG, "2026-10-01T00:00:00Z"),
  unit("i2", 1, "11", "kind_mismatch"), unit("i3", 1, "4", "unit_number"),
];

const val = (q: RecordedQuery, method: string, col: string) => q.ops.find((o) => o.method === method && o.args[0] === col)?.args[1];
const rangeOf = (q: RecordedQuery) => q.ops.find((o) => o.method === "range")?.args as [number, number] | undefined;

/** Applies what the query asked for — org, vanished, from, order and the page — and nothing it did not. */
function inspectionsFixture(all: Insp[]) {
  return (q: RecordedQuery) => {
    const org = val(q, "eq", "org_id");
    const id = val(q, "eq", "id");
    const from = val(q, "gte", "inspection_date") as string | undefined;
    const to = val(q, "lte", "inspection_date") as string | undefined;
    const current = q.ops.some((o) => o.method === "is" && o.args[0] === "vanished_at" && o.args[1] === null);
    const rows = all
      .filter((r) => org === undefined || r.org_id === org)
      .filter((r) => id === undefined || r.id === id)
      .filter((r) => !current || r.vanished_at === null)
      .filter((r) => from === undefined || (r.inspection_date !== null && r.inspection_date >= from))
      .filter((r) => to === undefined || (r.inspection_date !== null && r.inspection_date <= to))
      .sort((a, b) => (a.inspection_date === b.inspection_date ? a.id.localeCompare(b.id) : !a.inspection_date ? 1 : !b.inspection_date ? -1 : b.inspection_date.localeCompare(a.inspection_date)));
    const r = rangeOf(q);
    return r ? rows.slice(r[0], r[1] + 1) : rows;
  };
}

type Run = { org_id: string; dataset: string; outcome: "succeeded" | "failed"; finished_at: string; source_rows_updated_at: string | null };
/** Our last good fetch 6 h before NOW, FMCSA's publication 11 h before; a later failure, another dataset and another carrier around it. */
const RUNS: Run[] = [
  { org_id: ORG, dataset: "fx4q-ay7w", outcome: "succeeded", finished_at: "2026-10-13T00:30:00Z", source_rows_updated_at: "2026-10-12T19:30:00Z" },
  { org_id: ORG, dataset: "fx4q-ay7w", outcome: "succeeded", finished_at: "2026-10-12T00:30:00Z", source_rows_updated_at: "2026-10-11T19:30:00Z" },
  { org_id: ORG, dataset: "fx4q-ay7w", outcome: "failed", finished_at: "2026-10-13T05:30:00Z", source_rows_updated_at: null },
  { org_id: ORG, dataset: "876r-jsdb", outcome: "succeeded", finished_at: "2026-10-13T06:00:00Z", source_rows_updated_at: "2026-10-13T06:00:00Z" },
  { org_id: "org-2", dataset: "fx4q-ay7w", outcome: "succeeded", finished_at: "2026-10-13T06:20:00Z", source_rows_updated_at: "2026-10-13T06:00:00Z" },
];
/** Applies org, dataset and outcome, then the newest first — what `readRoadsideFeed` asks for. */
const runsFixture = (runs: Run[]) => (q: RecordedQuery) =>
  runs
    .filter((r) => r.org_id === val(q, "eq", "org_id") && r.dataset === val(q, "eq", "dataset") && r.outcome === val(q, "eq", "outcome"))
    .sort((a, b) => b.finished_at.localeCompare(a.finished_at))
    .slice(0, 1);

function recorder(o: { inspections?: Insp[]; error?: boolean; runs?: Run[] } = {}) {
  return createSupabaseRecorder({
    tables: {
      organizations: [{ operating_hours: { tz: "America/Los_Angeles" } }],
      fmcsa_fetch_runs: runsFixture(o.runs ?? RUNS),
      roadside_inspections: o.error
        ? () => ({ data: null, error: { message: "relation roadside_inspections: boom" } })
        : inspectionsFixture(o.inspections ?? INSPECTIONS),
      roadside_violations: childFixture(VIOLATIONS, "seq_no"),
      roadside_citations: childFixture(CITATIONS, "adjseq"),
      roadside_inspection_units: (q) => {
        const org = val(q, "eq", "org_id");
        const one = val(q, "eq", "inspection_id") as string | undefined;
        const ids = one ? [one] : ((q.ops.find((op) => op.method === "in" && op.args[0] === "inspection_id")?.args[1] ?? []) as string[]);
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

async function post(path: string, body: unknown): Promise<{ status: number; body: { ok?: boolean; data?: unknown; error?: { code: string; message: string } } }> {
  const app = express();
  app.use(express.json());
  app.use("/api/roadside-inspections", roadsideInspectionsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/roadside-inspections${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
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

describe("the Roadside card's summary (IC16)", () => {
  const summary = async (path: string) => {
    const res = await call(path);
    return { status: res.status, data: res.body.data as RoadsideSummary };
  };

  it("counts the range it is asked for, on the org's calendar, each figure FMCSA's way", async () => {
    const { status, data } = await summary(`/summary?from=${FROM}&to=2026-10-09`);
    expect(status).toBe(200);
    // i1 i2 i3 i4 — not i5 (a day early), i6 (removed), i7 (undated) or x1 (another carrier). All are Level 2,
    // a vehicle AND a driver inspection, so each rate is over all four.
    expect(data.from).toBe(FROM);
    expect(data.to).toBe("2026-10-09");
    expect(data.stats).toMatchObject({
      inspections: 4,
      vehicleOos: { count: 2, of: 4, share: 0.5 },
      driverOos: { count: 1, of: 4, share: 0.25 },
      hazmatOos: 1,
      clean: { count: 0, of: 4 },
    });
    expect(data.feed).toEqual({ fetchedAt: "2026-10-13T00:30:00Z", sourceUpdatedAt: "2026-10-12T19:30:00Z", state: "fresh" });
  });

  it("stops at the range's last day", async () => {
    // i1 (10-09) is after 10-01.
    expect((await summary(`/summary?from=${FROM}&to=2026-10-01`)).data.stats.inspections).toBe(3);
  });

  it("is the last 30 days of the org's calendar when no range is given, as the Operations tab's default", async () => {
    // Today is 10-12 in Los Angeles: 09-12 to 10-12 holds i1 and i2.
    const { data } = await summary("/summary");
    expect([data.from, data.to, data.stats.inspections]).toEqual(["2026-09-12", "2026-10-12", 2]);
  });

  it("gives each figure as the length of the list the card's door opens (D-FM7)", async () => {
    const { data } = await summary(`/summary?from=${FROM}&to=2026-10-12`);
    rec = recorder();
    const list = (await call(`/?from=${data.from}&to=${data.to}`)).body.data as RoadsideInspectionDto[];
    expect(data.stats.inspections).toBe(list.length);
  });

  it("reads every page of a range longer than one", async () => {
    const many = Array.from({ length: 501 }, (_, i) => insp(`m${String(i).padStart(3, "0")}`, "2026-10-01", [0, i % 2, 0]));
    rec = recorder({ inspections: many });
    expect((await summary("/summary?from=2026-10-01&to=2026-10-01")).data.stats).toMatchObject({ inspections: 501, vehicleOos: { count: 250 } });
  });

  it("refuses a day that does not exist, and a range that ends before it starts", async () => {
    expect((await call("/summary?from=2026-02-31")).status).toBe(400);
    expect((await call("/summary?from=2026-10-09&to=2026-10-01")).status).toBe(400);
  });

  it("refuses with no figures when the read fails, and never echoes the database", async () => {
    rec = recorder({ error: true });
    const { status, body } = await call("/summary");
    expect(status).toBe(500);
    expect(body.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("boom");
  });
});

describe("how current the summary's record is (IC1c)", () => {
  it("reads our last SUCCESSFUL inspection-file fetch — not a later failure, another dataset or another carrier", async () => {
    const feed = ((await call("/summary")).body.data as { feed: unknown }).feed;
    expect(feed).toMatchObject({ fetchedAt: "2026-10-13T00:30:00Z", state: "fresh" });
  });

  it("is late when that fetch is over 36 hours old, and never when there has been none", async () => {
    rec = recorder({ runs: [{ ...RUNS[0]!, finished_at: "2026-10-11T18:00:00Z" }] });
    expect(((await call("/summary")).body.data as { feed: { state: string } }).feed.state).toBe("ours_late");
    rec = recorder({ runs: [] });
    expect(((await call("/summary")).body.data as { feed: unknown }).feed).toEqual({ fetchedAt: null, sourceUpdatedAt: null, state: "never" });
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

describe("one inspection", () => {
  // The route takes a uuid, so this block has its own records: ours, another carrier's, and one FMCSA removed.
  const A = "11111111-1111-4111-8111-111111111111";
  const THEIRS = "22222222-2222-4222-8222-222222222222";
  const GONE = "33333333-3333-4333-8333-333333333333";
  const detailRecorder = () => {
    const base = recorder({
      inspections: [
        insp(A, "2026-10-09", [0, 1, 1]),
        insp(THEIRS, "2026-10-01", [1, 1, 1], { org_id: "org-2" }),
        insp(GONE, "2026-09-01", [0, 1, 0], { vanished_at: "2026-10-01T12:00:00Z" }),
      ],
    });
    return base;
  };
  beforeEach(() => {
    UNITS.push(unit(A, 1, "11", "vin"), unit(A, 2, "9", "none"), unit(A, 3, "9", "plate", ORG, "2026-10-01T00:00:00Z"));
    VIOLATIONS.push(
      viol("v2", A, 2, "2", true),
      viol("v4", A, 5, "2", true, { category_id: 77, defect_verification_id: "8" }), // codes FMCSA's tables do not have
      viol("v1", A, 1, "D", false, { citation_number: "E061" }),
      viol("v3", A, 3, "1", false, { vanished_at: "2026-10-05T00:00:00Z" }), // removed by FMCSA: off the page
      viol("vx", A, 4, "1", true, { org_id: "org-2" }), // another carrier's row under our inspection id
    );
    CITATIONS.push(
      { org_id: ORG, inspection_id: A, violation_id: "v1", adjseq: 2, citation_result: "Conviction of a Different Charge", vanished_at: "2026-10-01T00:00:00Z" },
      { org_id: ORG, inspection_id: A, violation_id: "v1", adjseq: 1, citation_result: "Not Guilty/Dismissed", vanished_at: null },
    );
    rec = detailRecorder();
  });
  afterEach(() => {
    for (const list of [UNITS, VIOLATIONS, CITATIONS] as { inspection_id: string }[][]) {
      list.splice(0, list.length, ...list.filter((r) => r.inspection_id !== A));
    }
  });

  it("carries the report's facts, every current unit with how it matched, and its violations in report order", async () => {
    const { status, body } = await call(`/${A}`);
    expect(status).toBe(200);
    const d = body.data as RoadsideInspectionDetailDto;
    expect(d).toMatchObject({ id: A, reportNumber: `R-${A}`, inspectionDate: "2026-10-09", violations: 2, vehicleOos: 1, hazmatOos: 1 });
    expect(d.units.map((u) => [u.seq, u.kind, u.matchedBy, u.vehicleId])).toEqual([
      [1, "tractor", "vin", "veh-701"],
      [2, "trailer", null, null],
    ]);
    expect(d.violationList.map((v) => [v.id, v.against, v.outOfService])).toEqual([
      ["v1", { driver: true }, false],
      ["v2", { unitSeq: 2 }, true],
      ["v4", { unitSeq: 2 }, true],
    ]);
  });

  it("gives a violation its current court result only, as FMCSA words it", async () => {
    const d = (await call(`/${A}`)).body.data as RoadsideInspectionDetailDto;
    expect(d.violationList.find((v) => v.id === "v1")).toMatchObject({ citationNumber: "E061", courtResults: ["Not Guilty/Dismissed"] });
    expect(d.violationList.find((v) => v.id === "v2")!.courtResults).toEqual([]);
  });

  it("answers 404 for another carrier's inspection, a removed one, and an id that is not one", async () => {
    for (const id of [THEIRS, GONE, "not-a-uuid"]) {
      rec = detailRecorder();
      expect((await call(`/${id}`)).status, id).toBe(404);
    }
  });

  it("scopes every read to the caller's org", async () => {
    await call(`/${A}`);
    for (const t of ["roadside_inspections", "roadside_inspection_units", "roadside_violations", "roadside_citations"]) {
      expect(rec.forTable(t).length, t).toBeGreaterThan(0);
    }
    expectOrgScoped(rec, ORG);
  });
});

describe("FMCSA's names for its codes (Q-IC5)", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  beforeEach(() => {
    VIOLATIONS.push(
      viol("n1", A, 1, "2", true),
      viol("n2", A, 2, "D", false, { category_id: 45 }),
      viol("n3", A, 3, "2", true, { category_id: 77, defect_verification_id: "8" }),
      viol("n4", A, 4, "2", false, { category_id: null, defect_verification_id: " " }),
    );
    rec = recorder({ inspections: [insp(A, "2026-10-09", [0, 1, 0])] });
  });
  afterEach(() => VIOLATIONS.splice(0, VIOLATIONS.length, ...VIOLATIONS.filter((v) => v.inspection_id !== A)));

  it("names a violation's category and its defect's outcome from the data dictionary, and keeps an unknown code as its number", async () => {
    const d = (await call(`/${A}`)).body.data as RoadsideInspectionDetailDto;
    expect(d.violationList.map((v) => [v.id, v.category, v.defectVerification])).toEqual([
      ["n1", "Brakes, All Other Violations", "Repaired at scene"],
      ["n2", "Speeding", "Not out of service"],
      ["n3", "77", "8"],
      ["n4", null, null],
    ]);
  });
});

describe("CSA points on the inspection (D-IC6)", () => {
  const A = "44444444-4444-4444-8444-444444444444";
  const B = "55555555-5555-4555-8555-555555555555";
  beforeEach(() => {
    VIOLATIONS.push(
      viol("p1", A, 1, "1", true, { viol_code: "393.75A3-TAOL" }),
      viol("p2", B, 1, "1", false, { viol_code: "393.45" }),
      viol("p3", B, 2, "D", false, { viol_code: "395.8(e)" }),
    );
    // The current adjudication is the one SMS reads: a vanished "original charge" beside it changes nothing.
    CITATIONS.push(
      { org_id: ORG, inspection_id: B, violation_id: "p3", adjseq: 1, citation_code: 3, citation_result: "Not Guilty/Dismissed", vanished_at: null },
      { org_id: ORG, inspection_id: B, violation_id: "p3", adjseq: 2, citation_code: 1, citation_result: "Conviction", vanished_at: "2026-10-01T00:00:00Z" },
    );
    rec = recorder({
      inspections: [
        // Reached MCMIS on 10/12 — before today in Chicago and in UTC, but today itself in Los Angeles.
        insp(A, "2026-10-11", [0, 1, 0], { raw: { mcmis_add_date: "20261012 0300" } }),
        insp(B, "2026-09-02", [0, 0, 0], { raw: { mcmis_add_date: "20260903 2140" } }),
      ],
    });
  });
  afterEach(() => {
    for (const list of [VIOLATIONS, CITATIONS] as { inspection_id: string }[][]) {
      list.splice(0, list.length, ...list.filter((r) => r.inspection_id !== A && r.inspection_id !== B));
    }
  });

  it("measures on the org's calendar day, so a record MCMIS took in today does not count yet", async () => {
    const d = (await call(`/${A}`)).body.data as RoadsideInspectionDetailDto;
    expect(d.sms).toMatchObject({ measuredOn: "2026-10-12", appendixVersion: "3.21", timeWeight: null, basics: [] });
    expect(d.sms!.violations.p1).toMatchObject({ status: "excluded", reason: "not_loaded" });
  });

  it("scores each violation from its code, its OOS order and its court result", async () => {
    const d = (await call(`/${B}`)).body.data as RoadsideInspectionDetailDto;
    expect(d.sms!.violations).toEqual({
      p2: { status: "scored", basic: "vehicle_maintenance", severityWeight: 4, oosWeight: 0, timeWeight: 3, points: 12 },
      p3: { status: "excluded", basic: "hos_compliance", reason: "dismissed" },
    });
    expect(d.sms!.basics).toEqual([{ basic: "vehicle_maintenance", verified: true, severitySum: 4, capped: 4, points: 12 }]);
  });
});

describe("who was driving (IC5)", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const ENGINE = "44444444-4444-4444-8444-444444444444";
  const reading = {
    id: ENGINE, org_id: ORG, inspection_id: A, source: "engine", engine_version: "ic5.1", created_at: "2026-10-13T01:00:00Z",
    outcome: "one_driver", confidence: "high", basis: "covering", zone: "America/Chicago", zone_method: "gps",
    started_at: "2026-10-09T18:04:00Z", ended_at: "2026-10-09T18:27:00Z", location_check: "confirmed", vehicle_id: "veh-701",
    samsara_vehicle_id: "2120", samsara_driver_id: "s-ann", samsara_driver_name: "Ann (Samsara)", candidates: [], decided_by: null, driver_id: null, note: null,
  };
  beforeEach(() => {
    rec = createSupabaseRecorder({
      tables: {
        organizations: [{ operating_hours: { tz: "America/Los_Angeles" } }],
        roadside_inspections: inspectionsFixture([insp(A, "2026-10-09")]),
        inspection_attributions: (q) =>
          q.write ? [{ id: "new-1" }] : [reading].filter((r) => r.org_id === val(q, "eq", "org_id") && r.inspection_id === val(q, "eq", "inspection_id") && r.source === val(q, "eq", "source")),
        drivers: (q) => [{ id: "d-ann", org_id: ORG, samsara_driver_id: "s-ann", full_name: "Ann Roster" }].filter((d) => d.org_id === val(q, "eq", "org_id")),
      },
    });
    viewOnly = false;
  });
  afterEach(() => {
    viewOnly = false;
  });

  it("the page carries the reading with Samsara's driver resolved to ours", async () => {
    const d = (await call(`/${A}`)).body.data as RoadsideInspectionDetailDto;
    expect(d.attribution.reading).toMatchObject({ id: ENGINE, confidence: "high", driver: { id: "d-ann", name: "Ann Roster" } });
    expect(d.attribution.decision).toBeNull();
    expectOrgScoped(rec, ORG);
  });

  it("records a confirmation as the signed-in person", async () => {
    const res = await post(`/${A}/attribution`, { action: "confirm", basedOn: ENGINE });
    expect(res).toEqual({ status: 201, body: { ok: true, data: { id: "new-1" } } });
    expect(rec.writtenRows("inspection_attributions")[0]).toMatchObject({ source: "person", decided_by: "u-1", driver_id: null });
  });

  it.each([
    ["a correction without a note", { action: "correct", basedOn: ENGINE, driverId: "55555555-5555-4555-8555-555555555555", note: "  " }],
    ["an unknown action", { action: "approve", basedOn: ENGINE }],
    ["no basedOn", { action: "confirm" }],
  ])("refuses %s as a bad request, writing nothing", async (_what, body) => {
    expect((await post(`/${A}/attribution`, body)).status).toBe(400);
    expect(rec.writes()).toEqual([]);
  });

  it("answers the decision's own refusal with its status and code", async () => {
    const res = await post(`/${A}/attribution`, { action: "confirm", basedOn: "66666666-6666-4666-8666-666666666666" });
    expect([res.status, res.body.error?.code]).toEqual([409, "changed"]);
  });

  it("answers 404 for an id that is not one", async () => {
    expect((await post(`/not-a-uuid/attribution`, { action: "confirm", basedOn: ENGINE })).status).toBe(404);
  });

  it("needs the safety section's manage level, while reading needs only view", async () => {
    viewOnly = true;
    expect((await post(`/${A}/attribution`, { action: "confirm", basedOn: ENGINE })).status).toBe(403);
    expect((await call(`/${A}`)).status).toBe(200);
    expect(rec.writes()).toEqual([]);
  });
});
