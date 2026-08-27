import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { ensureApplicationPdf } from "./file.js";

/**
 * Filing the rendered application (A6, D-APP9).
 *
 * The PDF is a DERIVATIVE. Everything asserted here follows from that: it can be produced again, so
 * a failure costs nothing irreplaceable; it must not be produced twice, so the §391.51(b)(1) citation
 * is the idempotency key; and the whole thing is org-scoped because the service role bypasses RLS.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const APP_ID = "11111111-2222-4333-8444-555555555555";

const APPLICATION_ROW = {
  id: APP_ID,
  org_id: ORG,
  driver_id: DRIVER,
  invitation_id: "inv-1",
  payload: {
    first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
    email: "s@example.test", phone: "555-0111", addresses: [],
    cdl_number: "PA334554", cdl_state: "PA", cdl_expires_at: "2029-01-01",
    accidents: [], declares_no_accidents: true,
    violations: [], declares_no_violations: true,
    licence_ever_denied: false,
    employers: [], declares_no_employment: true,
    certified: true, signed_name: "Susan Godfrey",
  },
  signed_name: "Susan Godfrey",
  certified_at: "2026-08-21T18:00:00Z",
  applicant_ip: "203.0.113.9",
};

const seed = (over: {
  application?: Record<string, unknown> | null;
  record?: Record<string, unknown> | null;
  document?: Record<string, unknown> | null;
} = {}) =>
  createSupabaseRecorder({
    tables: {
      driver_applications: over.application === null ? [] : [over.application ?? APPLICATION_ROW],
      organizations: [{ name: "Silvicom Inc", legal_address: null }],
      driver_authorizations: [],
      esign_consents: [],
      qualification_records: over.record === undefined ? [{ document_id: null }] : over.record ? [over.record] : [],
      documents: over.document ? [over.document] : [],
    },
    rpc: { attach_application_document: true },
  });

describe("filing the application PDF", () => {
  it("renders, uploads, files a documents row and cites it from the qualification record", async () => {
    const rec = seed();
    const filed = await ensureApplicationPdf(rec.client, ORG, APP_ID);

    expect(filed?.rendered).toBe(true);
    // The bytes never pass through a request body: they are generated here and uploaded straight to
    // the documents bucket, which is where every other filed PDF in the product lives.
    const uploads = rec.storageCalls().filter((c) => c.fn === "upload");
    expect(uploads).toHaveLength(1);
    const [row] = rec.writtenRows("documents") as Array<Record<string, unknown>>;
    expect(row?.kind).toBe("employment_application");
    expect(row?.subject_id).toBe(DRIVER);
    expect(String(row?.sha256)).toMatch(/^[0-9a-f]{64}$/);
    // Nobody in the carrier uploaded it — the applicant's own submission produced it.
    expect(row?.uploaded_by).toBeNull();
    // And the §391.51(b)(1) record is pointed at it, through the one narrow RPC that can.
    const attach = rec.rpcs().find((r) => r.fn === "attach_application_document");
    expect((attach?.args as Record<string, unknown>)?.p_document).toBe(row?.id);
  });

  /** Idempotent: the citation is the index, so a second call hands back the document already filed. */
  it("does not render a second copy when one is already cited", async () => {
    const rec = seed({
      record: { document_id: "doc-1" },
      document: { id: "doc-1", storage_path: `${ORG}/driver/${DRIVER}/doc-1.pdf` },
    });
    const filed = await ensureApplicationPdf(rec.client, ORG, APP_ID);

    expect(filed).toEqual({ documentId: "doc-1", storagePath: `${ORG}/driver/${DRIVER}/doc-1.pdf`, rendered: false });
    expect(rec.storageCalls().filter((c) => c.fn === "upload")).toHaveLength(0);
    expect(rec.writtenRows("documents")).toHaveLength(0);
  });

  /**
   * A citation pointing at a document that is gone is not a reason to refuse to produce one — the
   * evidence is intact and the PDF is regenerable, which is the whole point of a derivative.
   */
  it("renders again when the cited document has vanished", async () => {
    const rec = seed({ record: { document_id: "doc-gone" }, document: null });
    const filed = await ensureApplicationPdf(rec.client, ORG, APP_ID);
    expect(filed?.rendered).toBe(true);
  });

  it("answers null for an application that is not this org's", async () => {
    const rec = seed({ application: null });
    expect(await ensureApplicationPdf(rec.client, ORG, APP_ID)).toBeNull();
    expect(rec.storageCalls().filter((c) => c.fn === "upload")).toHaveLength(0);
  });

  it("org-scopes every read and write, because the service role bypasses RLS", async () => {
    const rec = seed();
    await ensureApplicationPdf(rec.client, ORG, APP_ID);
    expectOrgScoped(rec, ORG, {
      // Filtered by primary key, which IS the tenant id — the `dqAlertScheduler.test.ts` exemption.
      exempt: ["organizations"],
    });
  });
});

/**
 * Finding the drawn mark (A8b, D-APP8).
 *
 * The mark files as kind `other`, which is what a promoted `ssn_card` files as too — so `documents`
 * alone cannot say which row is the signature. The staged `application_captures` row is the index,
 * and A8a's identity property is what turns it into an answer: `documents.id` IS the capture id.
 */
describe("the drawn signature mark", () => {
  const CAPTURE = "aaaaaaaa-1111-4111-8111-111111111111";
  const PNG = Buffer.from("iVBORw0KGgo=", "base64");

  const withMark = (over: {
    captures?: Record<string, unknown>[];
    documents?: Record<string, unknown>[];
    download?: (path: string) => unknown;
  }) =>
    createSupabaseRecorder({
      tables: {
        driver_applications: [APPLICATION_ROW],
        organizations: [{ name: "Silvicom Inc", legal_address: null }],
        driver_authorizations: [],
        esign_consents: [],
        qualification_records: [{ document_id: null }],
        application_captures: over.captures ?? [],
        documents: over.documents ?? [],
      },
      rpc: { attach_application_document: true },
      storage: {
        upload: () => ({ error: null }),
        download: (path: string) =>
          over.download ? over.download(path) : { data: new Blob([PNG]), error: null },
      },
    });

  it("reads the promoted copy out of the evidence bucket, found by the capture's own id", async () => {
    const rec = withMark({
      captures: [{ id: CAPTURE, storage_path: `${ORG}/inv-1/${CAPTURE}.png` }],
      documents: [{ storage_path: `${ORG}/driver/${DRIVER}/${CAPTURE}.png` }],
    });
    await ensureApplicationPdf(rec.client, ORG, APP_ID);
    const downloads = rec.storageCalls().filter((c) => c.fn === "download");
    expect(downloads).toHaveLength(1);
    // `compliance-docs`, not the staging bucket: the promoted copy is permanent and on the same side
    // of the evidence line as the document being drawn.
    expect(downloads[0]?.bucket).toBe("compliance-docs");
    expect(downloads[0]?.args[0]).toBe(`${ORG}/driver/${DRIVER}/${CAPTURE}.png`);
    // The two new reads carry their own tenant filter, like every other query on this path.
    // `organizations` is filtered by primary key, which IS the tenant id (the same exemption above).
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("falls back to the staged object when nothing has been promoted yet", async () => {
    const rec = withMark({ captures: [{ id: CAPTURE, storage_path: `${ORG}/inv-1/${CAPTURE}.png` }] });
    await ensureApplicationPdf(rec.client, ORG, APP_ID);
    const downloads = rec.storageCalls().filter((c) => c.fn === "download");
    expect(downloads[0]?.bucket).toBe("application-captures");
  });

  it("downloads nothing at all when this session drew no mark — the normal case", async () => {
    const rec = withMark({});
    const filed = await ensureApplicationPdf(rec.client, ORG, APP_ID);
    expect(filed?.rendered).toBe(true);
    expect(rec.storageCalls().filter((c) => c.fn === "download")).toEqual([]);
  });

  /** An ornament must never cost the §391.51(b)(1) record it decorates. */
  it("still files the document when the mark cannot be read", async () => {
    const rec = withMark({
      captures: [{ id: CAPTURE, storage_path: `${ORG}/inv-1/${CAPTURE}.png` }],
      download: () => { throw new Error("storage is down"); },
    });
    const filed = await ensureApplicationPdf(rec.client, ORG, APP_ID);
    expect(filed?.rendered).toBe(true);
  });
});
