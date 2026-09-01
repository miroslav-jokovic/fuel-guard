import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { INSPECTION_ITEM_COUNT, defaultInspectionItems } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The §396.17 inspection API (plan step A4).
 *
 * ── WHY THIS FILE EXISTS GIVEN annual-inspections.test.mjs ──────────────────────────────────────
 * That matrix proves the RLS policies, and the RLS policies guard PostgREST. They do NOT guard
 * these handlers: the API reads with the SERVICE ROLE, which bypasses RLS entirely (root
 * CLAUDE.md, docs/ARCHITECTURE.md §3). For every query below, the `.eq("org_id")` is the only
 * tenancy boundary there is — a handler that forgot one would pass the matrix and still hand a
 * reader another carrier's inspection reports.
 */
const ORG = "org-1";
const USER = "user-1";
const INSPECTOR = "33333333-3333-4333-8333-333333333333";
const VEHICLE = "22222222-2222-4222-8222-222222222222";
const REPORT = "11111111-1111-4111-8111-111111111111";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../lib/audit.js", () => ({ writeAudit: vi.fn(async () => true) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "technician", email: "shop@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { inspectionsRouter } = await import("./inspections.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/maintenance/inspections", inspectionsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await closeTestServer(server);
  }
}

const QUALIFIED_INSPECTOR = {
  id: INSPECTOR,
  full_name: "George Gacev",
  address: null,
  user_id: null,
  qualification_basis: "training_and_experience",
  brake_qualified: true,
  evidence_document_id: null,
  effective_from: "2024-01-01",
  effective_to: null,
  notes: null,
  created_at: "2024-01-01T00:00:00Z",
};

const draftReport = (status: "draft" | "final" = "draft") => ({
  id: REPORT,
  org_id: ORG,
  subject_type: "tractor",
  subject_id: VEHICLE,
  inspector_id: INSPECTOR,
  inspected_on: "2026-06-16",
  catalogue_version: "1.0.0",
  // The serial off the §396.17(c)(2) decal, because the list is searched by it.
  decal_serial: "610641628",
  status,
  outcome: status === "final" ? "pass" : null,
});

const CREATE = {
  id: REPORT,
  subjectType: "tractor",
  subjectId: VEHICLE,
  inspectorId: INSPECTOR,
  inspectedOn: "2026-06-16",
};

beforeEach(() => {
  rec = createSupabaseRecorder({
    tables: {
      maintenance_inspectors: [QUALIFIED_INSPECTOR],
      vehicle_inspections: [],
      vehicle_inspection_items: [],
    },
  });
});

const post = (base: string, body: unknown, path = "") =>
  fetch(`${base}/api/maintenance/inspections${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("creating a draft", () => {
  it("seeds a REEFER trailer's engine and fuel system, and a dry van's as N/A", async () => {
    // 46 of 211 trailers are reefers. Seeding one checklist for both would open a dry van's exhaust
    // and fuel on Ok — an inspection of parts it does not have.
    for (const [isReefer, expected] of [[true, "ok"], [false, "na"]] as const) {
      rec = createSupabaseRecorder({
        tables: {
          maintenance_inspectors: [QUALIFIED_INSPECTOR],
          vehicle_inspections: [],
          trailers: [{ id: VEHICLE, unit_number: "T-1", vin: null, plate: null, is_reefer: isReefer }],
        },
      });
      await withServer(async (base) => post(base, { ...CREATE, subjectType: "trailer" }));
      const seeded = rec.writtenRows("vehicle_inspection_items");
      const fuel = seeded.find((r) => r.item_key === "fuel.tank_secure");
      expect(fuel!.result, String(isReefer)).toBe(expected);
    }
  });

  it("seeds every catalogue component, so D-AVI5 costs the inspector nothing", async () => {
    const status = await withServer(async (base) => (await post(base, CREATE)).status);
    expect(status).toBe(201);

    const seeded = rec.writtenRows("vehicle_inspection_items");
    expect(seeded).toHaveLength(INSPECTION_ITEM_COUNT);
    // Seeded at the catalogue's opening answer for a TRACTOR — not blank, and not all `ok`.
    const expected = new Map(defaultInspectionItems("tractor").map((i) => [i.key, i.result]));
    for (const row of seeded) {
      expect(expected.get(row.item_key as string), row.item_key as string).toBe(row.result);
      // Nothing is the inspector's answer until they touch it (D-AVI13).
      expect(row.source).toBe("default");
      expect(row.org_id).toBe(ORG);
    }
  });

  it("pins the catalogue version onto the report, so it renders as it was inspected", async () => {
    await withServer(async (base) => post(base, CREATE));
    const [report] = rec.writtenRows("vehicle_inspections");
    expect(report!.catalogue_version).toBeTruthy();
    expect(report!.org_id).toBe(ORG);
    // Never `final` from this door — there is no finalize verb until A6.
    expect(report!.status).toBeUndefined();
  });

  it("records the decal serial and the agency line the form carries", async () => {
    // Both are on CREATE and not only on PATCH because of WHEN they are legible: the serial is read
    // off the sticker in the report set the inspector is holding. Until this shipped, nothing in the
    // product could write either one, and the register's "Decal" column was a column of dashes.
    await withServer(async (base) =>
      post(base, { ...CREATE, decalSerial: "610685784", inspectionAgencyLocation: "PETERBILT OF CHICAGO, MELROSE PARK IL" }),
    );
    const [report] = rec.writtenRows("vehicle_inspections");
    expect(report!.decal_serial).toBe("610685784");
    expect(report!.inspection_agency_location).toBe("PETERBILT OF CHICAGO, MELROSE PARK IL");
  });

  it("leaves both null when they are not given — a failed inspection gets no decal", async () => {
    await withServer(async (base) => post(base, CREATE));
    const [report] = rec.writtenRows("vehicle_inspections");
    expect(report!.decal_serial).toBeNull();
    expect(report!.inspection_agency_location).toBeNull();
  });

  it("refuses a decal serial another report already carries, and says which mistake it is", async () => {
    // 0280's `unique (org_id, decal_serial)`. One decal is one inspection: the sticker is often the
    // ONLY on-vehicle proof a §396.17 inspection happened, so a repeat is either a transcription
    // slip or a decal peeled onto a second truck — the second of which puts a vehicle on the road
    // wearing proof of an inspection it never had. Before this it was a bare 500.
    rec = createSupabaseRecorder({
      tables: {
        maintenance_inspectors: [QUALIFIED_INSPECTOR],
        vehicle_inspections: {
          data: [],
          writeError: {
            code: "23505",
            message: 'duplicate key value violates unique constraint "vehicle_inspections_decal_serial_idx"',
          },
        },
      },
    });
    const res = await withServer(async (base) => {
      const r = await post(base, { ...CREATE, decalSerial: "610685784" });
      return { status: r.status, body: (await r.json()) as { error?: { code?: string; message?: string } } };
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("duplicate_decal");
    expect(res.body.error?.message).toContain("One decal belongs to one inspection");
  });

  it("org-scopes every query it makes", async () => {
    await withServer(async (base) => post(base, CREATE));
    expectOrgScoped(rec, ORG);
  });

  it("replays a retried submit onto the same report instead of making a second one", async () => {
    rec = createSupabaseRecorder({
      tables: { maintenance_inspectors: [QUALIFIED_INSPECTOR], vehicle_inspections: [draftReport()] },
    });
    const status = await withServer(async (base) => (await post(base, CREATE)).status);
    expect(status).toBe(200);
    expect(rec.writtenRows("vehicle_inspections")).toHaveLength(0);
    expect(rec.writtenRows("vehicle_inspection_items")).toHaveLength(0);
  });

  it("refuses an inspector who is not on the register, without writing anything", async () => {
    rec = createSupabaseRecorder({ tables: { maintenance_inspectors: [], vehicle_inspections: [] } });
    const res = await withServer(async (base) => {
      const r = await post(base, CREATE);
      return { status: r.status, body: (await r.json()) as { error?: { code?: string } } };
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("unknown_inspector");
    expect(rec.writes()).toHaveLength(0);
  });

  it("refuses an inspector whose §396.19 qualification does not cover the day (D-AVI6)", async () => {
    rec = createSupabaseRecorder({
      tables: {
        // Retired in 2025; the inspection is dated 2026-06-16.
        maintenance_inspectors: [{ ...QUALIFIED_INSPECTOR, effective_to: "2025-12-31" }],
        vehicle_inspections: [],
      },
    });
    const res = await withServer(async (base) => {
      const r = await post(base, CREATE);
      return { status: r.status, body: (await r.json()) as { error?: { code?: string } } };
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("inspector_not_qualified");
    expect(rec.writes()).toHaveLength(0);
  });

  it("refuses a subject type the equipment tables do not have", async () => {
    const status = await withServer(async (base) =>
      (await post(base, { ...CREATE, subjectType: "driver" })).status,
    );
    expect(status).toBe(400);
    expect(rec.queries).toHaveLength(0);
  });
});

describe("reading one report", () => {
  /**
   * ── THE FIELD THE TYPE CLAIMED AND THE SERVER DID NOT SEND ───────────────────────────────────
   * `vehicle_inspections` holds `subject_id`, a uuid. The LIST route has always resolved that into a
   * unit number through `roster`; this route did not, while the web's `InspectionDetail extends
   * InspectionSummary` declared `unit_number` anyway. Nothing read it, so nothing failed — until the
   * delete drawer asked somebody to type the unit back, got an empty string, and became impossible
   * to satisfy (reported 2026-09-01, the day it shipped).
   *
   * A type that promises a field the server never sends is not caught by typecheck, by lint, or by
   * any test that does not read it. This is that test.
   */
  it("carries the unit number, because the row only has a uuid and nobody reads those", async () => {
    rec = createSupabaseRecorder({
      tables: {
        vehicle_inspections: [draftReport("final")],
        vehicle_inspection_items: [],
        vehicles: [{ id: VEHICLE, unit_number: "1187", vin: "3AKJ", plate: "IL 1234" }],
      },
    });
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/maintenance/inspections/${REPORT}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { inspection: { unit_number: string | null } };
      expect(body.inspection.unit_number).toBe("1187");
    });
  });

  it("sends null rather than failing when the equipment is gone from the roster", async () => {
    // A report outlives the truck it was about. The drawer refuses to confirm on a null rather than
    // offering a box nobody can satisfy, which is the other half of the same fix.
    rec = createSupabaseRecorder({
      tables: { vehicle_inspections: [draftReport("final")], vehicle_inspection_items: [], vehicles: [] },
    });
    await withServer(async (base) => {
      const body = (await (await fetch(`${base}/api/maintenance/inspections/${REPORT}`)).json()) as {
        inspection: { unit_number: string | null };
      };
      expect(body.inspection.unit_number).toBeNull();
    });
  });
});

describe("patching a draft", () => {
  const patch = (base: string, body: unknown) =>
    fetch(`${base}/api/maintenance/inspections/${REPORT}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    rec = createSupabaseRecorder({
      tables: {
        maintenance_inspectors: [QUALIFIED_INSPECTOR],
        vehicle_inspections: [draftReport()],
        vehicle_inspection_items: [{ item_key: "brake.hose", result: "ok", source: "default", repaired_at: null, note: null }],
      },
    });
  });

  it("marks a patched component as the inspector's answer, not a default", async () => {
    await withServer(async (base) => patch(base, { items: [{ key: "brake.hose", result: "needs_repair" }] }));
    const writes = rec.forTable("vehicle_inspection_items").filter((q) => q.write?.method === "update");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.write!.payload).toMatchObject({ result: "needs_repair", source: "inspector" });
  });

  it("groups components sharing an answer into ONE statement", async () => {
    await withServer(async (base) =>
      patch(base, {
        items: [
          { key: "brake.hose", result: "needs_repair" },
          { key: "brake.tubing", result: "needs_repair" },
          { key: "wheels.welds", result: "na" },
        ],
      }),
    );
    const updates = rec.forTable("vehicle_inspection_items").filter((q) => q.write?.method === "update");
    // Two answers, two statements — not three, and not fifty-six.
    expect(updates).toHaveLength(2);
  });

  it("refuses to edit a finalized report — evidence, not a draft (D-AVI4)", async () => {
    rec = createSupabaseRecorder({
      tables: { maintenance_inspectors: [QUALIFIED_INSPECTOR], vehicle_inspections: [draftReport("final")] },
    });
    const res = await withServer(async (base) => {
      const r = await patch(base, { items: [{ key: "brake.hose", result: "ok" }] });
      return { status: r.status, body: (await r.json()) as { error?: { code?: string } } };
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("already_final");
    // The API refused it BEFORE the database had to — 0280's trigger is the second line, not the first.
    expect(rec.writes()).toHaveLength(0);
  });

  it("answers 404 for a report in another org, indistinguishable from one that does not exist", async () => {
    rec = createSupabaseRecorder({ tables: { maintenance_inspectors: [QUALIFIED_INSPECTOR], vehicle_inspections: [] } });
    const status = await withServer(async (base) => (await patch(base, { otherConditions: "x" })).status);
    expect(status).toBe(404);
  });

  it("org-scopes every query, including the component updates", async () => {
    await withServer(async (base) => patch(base, { items: [{ key: "brake.hose", result: "na" }] }));
    expectOrgScoped(rec, ORG);
  });

  it("re-reads the report after saving, so the client's state becomes DB truth", async () => {
    await withServer(async (base) => patch(base, { otherConditions: "Mirror bracket loose" }));
    const reads = rec.forTable("vehicle_inspections").filter((q) => !q.write);
    // One read to check the status, one to answer with what the database now holds.
    expect(reads.length).toBeGreaterThanOrEqual(2);
  });
});

describe("the list answers what a list is asked (B1)", () => {
  const listRec = () =>
    createSupabaseRecorder({
      tables: {
        vehicle_inspections: [draftReport(), { ...draftReport(), id: "other", subject_id: "22222222-2222-4222-8222-99999999999a" }],
        maintenance_inspectors: [QUALIFIED_INSPECTOR],
        vehicles: [
          { id: VEHICLE, unit_number: "654", vin: "3AKJHHDR7RSUX1186", plate: "IL 1234" },
          { id: "22222222-2222-4222-8222-99999999999a", unit_number: "789", vin: null, plate: null },
        ],
      },
    });

  it("resolves the unit number and the inspector's name — a uuid is not readable", async () => {
    rec = listRec();
    const body = await withServer(async (base) => {
      const r = await fetch(`${base}/api/maintenance/inspections`);
      return (await r.json()) as { inspections: Array<{ unit_number: string | null; inspector_name: string | null }> };
    });
    expect(body.inspections.map((i) => i.unit_number).sort()).toEqual(["654", "789"]);
    expect(body.inspections[0]!.inspector_name).toBe("George Gacev");
  });

  it("reads the equipment in ONE batch, not once per row", async () => {
    rec = listRec();
    await withServer(async (base) => fetch(`${base}/api/maintenance/inspections`));
    // Two reports, two vehicles, one read — the property that stops a 50-row page issuing 50 queries.
    expect(rec.forTable("vehicles")).toHaveLength(1);
    expect(rec.forTable("maintenance_inspectors")).toHaveLength(1);
  });

  it("searches by unit number, and counts what the reader is looking at", async () => {
    rec = listRec();
    const body = await withServer(async (base) => {
      const r = await fetch(`${base}/api/maintenance/inspections?q=789`);
      return (await r.json()) as { inspections: unknown[]; total: number };
    });
    expect(body.inspections).toHaveLength(1);
    // Not the unfiltered total — reporting that beside a filtered list tells somebody a search found
    // nothing when it found one.
    expect(body.total).toBe(1);
  });

  it("searches by decal serial and by inspector, because those are the other two things known", async () => {
    for (const q of ["610641628", "gacev"]) {
      rec = listRec();
      const body = await withServer(async (base) => {
        const r = await fetch(`${base}/api/maintenance/inspections?q=${q}`);
        return (await r.json()) as { inspections: unknown[] };
      });
      expect(body.inspections.length, q).toBeGreaterThan(0);
    }
  });

  it("filters by outcome", async () => {
    rec = listRec();
    await withServer(async (base) => fetch(`${base}/api/maintenance/inspections?outcome=fail`));
    expect(rec.queries[0]!.filters()).toContainEqual({ col: "outcome", val: "fail" });
  });

  it("org-scopes the equipment and inspector reads too, not only its own table", async () => {
    rec = listRec();
    await withServer(async (base) => fetch(`${base}/api/maintenance/inspections`));
    expectOrgScoped(rec, ORG);
  });
});

describe("correcting a completed inspection — D-AVI4's other half", () => {
  const NEW_ID = "44444444-4444-4444-8444-444444444444";
  const correct = (base: string, id = NEW_ID) =>
    fetch(`${base}/api/maintenance/inspections/${REPORT}/correct`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });

  it("starts a new report that POINTS AT the one it replaces", async () => {
    // A FUNCTION fixture, because the correction reads two different ids from one table: the report
    // being superseded must exist, and the id of the new one must not. A static fixture answers both
    // reads with the same row and the idempotency check then "finds" a report that was never made.
    rec = createSupabaseRecorder({
      tables: {
        vehicle_inspections: (q) =>
          q.filters().some((f) => f.val === NEW_ID) ? [] : [draftReport("final")],
        vehicle_inspection_items: [
          { item_key: "brake.hose", result: "ok", source: "inspector", repaired_at: null, note: null },
        ],
      },
    });
    const status = await withServer(async (base) => (await correct(base)).status);
    expect(status).toBe(201);
    const [row] = rec.writtenRows("vehicle_inspections");
    // Without this link a correction is just an unrelated inspection, which is what shipped for a
    // week while the column existed and nothing wrote it.
    expect(row).toMatchObject({ id: NEW_ID, supersedes_id: REPORT, subject_id: VEHICLE });
    expect(row!.status).toBeUndefined();
  });

  it("seeds the previous answers, keeping which of them a person actually set", async () => {
    rec = createSupabaseRecorder({
      tables: {
        vehicle_inspections: (q) =>
          q.filters().some((f) => f.val === NEW_ID) ? [] : [draftReport("final")],
        vehicle_inspection_items: [
          { item_key: "brake.hose", result: "needs_repair", source: "inspector", repaired_at: "2026-06-17", note: "n" },
          { item_key: "brake.tubing", result: "ok", source: "default", repaired_at: null, note: null },
        ],
      },
    });
    await withServer(async (base) => correct(base));
    const seeded = rec.writtenRows("vehicle_inspection_items");
    expect(seeded).toHaveLength(2);
    // Somebody fixing one mark should not walk 56 rows again — and a component the first inspector
    // actually set must not silently become a default.
    expect(seeded.find((r) => r.item_key === "brake.hose")).toMatchObject({
      result: "needs_repair", source: "inspector", repaired_at: "2026-06-17",
    });
    expect(seeded.find((r) => r.item_key === "brake.tubing")!.source).toBe("default");
  });

  it("refuses to 'correct' a draft — that one is still editable", async () => {
    rec = createSupabaseRecorder({ tables: { vehicle_inspections: [draftReport()] } });
    const status = await withServer(async (base) => (await correct(base)).status);
    expect(status).toBe(409);
    expect(rec.writes()).toHaveLength(0);
  });
});

describe("discarding a draft", () => {
  const discard = (base: string) =>
    fetch(`${base}/api/maintenance/inspections/${REPORT}`, { method: "DELETE" });

  it("removes a draft", async () => {
    rec = createSupabaseRecorder({ tables: { vehicle_inspections: [draftReport()] } });
    const status = await withServer(async (base) => (await discard(base)).status);
    expect(status).toBe(200);
    const del = rec.forTable("vehicle_inspections").find((q) => q.write?.method === "delete");
    // Belt and braces on one statement: the guard read said draft, and the delete says so too.
    expect(del!.filters()).toContainEqual({ col: "status", val: "draft" });
  });

  it("REFUSES to delete a completed inspection, and writes nothing", async () => {
    // The API is the only thing between a mis-typed id and a deleted §396.21 record: there is no
    // DELETE policy, but the service role bypasses RLS.
    rec = createSupabaseRecorder({ tables: { vehicle_inspections: [draftReport("final")] } });
    const res = await withServer(async (base) => {
      const r = await discard(base);
      return { status: r.status, body: (await r.json()) as { error?: { code?: string } } };
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("already_final");
    expect(rec.writes()).toHaveLength(0);
  });
});

describe("reading", () => {
  it("org-scopes the list and its filters", async () => {
    rec = createSupabaseRecorder({ tables: { vehicle_inspections: [draftReport()] } });
    await withServer(async (base) => fetch(`${base}/api/maintenance/inspections?subjectType=trailer&status=draft`));
    expectOrgScoped(rec, ORG);
    const filters = rec.queries[0]!.filters();
    expect(filters).toContainEqual({ col: "subject_type", val: "trailer" });
    expect(filters).toContainEqual({ col: "status", val: "draft" });
  });

  it("org-scopes the detail read and its components", async () => {
    rec = createSupabaseRecorder({
      tables: { vehicle_inspections: [draftReport()], vehicle_inspection_items: [] },
    });
    await withServer(async (base) => fetch(`${base}/api/maintenance/inspections/${REPORT}`));
    expectOrgScoped(rec, ORG);
  });
});
