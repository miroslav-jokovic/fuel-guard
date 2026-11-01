import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeTestServer } from "../../../testing/httpServer.js";
import { createSupabaseRecorder, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * `/api/compliance/documents` is the `roster` section's route, and since 0476 `documents` also holds a
 * roadside inspection's paper, which is the `safety` section's (INSPECTION-CHALLENGE-PLAN D-IC12). A
 * roster manager is not a safety reader, so this route must neither file, list nor download that
 * subject — each refusal beside a control showing the same call still works for a driver's document,
 * so a route that refuses everything cannot pass.
 */

const ORG = "org-1";
const DRIVER = "55555555-5555-4555-8555-555555555555";
const INSP = "11111111-1111-4111-8111-111111111111";
const ROADSIDE_DOC = "d0000001-0000-4000-8000-000000000000";
const DRIVER_DOC = "d0000002-0000-4000-8000-000000000000";
const SHA = "a".repeat(64);

let rec: SupabaseRecorder;
/** The caller's role — `admin` unless a case says otherwise (Q-WF4's cases below). */
let role = "admin";

vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../queue/dispatch.js", () => ({ dispatchJob: async () => ({ ok: true }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: ORG, role, email: `${role}@example.test` } as Request["auth"];
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { complianceRouter } = await import("./compliance.js");

const val = (q: RecordedQuery, col: string) => q.ops.find((o) => o.method === "eq" && o.args[0] === col)?.args[1];
const row = (id: string, subject_type: string, subject_id: string, kind: string) => ({
  id, org_id: ORG, subject_type, subject_id, kind, content_type: "application/pdf", storage_path: `${ORG}/${subject_type}/${subject_id}/${id}.pdf`,
  captured_at: null, created_at: "2026-10-15T12:00:00Z", variant: "original",
});
const DOCUMENTS = [row(ROADSIDE_DOC, "roadside_inspection", INSP, "citation"), row(DRIVER_DOC, "driver", DRIVER, "other")];

beforeEach(() => {
  role = "admin";
  rec = createSupabaseRecorder({
    tables: {
      documents: (q) => (q.write ? [] : DOCUMENTS.filter((d) => val(q, "id") === undefined || d.id === val(q, "id"))),
      drivers: [{ full_name: "Jovana Petrović" }],
      audit_logs: [],
    },
    storage: {
      createSignedUploadUrl: (path: string) => ({ data: { signedUrl: `https://storage.test/upload/${path}`, token: "tok" }, error: null }),
      createSignedUrl: (path: string) => ({ data: { signedUrl: `https://storage.test/download/${path}` }, error: null }),
      createSignedUrls: () => ({ data: [], error: null }),
    },
  });
});

/** What these routes answer: `{ ok, data }`, an `error`, or a download's `{ url, filename }`. */
type Body = { ok?: boolean; data?: unknown; error?: { code: string; message?: string }; url?: string; filename?: string };

async function send(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: Body }> {
  const app = express();
  app.use(express.json());
  app.use("/api/compliance", complianceRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/compliance${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Body };
  } finally {
    await closeTestServer(server);
  }
}

const register = (over: Record<string, unknown>) => ({
  id: "66666666-6666-4666-8666-666666666666", subjectType: "driver", subjectId: DRIVER, kind: "other",
  contentType: "application/pdf", sha256: SHA, ...over,
});

describe("/api/compliance/documents keeps a roadside inspection's paper out (0476, D-IC12)", () => {
  it("files a driver's document (the control)", async () => {
    expect((await send("POST", "/documents", register({}))).status).toBe(201);
  });

  it("refuses to file against a roadside inspection, or as an inspection's kind", async () => {
    expect((await send("POST", "/documents", register({ subjectType: "roadside_inspection", subjectId: INSP, kind: "citation" }))).status).toBe(400);
    expect((await send("POST", "/documents", register({ kind: "court_disposition" }))).status).toBe(400);
    expect(rec.writes()).toHaveLength(0);
  });

  it("lists a driver's documents (the control) and refuses to list an inspection's", async () => {
    expect((await send("GET", `/documents?subjectType=driver&subjectId=${DRIVER}`)).status).toBe(200);
    expect((await send("GET", `/documents?subjectType=roadside_inspection&subjectId=${INSP}`)).status).toBe(400);
  });

  it("downloads a driver's document (the control) and answers an inspection's as not on file", async () => {
    expect((await send("GET", `/documents/${DRIVER_DOC}/download`)).status).toBe(200);
    rec.reset();
    const res = await send("GET", `/documents/${ROADSIDE_DOC}/download`);
    expect(res.status).toBe(404);
    expect(res.body.url).toBeUndefined();
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });
});

/**
 * Q-WF4 (HIRING-WORKFLOW-AUDIT §9 P9): an SSN card's or a passport's image is withheld from every role
 * `canSeePaperImage` refuses — on the driver's file too, not only on the applicant record. The row stays.
 */
describe("/api/compliance/documents withholds an identity paper's picture (Q-WF4)", () => {
  const PASSPORT = "d0000003-0000-4000-8000-000000000000";
  const withPassport = () => {
    const docs = [row(PASSPORT, "driver", DRIVER, "passport"), row(DRIVER_DOC, "driver", DRIVER, "other")];
    rec = createSupabaseRecorder({
      tables: {
        documents: (q) => (q.write ? [] : docs.filter((d) => val(q, "id") === undefined || d.id === val(q, "id"))),
        drivers: [{ full_name: "Jovana Petrović" }],
        audit_logs: [],
      },
      storage: {
        createSignedUrl: (path: string) => ({ data: { signedUrl: `https://storage.test/download/${path}` }, error: null }),
        createSignedUrls: (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://storage.test/${path}` })), error: null }),
      },
    });
  };
  type Listed = { id: string; url: string | null };
  const listed = async () => ((await send("GET", `/documents?subjectType=driver&subjectId=${DRIVER}`)).body as unknown as { documents: Listed[] }).documents;

  it("lists a passport to a fleet manager with no link to its picture, and other papers with theirs", async () => {
    withPassport();
    role = "fleet_manager";
    const docs = await listed();
    expect(docs.find((d) => d.id === PASSPORT)).toMatchObject({ url: null });
    expect(docs.find((d) => d.id === DRIVER_DOC)?.url).toBeTruthy();
  });

  it("hands the admin the passport's picture (the control)", async () => {
    withPassport();
    expect((await listed()).find((d) => d.id === PASSPORT)?.url).toBeTruthy();
  });

  it("refuses the passport's download to a fleet manager, and writes no download to the ledger", async () => {
    withPassport();
    role = "fleet_manager";
    const res = await send("GET", `/documents/${PASSPORT}/download`);
    expect(res.status).toBe(403);
    expect(res.body.url).toBeUndefined();
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });
});
