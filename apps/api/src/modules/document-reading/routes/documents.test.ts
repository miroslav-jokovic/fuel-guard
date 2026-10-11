import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/documents` (DOCUMENT-READER-PLAN Step 1.6b). The services are proved in `intake.test.ts` and
 * `requests.test.ts`; this layer owns the translation — each outcome's STATUS (a duplicate upload is
 * 200 not 201, a second complete is 409 not 500, a non-uuid id is 404 before PostgREST sees it), the
 * intake's dedupe key, and which calls write an audit row (a reused read does not: nothing happened).
 */
const ORG = "org-1";
const USER = "user-1";
const SOURCE = "11111111-1111-4111-8111-111111111111";
const READ = "33333333-3333-4333-8333-333333333333";
const JOB = "44444444-4444-4444-8444-444444444444";
const SHA = "b".repeat(64);
const ASSEMBLY = "55555555-5555-4555-8555-555555555555";
const SOURCE_B = "66666666-6666-4666-8666-666666666666";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
const audit = vi.hoisted(() => ({ writeAudit: vi.fn(async () => true) }));
vi.mock("../../../lib/audit.js", () => audit);
const queue = vi.hoisted(() => ({ dispatchJob: vi.fn(async (..._a: unknown[]): Promise<{ jobId: string } | { conflict: true }> => ({ jobId: "" })) }));
vi.mock("../../../queue/dispatch.js", () => queue);
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "dispatcher", email: "d@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  // What the gates ADMIT is proved in middleware/requireSection.test.ts and routeGates.test.ts.
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../../../middleware/requireModule.js", () => ({
  requireModule: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { documentsRouter } = await import("./documents.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/documents", documentsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/documents`);
  } finally {
    await closeTestServer(server);
  }
}
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const auditActions = () => (audit.writeAudit.mock.calls as unknown as Array<[unknown, { action: string; meta: unknown }]>).map((c) => c[1]);

beforeEach(() => {
  audit.writeAudit.mockClear();
  queue.dispatchJob.mockReset();
  queue.dispatchJob.mockResolvedValue({ jobId: JOB });
});

describe("POST /sources", () => {
  const body = { fileName: "bol.pdf", mime: "application/pdf", byteSize: 1000, sha256: SHA };

  it("answers 201 with an upload URL for new bytes", async () => {
    rec = createSupabaseRecorder({ storage: { createSignedUploadUrl: () => ({ data: { signedUrl: "https://storage.example.test/put" }, error: null }) } });
    await withServer(async (base) => {
      const res = await post(`${base}/sources`, body);
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ uploadUrl: "https://storage.example.test/put", duplicate: false });
    });
    expectOrgScoped(rec, ORG);
  });

  it("answers 200 with no upload URL for bytes the org already holds", async () => {
    rec = createSupabaseRecorder({ tables: { document_sources: [{ id: SOURCE, page_count: 1 }] } });
    await withServer(async (base) => {
      const res = await post(`${base}/sources`, body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ sourceId: SOURCE, uploadUrl: null, duplicate: true });
    });
    expectOrgScoped(rec, ORG);
  });

  it("answers 400 to a body the contract refuses", async () => {
    rec = createSupabaseRecorder();
    await withServer(async (base) => {
      expect((await post(`${base}/sources`, { ...body, sha256: "nope" })).status).toBe(400);
    });
    expect(rec.queries).toEqual([]);
  });
});

describe("POST /sources/:id/complete", () => {
  it("queues the intake under its dedupe key, audits it, and answers 202 with the job", async () => {
    rec = createSupabaseRecorder();
    await withServer(async (base) => {
      const res = await post(`${base}/sources/${SOURCE}/complete`, { sha256: SHA, profile: "shipping_document" });
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ jobId: JOB });
    });
    expect(queue.dispatchJob.mock.calls[0]!.slice(2)).toEqual(["document_intake", {
      orgId: ORG, payload: { sourceId: SOURCE, sha256: SHA, profile: "shipping_document", requestedBy: USER }, dedupKey: `document_intake:${SOURCE}`, requestedBy: USER,
    }]);
    expect(auditActions()).toEqual([expect.objectContaining({ action: "document.intake_started", meta: { profile: "shipping_document", jobId: JOB } })]);
  });

  it("answers 409 already_running to a second complete while the first is running, without an audit row", async () => {
    rec = createSupabaseRecorder();
    queue.dispatchJob.mockResolvedValue({ conflict: true });
    await withServer(async (base) => {
      const res = await post(`${base}/sources/${SOURCE}/complete`, { sha256: SHA });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: "already_running" } });
    });
    expect(auditActions()).toEqual([]);
  });

  it("answers 404 to an id that is not a uuid, before anything is queued", async () => {
    rec = createSupabaseRecorder();
    await withServer(async (base) => {
      expect((await post(`${base}/sources/not-a-uuid/complete`, { sha256: SHA })).status).toBe(404);
      expect((await fetch(`${base}/sources/not-a-uuid`)).status).toBe(404);
      expect((await fetch(`${base}/reads/not-a-uuid`)).status).toBe(404);
    });
    expect(queue.dispatchJob).not.toHaveBeenCalled();
    expect(rec.queries).toEqual([]);
  });
});

describe("GET /sources/:id", () => {
  it("answers the intake's status", async () => {
    rec = createSupabaseRecorder({ tables: { jobs: [{ status: "running", stats: null }], document_sources: [] } });
    await withServer(async (base) => {
      const res = await fetch(`${base}/sources/${SOURCE}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ sourceId: SOURCE, status: "normalising" });
    });
    expectOrgScoped(rec, ORG);
  });
});

describe("POST /reads", () => {
  it("answers 201 and audits a new read, and 200 without an audit row for one already in flight", async () => {
    rec = createSupabaseRecorder({ tables: { document_sources: [{ id: SOURCE }], document_reads: (q) => (q.write ? [{ id: READ }] : []) } });
    await withServer(async (base) => {
      const res = await post(`${base}/reads`, { sourceId: SOURCE, profile: "shipping_document" });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ readId: READ });
    });
    expect(queue.dispatchJob.mock.calls[0]!.slice(2)).toEqual(["document_read", { orgId: ORG, payload: { readId: READ }, dedupKey: `document_read:${READ}`, requestedBy: USER }]);
    expect(auditActions()).toEqual([expect.objectContaining({ action: "document.read_requested" })]);

    audit.writeAudit.mockClear();
    rec = createSupabaseRecorder({ tables: { document_sources: [{ id: SOURCE }], document_reads: [{ id: READ }] } });
    await withServer(async (base) => {
      expect((await post(`${base}/reads`, { sourceId: SOURCE, profile: "shipping_document" })).status).toBe(200);
    });
    expect(auditActions()).toEqual([]);
  });

  it("answers 404 for a source outside the org", async () => {
    rec = createSupabaseRecorder({ tables: { document_sources: [] } });
    await withServer(async (base) => {
      expect((await post(`${base}/reads`, { sourceId: SOURCE, profile: "shipping_document" })).status).toBe(404);
    });
    expect(queue.dispatchJob).not.toHaveBeenCalled();
  });
});

describe("POST /assemblies", () => {
  const sendersWorld = (rpc: unknown = { id: ASSEMBLY }) => createSupabaseRecorder({
    tables: {
      document_sources: [{ id: SOURCE }, { id: SOURCE_B }],
      document_pages: [{ id: "p1", source_id: SOURCE, page_number: 1 }, { id: "p2", source_id: SOURCE_B, page_number: 1 }],
    },
    rpc: { document_assembly_create: rpc },
  });

  it("answers 201 with the assembly and audits who grouped which files", async () => {
    rec = sendersWorld();
    await withServer(async (base) => {
      const res = await post(`${base}/assemblies`, { sourceIds: [SOURCE_B, SOURCE] });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ assemblyId: ASSEMBLY, pageCount: 2 });
    });
    expect(auditActions()).toEqual([expect.objectContaining({
      action: "document.assembly_created", meta: { madeBy: "sender", sourceIds: [SOURCE_B, SOURCE], pageCount: 2 },
    })]);
    expectOrgScoped(rec, ORG);
  });

  it("answers 409 edited_elsewhere when a reviewer's version was already replaced, without an audit row", async () => {
    rec = sendersWorld({ error: { code: "23505", message: "duplicate key" } });
    await withServer(async (base) => {
      const res = await post(`${base}/assemblies`, { supersedes: ASSEMBLY, pageIds: [SOURCE] });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: "edited_elsewhere" } });
    });
    expect(auditActions()).toEqual([]);
  });

  it("answers 400, before any query, to a list naming a file twice or a body mixing both shapes", async () => {
    rec = createSupabaseRecorder();
    await withServer(async (base) => {
      expect((await post(`${base}/assemblies`, { sourceIds: [SOURCE, SOURCE] })).status).toBe(400);
      expect((await post(`${base}/assemblies`, { sourceIds: [SOURCE], pageIds: [SOURCE_B] })).status).toBe(400);
      expect((await post(`${base}/assemblies`, { sourceIds: [] })).status).toBe(400);
    });
    expect(rec.queries).toEqual([]);
  });
});

describe("POST /reads of an assembly", () => {
  it("queues a read naming the assembly, and audits it by the assembly", async () => {
    rec = createSupabaseRecorder({ tables: { document_assemblies: [{ id: ASSEMBLY }], document_reads: (q) => (q.write ? [{ id: READ }] : []) } });
    await withServer(async (base) => {
      expect((await post(`${base}/reads`, { assemblyId: ASSEMBLY, profile: "shipping_document" })).status).toBe(201);
    });
    expect(rec.writtenRows("document_reads")[0]).toMatchObject({ assembly_id: ASSEMBLY });
    expect(auditActions()).toEqual([expect.objectContaining({
      action: "document.read_requested", meta: { assemblyId: ASSEMBLY, profile: "shipping_document" },
    })]);
  });

  it("answers 400 to a read naming both a source and an assembly", async () => {
    rec = createSupabaseRecorder();
    await withServer(async (base) => {
      expect((await post(`${base}/reads`, { sourceId: SOURCE, assemblyId: ASSEMBLY, profile: "shipping_document" })).status).toBe(400);
    });
    expect(rec.queries).toEqual([]);
  });
});

describe("GET /reads/:id", () => {
  it("answers 404 for a read outside the org", async () => {
    rec = createSupabaseRecorder({ tables: { document_reads: [] } });
    await withServer(async (base) => {
      expect((await fetch(`${base}/reads/${READ}`)).status).toBe(404);
    });
    expectOrgScoped(rec, ORG);
  });
});

describe("POST /reads/:id/reviews", () => {
  const batch = {
    consumer: "hazmat_calculator",
    reviews: [
      { path: "shipper.name", action: "corrected", oldValue: "ACME", newValue: "ACME Corp" },
      { path: "carrier", action: "confirmed", oldValue: null, newValue: null },
    ],
  };
  const withRead = (status: string) =>
    createSupabaseRecorder({ tables: { document_reads: [{ id: READ, status, result: { shipper: { name: "ACME" }, carrier: null } }] } });

  it("answers 201, and audits the batch with a count per action", async () => {
    rec = withRead("done");
    await withServer(async (base) => {
      const res = await post(`${base}/reads/${READ}/reviews`, batch);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ recorded: 2 });
    });
    expect(auditActions()).toEqual([expect.objectContaining({ action: "document.read_reviewed", meta: { consumer: "hazmat_calculator", corrected: 1, confirmed: 1 } })]);
    expectOrgScoped(rec, ORG);
  });

  it("answers 409 for a read not yet finished and 400 for a verdict that disagrees with the read", async () => {
    rec = withRead("reading");
    await withServer(async (base) => {
      expect((await post(`${base}/reads/${READ}/reviews`, batch)).status).toBe(409);
    });
    rec = withRead("done");
    await withServer(async (base) => {
      const res = await post(`${base}/reads/${READ}/reviews`, { ...batch, reviews: [{ path: "shipper.name", action: "confirmed", oldValue: "X", newValue: "X" }] });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "invalid_review" } });
    });
    expect(auditActions()).toEqual([]);
  });
});
