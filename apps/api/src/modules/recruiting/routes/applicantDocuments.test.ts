import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The applicant record's Documents section, through its HTTP door (HIRING-WORKFLOW-AUDIT §9 P9).
 *
 * The fixture holds another org's paper on the same driver id, so a query that forgot its org filter
 * would list a stranger's passport; `expectOrgScoped` checks every query carried the filter itself.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INVITE = "10000000-0000-4000-8000-000000000001";
const DOC_ID = "20000000-0000-4000-8000-000000000002";
const SHA = "a1".repeat(32);

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = {
  recruiter: ctx("recruiter"), admin: ctx("admin"), auditor: ctx("auditor"), dispatcher: ctx("dispatcher"),
};

const capture = (id: string, slot: string, over: Record<string, unknown> = {}) => ({
  id, org_id: ORG, invitation_id: INVITE, driver_id: DRIVER, slot, storage_path: `${ORG}/${INVITE}/${id}`,
  content_type: "image/webp", captured_at: "2026-11-01T10:00:00Z", promoted_document_id: null, ...over,
});
const doc = (id: string, kind: string, over: Record<string, unknown> = {}) => ({
  id, org_id: ORG, subject_type: "driver", subject_id: DRIVER, kind, page: 1, variant: "original",
  content_type: "image/jpeg", storage_path: `${ORG}/driver/${DRIVER}/${id}.jpg`, created_at: "2026-10-30T10:00:00Z",
  uploaded_by: null, ...over,
});

const seed = (): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      drivers: postgrestFixture([{ id: DRIVER, org_id: ORG }]),
      application_captures: postgrestFixture([
        capture("cap-ssn", "ssn_card"),
        capture("cap-tc", "training_certificate", { content_type: "application/pdf", captured_at: "2026-11-01T11:00:00Z" }),
        // Filed at Part 1 — listed from `documents`, not twice.
        capture("doc-cdl", "cdl_front", { promoted_document_id: "doc-cdl" }),
        // A drawn mark files as `other` under its capture's id: not a document anybody sent.
        capture("doc-mark", "signature_mark", { promoted_document_id: "doc-mark" }),
        capture("cap-selfie", "selfie"),
      ]),
      documents: postgrestFixture([
        doc("doc-cdl", "cdl"),
        doc("doc-mark", "other", { content_type: "image/png" }),
        doc("doc-pass", "passport", { uploaded_by: "u-office", created_at: "2026-10-31T10:00:00Z" }),
        doc("doc-mvr", "mvr"),
        doc("doc-stranger", "passport", { org_id: OTHER }),
      ]),
      audit_logs: [],
    },
    rpc: { org_member_directory: [{ user_id: "u-office", email: "dana@x.test", full_name: "Dana Office" }] },
    storage: {
      createSignedUrls: (paths: string[]) => ({
        data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${path}` })),
        error: null,
      }),
      createSignedUploadUrl: (path: string) => ({ data: { signedUrl: `https://upload.test/${path}`, token: "tok", path }, error: null }),
    },
  });

let server: Server;
let baseUrl: string;
const call = (method: string, token: string, body?: unknown) =>
  fetch(`${baseUrl}/api/recruitment/applicants/${DRIVER}/documents`, {
    method,
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

type Row = { id: string; slot: string | null; source: string; addedBy: string | null; staged: boolean; url: string | null; imageWithheld: boolean };

describe("the applicant's documents on the record (§9 P9)", () => {
  it("lists the link's papers and the filed ones, badged by who sent them, org-scoped", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("GET", "admin");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { documents } = (await res.json()) as { documents: Row[] };
    expect(documents.map((d) => [d.id, d.slot, d.source, d.addedBy, d.staged])).toEqual([
      ["cap-tc", "training_certificate", "applicant", null, true],
      ["cap-ssn", "ssn_card", "applicant", null, true],
      ["doc-pass", "passport", "office", "Dana Office", false],
      ["doc-cdl", "cdl_front", "applicant", null, false],
    ]);
    // The admin holds both restricted halves, so the SSN card's picture is signed for them.
    expect(documents.find((d) => d.id === "cap-ssn")).toMatchObject({ imageWithheld: false, url: `https://signed.test/${ORG}/${INVITE}/cap-ssn` });
    expectOrgScoped(rec, ORG);
  });

  it("shows a recruiter the SSN card and the passport rows, and never signs their pictures (Q-WF4)", async () => {
    const rec = seed();
    holder.client = rec.client;
    const { documents } = (await (await call("GET", "recruiter")).json()) as { documents: Row[] };
    for (const id of ["cap-ssn", "doc-pass"]) {
      expect(documents.find((d) => d.id === id), id).toMatchObject({ imageWithheld: true, url: null });
    }
    expect(documents.find((d) => d.id === "cap-tc")).toMatchObject({ imageWithheld: false });
    // Enforced where the URL is minted: no path of either paper was ever handed to Storage to sign.
    const signedPaths = rec.storageCalls().filter((c) => c.fn === "createSignedUrls").flatMap((c) => c.args[0] as string[]);
    expect(signedPaths.some((p) => p.includes("cap-ssn") || p.includes("doc-pass"))).toBe(false);
    expect(signedPaths.length).toBeGreaterThan(0);
  });

  it("is the recruitment section's — an auditor reads it, a dispatcher does not", async () => {
    holder.client = seed().client;
    expect((await call("GET", "auditor")).status).toBe(200);
    expect((await call("GET", "dispatcher")).status).toBe(403);
  });
});

describe("the office's upload (§9 P9)", () => {
  const BODY = { document_id: DOC_ID, slot: "twic", content_type: "application/pdf", sha256: SHA, bytes: 1200 };

  it("lets a recruiter file a TWIC for the applicant — kind composed from the slot, org and driver from the record", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("POST", "recruiter", BODY);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ documentId: DOC_ID, uploadUrl: expect.stringContaining("https://upload.test/") });
    const write = rec.writes().find((w) => w.table === "documents")?.write;
    expect(write?.payload).toMatchObject({
      id: DOC_ID, org_id: ORG, subject_type: "driver", subject_id: DRIVER, kind: "twic", page: 1,
      content_type: "application/pdf", uploaded_by: "u-recruiter",
    });
    const audit = rec.writes().find((w) => w.table === "audit_logs")?.write;
    expect(audit?.payload).toMatchObject({ action: "compliance.document_registered" });
    expectOrgScoped(rec, ORG);
  });

  it("files a licence's back as page two of the licence, as the applicant's own does", async () => {
    const rec = seed();
    holder.client = rec.client;
    await call("POST", "admin", { ...BODY, slot: "cdl_back", content_type: "image/jpeg" });
    expect(rec.writes().find((w) => w.table === "documents")?.write?.payload).toMatchObject({ kind: "cdl", page: 2 });
  });

  it("refuses a kind named instead of a slot, and anything off the applicant's list", async () => {
    holder.client = seed().client;
    expect((await call("POST", "recruiter", { ...BODY, slot: "drug_test" })).status).toBe(400);
    expect((await call("POST", "recruiter", { ...BODY, slot: undefined, kind: "drug_test" })).status).toBe(400);
  });

  it("refuses a driver outside the org, and a reader who may not write", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: postgrestFixture([{ id: DRIVER, org_id: OTHER }]) } });
    holder.client = rec.client;
    expect((await call("POST", "recruiter", BODY)).status).toBe(404);
    expect(rec.writes()).toEqual([]);
    holder.client = seed().client;
    expect((await call("POST", "auditor", BODY)).status).toBe(403);
  });
});
