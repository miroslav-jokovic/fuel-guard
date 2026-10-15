import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeTestServer } from "../../../testing/httpServer.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * An inspection's paper — `GET`/`POST /api/roadside-inspections/:id/documents` and its download
 * (INSPECTION-CHALLENGE-PLAN IC2, migration 0476).
 *
 * `documents.subject_id` has no FK, so the route is the only thing between a safety reader and the
 * carrier's other documents. Every fixture is a FUNCTION of the filters applied: a read that forgets
 * the subject gets the driver's medical card, one that forgets `org_id` gets another carrier's paper,
 * and a download that trusts the document id alone hands either over.
 */

const ORG = "org-1";
const INSP = "11111111-1111-4111-8111-111111111111";
const INSP_OTHER = "22222222-2222-4222-8222-222222222222"; // ours, another inspection
const INSP_GONE = "33333333-3333-4333-8333-333333333333"; // FMCSA removed it
const INSP_X = "44444444-4444-4444-8444-444444444444"; // another carrier's
const DRIVER = "55555555-5555-4555-8555-555555555555";
const DOC = (n: number) => `d000000${n}-0000-4000-8000-000000000000`;
const NEW_DOC = "66666666-6666-4666-8666-666666666666";
const SHA = "a".repeat(64);

let rec: SupabaseRecorder;
let viewOnly = false;
const dispatched: Array<{ kind: string; opts: { payload: { documentId: string } } }> = [];

vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../queue/dispatch.js", () => ({
  dispatchJob: async (_admin: unknown, _env: unknown, kind: string, opts: { payload: { documentId: string } }) => {
    dispatched.push({ kind, opts });
    return { ok: true };
  },
}));
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

const val = (q: RecordedQuery, method: string, col: string) => q.ops.find((o) => o.method === method && o.args[0] === col)?.args[1];

const INSPECTIONS = [
  { id: INSP, org_id: ORG, vanished_at: null },
  { id: INSP_OTHER, org_id: ORG, vanished_at: null },
  { id: INSP_GONE, org_id: ORG, vanished_at: "2026-10-01T00:00:00Z" },
  { id: INSP_X, org_id: "org-2", vanished_at: null },
];
const doc = (n: number, org: string, subject_type: string, subject_id: string, kind: string) => ({
  id: DOC(n), org_id: org, subject_type, subject_id, kind, content_type: "application/pdf", bytes: 1000, sha256: SHA, page: 1,
  variant: "original", captured_at: null, created_at: `2026-10-1${n}T12:00:00Z`, storage_path: `${org}/${subject_type}/${subject_id}/${DOC(n)}.pdf`, derived_from: null,
});
const DOCUMENTS = [
  doc(1, ORG, "roadside_inspection", INSP, "citation"),
  doc(2, ORG, "roadside_inspection", INSP_OTHER, "court_disposition"),
  doc(3, ORG, "driver", DRIVER, "medical_card"),
  doc(4, "org-2", "roadside_inspection", INSP, "citation"),
];

function recorder() {
  return createSupabaseRecorder({
    tables: {
      roadside_inspections: (q) => {
        const current = q.ops.some((o) => o.method === "is" && o.args[0] === "vanished_at" && o.args[1] === null);
        return INSPECTIONS.filter((r) => r.org_id === val(q, "eq", "org_id") && r.id === val(q, "eq", "id") && (!current || !r.vanished_at));
      },
      documents: (q) => {
        if (q.write) return [];
        return DOCUMENTS.filter(
          (d) =>
            d.org_id === val(q, "eq", "org_id") &&
            (val(q, "eq", "id") === undefined || d.id === val(q, "eq", "id")) &&
            (val(q, "eq", "subject_type") === undefined || d.subject_type === val(q, "eq", "subject_type")) &&
            (val(q, "eq", "subject_id") === undefined || d.subject_id === val(q, "eq", "subject_id")),
        );
      },
      audit_logs: [],
    },
    storage: {
      createSignedUploadUrl: (path: string) => ({ data: { signedUrl: `https://storage.test/upload/${path}`, token: "tok" }, error: null }),
      createSignedUrls: (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://storage.test/read/${p}` })), error: null }),
      createSignedUrl: (path: string) => ({ data: { signedUrl: `https://storage.test/download/${path}` }, error: null }),
    },
  });
}

async function send(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: any }> {
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
    return { status: res.status, body: await res.json() };
  } finally {
    await closeTestServer(server);
  }
}

const register = (over: Record<string, unknown> = {}) => ({ id: NEW_DOC, kind: "citation", contentType: "application/pdf", sha256: SHA, bytes: 2048, ...over });

beforeEach(() => {
  rec = recorder();
  viewOnly = false;
  dispatched.length = 0;
});

describe("GET /api/roadside-inspections/:id/documents", () => {
  it("lists only this inspection's documents, each with a signed URL, scoped to the org", async () => {
    const res = await send("GET", `/${INSP}/documents`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((d: { id: string }) => d.id)).toEqual([DOC(1)]);
    expect(res.body.data[0]).toMatchObject({ kind: "citation", subjectType: "roadside_inspection", url: `https://storage.test/read/${ORG}/roadside_inspection/${INSP}/${DOC(1)}.pdf` });
    expectOrgScoped(rec, ORG);
  });

  it("answers 404 for an inspection FMCSA removed or another carrier's, and reads no documents", async () => {
    for (const id of [INSP_GONE, INSP_X]) {
      const res = await send("GET", `/${id}/documents`);
      expect(res.status).toBe(404);
    }
    expect(rec.forTable("documents")).toHaveLength(0);
  });
});

describe("POST /api/roadside-inspections/:id/documents", () => {
  it("files the document against the inspection, signs its upload, audits it, and queues no thumbnail for a PDF", async () => {
    const res = await send("POST", `/${INSP}/documents`, register());
    expect(res.status).toBe(201);
    const path = `${ORG}/roadside_inspection/${INSP}/${NEW_DOC}.pdf`;
    expect(res.body.data).toMatchObject({ documentId: NEW_DOC, storagePath: path, token: "tok" });
    expect(rec.writtenRows("documents")).toEqual([
      expect.objectContaining({
        id: NEW_DOC, org_id: ORG, subject_type: "roadside_inspection", subject_id: INSP, kind: "citation",
        storage_path: path, content_type: "application/pdf", sha256: SHA, bytes: 2048, page: 1, variant: "original", uploaded_by: "u-1",
      }),
    ]);
    expect(rec.writtenRows("audit_logs")).toEqual([
      expect.objectContaining({ action: "roadside.document_registered", entity_id: INSP }),
    ]);
    expect(dispatched).toEqual([]);
    expectOrgScoped(rec, ORG);
  });

  it("queues the thumbnail and normalised copy for a photo", async () => {
    const res = await send("POST", `/${INSP}/documents`, register({ contentType: "image/jpeg", kind: "court_disposition" }));
    expect(res.status).toBe(201);
    expect(dispatched).toEqual([{ kind: "document_derive", opts: expect.objectContaining({ payload: { documentId: NEW_DOC } }) }]);
  });

  it("refuses a kind a person does not upload here: IC4's DataQs packet, or a DQ file's medical card", async () => {
    for (const kind of ["dataqs_packet", "medical_card"]) {
      const res = await send("POST", `/${INSP}/documents`, register({ kind }));
      expect(res.status).toBe(400);
    }
    expect(rec.writes()).toHaveLength(0);
  });

  it("refuses a reader at the safety section's view level", async () => {
    viewOnly = true;
    const res = await send("POST", `/${INSP}/documents`, register());
    expect(res.status).toBe(403);
    expect(rec.writes()).toHaveLength(0);
  });

  it("files nothing against an inspection FMCSA removed or another carrier's", async () => {
    for (const id of [INSP_GONE, INSP_X]) {
      const res = await send("POST", `/${id}/documents`, register());
      expect(res.status).toBe(404);
    }
    expect(rec.writes()).toHaveLength(0);
    expect(rec.storageCalls()).toHaveLength(0);
  });
});

describe("GET /api/roadside-inspections/:id/documents/:documentId/download", () => {
  it("signs this inspection's document as a download and audits it", async () => {
    const res = await send("GET", `/${INSP}/documents/${DOC(1)}/download`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      url: `https://storage.test/download/${ORG}/roadside_inspection/${INSP}/${DOC(1)}.pdf`,
      filename: "roadside_inspection-citation-2026-10-11.pdf",
    });
    expect(rec.writtenRows("audit_logs")).toEqual([
      expect.objectContaining({ action: "roadside.document_downloaded", entity_id: INSP }),
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("will not hand over a document that is not this inspection's — the driver's medical card, or another inspection's ticket", async () => {
    for (const d of [DOC(3), DOC(2)]) {
      const res = await send("GET", `/${INSP}/documents/${d}/download`);
      expect(res.status).toBe(404);
      expect(res.body.url).toBeUndefined();
    }
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });

  it("answers 404 through an inspection FMCSA removed", async () => {
    const res = await send("GET", `/${INSP_GONE}/documents/${DOC(1)}/download`);
    expect(res.status).toBe(404);
    expect(rec.forTable("documents")).toHaveLength(0);
  });
});
