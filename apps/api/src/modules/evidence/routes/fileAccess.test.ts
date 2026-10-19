import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { UserRole } from "@silvicom/shared";
import { closeTestServer } from "../../../testing/httpServer.js";
import { createSupabaseRecorder, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * D-UF5 — a paper belongs to the section of the file it is in. The compliance routes used to answer
 * every paper with `roster`, so a technician could not open the registration of the truck in their bay
 * and a recruiter could. Each refusal here sits beside the same call succeeding for the role whose
 * section it is, so a route that refuses everything — or admits everything — cannot pass.
 *
 * The coarse `anyFileSection` door is middleware and stubbed open here, so what is tested is the
 * per-paper answer the handlers give once the subject is known.
 */

const ORG = "org-1";
const TRUCK = "77777777-7777-4777-8777-777777777777";
const DRIVER = "55555555-5555-4555-8555-555555555555";
const TRUCK_DOC = "d0000003-0000-4000-8000-000000000000";
const DRIVER_DOC = "d0000004-0000-4000-8000-000000000000";
const SHA = "a".repeat(64);

let rec: SupabaseRecorder;
let role: UserRole = "technician";

vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../queue/dispatch.js", () => ({ dispatchJob: async () => ({ ok: true }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u-1", orgId: ORG, role, email: "member@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { complianceRouter } = await import("./compliance.js");

const eqVal = (q: RecordedQuery, col: string) => q.ops.find((o) => o.method === "eq" && o.args[0] === col)?.args[1];
const doc = (id: string, subject_type: string, subject_id: string, kind: string) => ({
  id, org_id: ORG, subject_type, subject_id, kind, content_type: "application/pdf", storage_path: `${ORG}/${subject_type}/${subject_id}/${id}.pdf`,
  captured_at: null, created_at: "2026-10-15T12:00:00Z", variant: "original", sha256: SHA, bytes: 10, page: 1, derived_from: null,
});
const DOCUMENTS = [doc(TRUCK_DOC, "tractor", TRUCK, "registration"), doc(DRIVER_DOC, "driver", DRIVER, "medical_card")];
const ORG_CERTS = [
  { id: "c1", kind: "insurance", subject_type: "organization" },
  { id: "c2", kind: "phmsa_registration", subject_type: "organization" },
];

beforeEach(() => {
  role = "technician";
  rec = createSupabaseRecorder({
    tables: {
      documents: (q) => (q.write ? [] : DOCUMENTS.filter((d) => (eqVal(q, "id") === undefined || d.id === eqVal(q, "id")) && (eqVal(q, "subject_type") === undefined || d.subject_type === eqVal(q, "subject_type")))),
      certifications: (q) => (q.write ? [] : ORG_CERTS.filter((c) => c.subject_type === eqVal(q, "subject_type"))),
      drivers: [{ full_name: "Jovana Petrović" }],
      audit_logs: [],
    },
    rpc: { insert_certification: { id: "new-cert", superseded_id: null } },
    storage: {
      createSignedUploadUrl: (path: string) => ({ data: { signedUrl: `https://storage.test/upload/${path}`, token: "tok" }, error: null }),
      createSignedUrl: (path: string) => ({ data: { signedUrl: `https://storage.test/download/${path}` }, error: null }),
      createSignedUrls: () => ({ data: [], error: null }),
    },
  });
});

type Body = { documents?: Array<{ id: string }>; certifications?: Array<{ kind: string }>; url?: string; error?: { code: string } };

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

const cert = (subjectType: string, subjectId: string, kind: string) => ({
  id: "88888888-8888-4888-8888-888888888888", subjectType, subjectId, kind, expiresAt: "2027-01-01",
});

describe("a paper is answered by its own file's section (D-UF5)", () => {
  it("lets a technician list a truck's papers and refuses them a driver's", async () => {
    const truck = await send("GET", `/documents?subjectType=tractor&subjectId=${TRUCK}`);
    expect(truck.status).toBe(200);
    expect(truck.body.documents?.map((d) => d.id)).toEqual([TRUCK_DOC]);
    expect((await send("GET", `/documents?subjectType=driver&subjectId=${DRIVER}`)).status).toBe(403);
  });

  it("refuses a recruiter a truck's papers and lets them list a driver's", async () => {
    role = "recruiter";
    expect((await send("GET", `/documents?subjectType=tractor&subjectId=${TRUCK}`)).status).toBe(403);
    expect((await send("GET", `/documents?subjectType=driver&subjectId=${DRIVER}`)).status).toBe(200);
  });

  it("lets a technician download a truck's paper and refuses them a driver's, writing no audit line for the refusal", async () => {
    expect((await send("GET", `/documents/${TRUCK_DOC}/download`)).status).toBe(200);
    rec.reset();
    expect((await send("GET", `/documents/${DRIVER_DOC}/download`)).status).toBe(403);
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });

  it("lets a fleet manager record a trailer's registration and keeps a safety manager, who only views equipment, from it", async () => {
    role = "fleet_manager";
    expect((await send("POST", "/certifications", cert("trailer", TRUCK, "registration"))).status).toBe(201);
    role = "safety_manager";
    expect((await send("POST", "/certifications", cert("trailer", TRUCK, "registration"))).status).toBe(403);
    // …while a driver's medical card is still theirs to record.
    expect((await send("POST", "/certifications", cert("driver", DRIVER, "medical_card"))).status).toBe(201);
  });

  it("keeps a technician from filing a scan even on a truck — viewing equipment is not managing it", async () => {
    const register = { id: "66666666-6666-4666-8666-666666666666", subjectType: "tractor", subjectId: TRUCK, kind: "registration", contentType: "application/pdf", sha256: SHA };
    expect((await send("POST", "/documents", register)).status).toBe(403);
    role = "fleet_manager";
    expect((await send("POST", "/documents", register)).status).toBe(201);
  });

  it("narrows the organization's certifications to the ones a reader's sections cover, rather than refusing the list", async () => {
    // A technician sees the fleet's insurance (equipment) and not the PHMSA registration (roster).
    const tech = await send("GET", `/certifications?subjectType=organization&subjectId=${ORG_UUID}`);
    expect(tech.status).toBe(200);
    expect(tech.body.certifications?.map((c) => c.kind)).toEqual(["insurance"]);
    role = "admin";
    const admin = await send("GET", `/certifications?subjectType=organization&subjectId=${ORG_UUID}`);
    expect(admin.body.certifications?.map((c) => c.kind)).toEqual(["insurance", "phmsa_registration"]);
  });
});

const ORG_UUID = "99999999-9999-4999-8999-999999999999";
