import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { RoadsideRepairCertificationDto } from "@silvicom/shared";
import { closeTestServer } from "../../../testing/httpServer.js";
import { pdfText } from "../../../testing/pdfText.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * Safety's certification — `POST /:id/repairs/certify` and `GET /:id/repairs/certification` (INSPECTION-
 * CHALLENGE-PLAN IC11 B2, D-IC14; 396.9(d)(3)(i); Q-IC13). Pinned: it needs the SAFETY section's manage
 * level, only a settled record over the rows the page showed may be certified, the signer and the date
 * are the server's, the rendered record is filed BEFORE the row that names it, and a retried click lands
 * on the same rows. Fixtures filter on the query's own `org_id` and inspection.
 */

const ORG = "org-1";
const INSP = "11111111-1111-4111-8111-111111111111";
const UNIT = "22222222-2222-4222-8222-222222222222";
const UNIT2 = "77777777-7777-4777-8777-777777777777";
const ENGINE = "33333333-3333-4333-8333-333333333333";
const PERSON = "44444444-4444-4444-8444-444444444444";
const SCENE = "55555555-5555-4555-8555-555555555555";

let rec: SupabaseRecorder;
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

const candidate = { workOrderId: "wo-1", reference: "WO-10482", openedOn: "2026-10-07", status: "CLOSED", completedAt: null, description: null, jobs: ["Brake chamber"] };
const row = (o: Record<string, unknown>) => ({
  id: ENGINE, org_id: ORG, inspection_id: INSP, inspection_unit_id: UNIT, source: "engine", engine_version: "ic11.1", outcome: "one_candidate",
  due_on: "2026-10-21", candidates: [candidate], decided_by: null, work_order_fleetpal_id: null, note: null, created_at: "2026-10-08T12:00:00Z", ...o,
});
/** Unit 1 accepted by maintenance; unit 2 repaired at the scene. Both settled. */
const SETTLED = [
  row({}),
  row({ id: PERSON, source: "person", outcome: "accepted", decided_by: "u-2", work_order_fleetpal_id: "wo-1", created_at: "2026-10-09T12:00:00Z" }),
  row({ id: SCENE, inspection_unit_id: UNIT2, outcome: "repaired_at_scene", candidates: [] }),
  row({ id: "x-other-org", org_id: "org-2", source: "person", outcome: "repaired_outside_fleetpal", note: "x", created_at: "2026-10-20T12:00:00Z" }),
];

const val = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;
const filtered = <T extends Record<string, unknown>>(rows: T[], q: RecordedQuery, cols: string[]) =>
  rows.filter((r) => cols.every((c) => val(q, c) === undefined || r[c] === val(q, c)));

function recorder(repairs: Record<string, unknown>[] = SETTLED, opts: { certs?: Record<string, unknown>[]; certWriteError?: unknown; name?: string | null; unknown?: boolean } = {}) {
  return createSupabaseRecorder({
    tables: {
      inspection_repairs: (q) => ({ data: filtered(repairs, q, ["org_id", "inspection_id", "inspection_unit_id"]) }),
      inspection_repair_certifications: (q) => ({
        data: filtered(opts.certs ?? [], q, ["org_id", "inspection_id"]),
        writeError: opts.certWriteError,
      }),
      roadside_inspection_units: (q) => ({
        data: filtered([
          { id: UNIT, org_id: ORG, inspection_id: INSP, unit_seq: 1, unit_type_id: "11", company_number: "1234" },
          { id: UNIT2, org_id: ORG, inspection_id: INSP, unit_seq: 2, unit_type_id: "9", company_number: "5521" },
        ], q, ["org_id", "inspection_id"]),
      }),
      roadside_violations: (q) => ({
        data: filtered([{ unit_id: UNIT, org_id: ORG, inspection_id: INSP, viol_code: "393.47E", description: "Clamp brake out of adjustment" }], q, ["org_id", "inspection_id"]),
      }),
      roadside_inspections: (q) => ({
        data: filtered([{ id: INSP, org_id: ORG, report_number: "IL1234567890", report_state: "IL", inspection_date: "2026-10-06", level: 2, location_desc: "I-80 Minooka" }], q, ["org_id", "id"]),
      }),
      organizations: [{ id: ORG, name: "Silvi Transport Inc.", dot_number: "1864495", operating_hours: { timezone: "America/Chicago" } }],
      fleetpal_sync_state: (q) => ({ data: filtered(["work-orders", "jobs", "job-items", "purchase-orders", "purchase-order-invoices"].map((resource) => ({ org_id: ORG, resource, last_run_at: "2026-10-16T17:00:00Z" })), q, ["org_id"]) }),
      fleetpal_work_orders: (q) => ({ data: filtered([{ org_id: ORG, fleetpal_id: "wo-1", reference_number: "WO-10482", status: "CLOSED", vendor_created_at: "2026-10-07T14:00:00Z", completed: null, description: "Brakes" }], q, ["org_id"]) }),
      fleetpal_jobs: [],
      fleetpal_job_items: [],
      fleetpal_purchase_orders: [],
      fleetpal_po_invoices: [],
      documents: [],
      user_profiles: [],
      audit_logs: [],
    },
    rpc: {
      org_member_directory: [
        ...(opts.unknown ? [] : [{ user_id: "u-1", email: "dana@example.test", full_name: opts.name === undefined ? "Dana Reyes" : opts.name }]),
        { user_id: "u-2", email: "sam@example.test", full_name: "Sam Shop" },
      ],
    },
    auth: opts.unknown ? { getUserById: () => ({ data: { user: null }, error: null }) } : undefined,
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

const CERTIFY = { signerTitle: "Safety Director", basedOn: [PERSON, SCENE] };

beforeEach(() => {
  rec = recorder();
  manages = new Set(["safety", "maintenance"]);
});

describe("safety certifies the repairs (396.9(d)(3)(i), Q-IC13)", () => {
  it("files the rendered record, then the certification naming it — signer and date the server's", async () => {
    const res = await send("POST", `/${INSP}/repairs/certify`, CERTIFY);
    expect(res.status).toBe(201);
    const [doc] = rec.writtenRows("documents");
    expect(doc).toMatchObject({ org_id: ORG, subject_type: "roadside_inspection", subject_id: INSP, kind: "roadside_repair_record", uploaded_by: "u-1" });
    const [cert] = rec.writtenRows("inspection_repair_certifications");
    expect(cert).toMatchObject({
      org_id: ORG, inspection_id: INSP, certified_by: "u-1", signer_name: "Dana Reyes", signer_title: "Safety Director",
      document_id: (doc as { id: string }).id,
      repairs: [{ unitId: UNIT, repairId: PERSON }, { unitId: UNIT2, repairId: SCENE }],
    });
    expect((cert as { signed_on: string }).signed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The record exists before the row that names it.
    const order = rec.queries.filter((q) => q.write).map((q) => q.table);
    expect(order.indexOf("documents")).toBeLessThan(order.indexOf("inspection_repair_certifications"));
    expect(rec.writtenRows("audit_logs")[0]).toMatchObject({ action: "roadside.repair_certified" });
    expectOrgScoped(rec, ORG, { exempt: ["organizations", "user_profiles", "documents"] });
  });

  it("the filed PDF carries FleetPal's work order, its as-of time, and the signature block", async () => {
    await send("POST", `/${INSP}/repairs/certify`, CERTIFY);
    const upload = rec.storageCalls().find((o) => o.fn === "upload")!;
    const text = await pdfText(upload.args[1] as Buffer);
    const signedOn = (rec.writtenRows("inspection_repair_certifications")[0] as { signed_on: string }).signed_on;
    const printed = `${signedOn.slice(5, 7)}/${signedOn.slice(8, 10)}/${signedOn.slice(0, 4)}`;
    for (const s of ["WO-10482", "Truck 1234", "393.47E", "Repaired at the scene", "Dana Reyes", "Safety Director", "from FleetPal", "10/16/2026 12:00 PM", printed]) {
      expect(text).toContain(s);
    }
  });

  it("⚠ refuses while a unit's repair is still unnamed", async () => {
    rec = recorder([row({}), row({ id: SCENE, inspection_unit_id: UNIT2, outcome: "repaired_at_scene", candidates: [] })]);
    const res = await send("POST", `/${INSP}/repairs/certify`, { signerTitle: "Safety Director", basedOn: [ENGINE, SCENE] });
    expect([res.status, res.body.error?.code]).toEqual([422, "not_settled"]);
    expect(rec.writtenRows("documents")).toHaveLength(0);
    expect(rec.writtenRows("inspection_repair_certifications")).toHaveLength(0);
  });

  it("⚠ refuses a record that moved since the page loaded", async () => {
    const res = await send("POST", `/${INSP}/repairs/certify`, { signerTitle: "Safety Director", basedOn: [ENGINE, SCENE] });
    expect([res.status, res.body.error?.code]).toEqual([409, "changed"]);
    expect(rec.writtenRows("documents")).toHaveLength(0);
  });

  it("⚠ needs the safety section's manage level — maintenance's is not enough", async () => {
    manages = new Set(["maintenance"]);
    expect((await send("POST", `/${INSP}/repairs/certify`, CERTIFY)).status).toBe(403);
    expect(rec.writtenRows("inspection_repair_certifications")).toHaveLength(0);
  });

  it("refuses without a title", async () => {
    expect((await send("POST", `/${INSP}/repairs/certify`, { ...CERTIFY, signerTitle: "  " })).status).toBe(400);
  });

  it("signs with the email when the profile has no name", async () => {
    rec = recorder(SETTLED, { name: null });
    expect((await send("POST", `/${INSP}/repairs/certify`, CERTIFY)).status).toBe(201);
    expect(rec.writtenRows("inspection_repair_certifications")[0]).toMatchObject({ signer_name: "dana@example.test" });
  });

  it("⚠ refuses a signer the product cannot name at all", async () => {
    rec = recorder(SETTLED, { unknown: true });
    const res = await send("POST", `/${INSP}/repairs/certify`, CERTIFY);
    expect([res.status, res.body.error?.code]).toEqual([422, "no_name"]);
    expect(rec.writtenRows("documents")).toHaveLength(0);
  });

  it("answers 404 for an inspection with no vehicle violation", async () => {
    rec = recorder([]);
    expect((await send("POST", `/${INSP}/repairs/certify`, CERTIFY)).status).toBe(404);
  });

  it("a retried click lands on the same rows: same ids, and a duplicate certification is not an error", async () => {
    await send("POST", `/${INSP}/repairs/certify`, CERTIFY);
    const first = rec.writtenRows("inspection_repair_certifications")[0] as { id: string; document_id: string };
    rec = recorder(SETTLED, { certWriteError: { code: "23505", message: "duplicate key" } });
    const again = await send("POST", `/${INSP}/repairs/certify`, CERTIFY);
    expect(again.status).toBe(201);
    const second = rec.writtenRows("inspection_repair_certifications")[0] as { id: string; document_id: string };
    expect([second.id, second.document_id]).toEqual([first.id, first.document_id]);
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });
});

describe("the certification as the card reads it", () => {
  const cert = (repairs: { unitId: string; repairId: string }[]) => ({
    id: "c-1", org_id: ORG, inspection_id: INSP, signer_name: "Dana Reyes", signer_title: "Safety Director", signed_on: "2026-10-16",
    repairs, document_id: "d-1", created_at: "2026-10-16T17:30:00Z",
  });

  it("is current while every unit's newest row is the one certified", async () => {
    rec = recorder(SETTLED, { certs: [cert([{ unitId: UNIT, repairId: PERSON }, { unitId: UNIT2, repairId: SCENE }])] });
    const res = await send("GET", `/${INSP}/repairs/certification`);
    expect(res.body.data as RoadsideRepairCertificationDto).toMatchObject({ signerName: "Dana Reyes", signerTitle: "Safety Director", documentId: "d-1", current: true });
    expectOrgScoped(rec, ORG);
  });

  it("⚠ is no longer current once a unit has a newer row", async () => {
    const later = row({ id: "p-2", source: "person", outcome: "repaired_outside_fleetpal", note: "TA", decided_by: "u-2", created_at: "2026-10-17T12:00:00Z" });
    rec = recorder([...SETTLED, later], { certs: [cert([{ unitId: UNIT, repairId: PERSON }, { unitId: UNIT2, repairId: SCENE }])] });
    expect(((await send("GET", `/${INSP}/repairs/certification`)).body.data as RoadsideRepairCertificationDto).current).toBe(false);
  });

  it("is null before the first certification, on the safety section's view alone", async () => {
    manages = new Set();
    const res = await send("GET", `/${INSP}/repairs/certification`);
    expect([res.status, res.body.data]).toEqual([200, null]);
  });
});
