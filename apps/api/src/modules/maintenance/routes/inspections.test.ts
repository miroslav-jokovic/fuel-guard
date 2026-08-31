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
