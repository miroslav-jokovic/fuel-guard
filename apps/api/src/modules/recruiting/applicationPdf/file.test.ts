import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { ensureApplicationPdf } from "./file.js";
import { driverPlacements } from "@silvicom/shared";
import { PDFDocument } from "pdf-lib";

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

/**
 * A packet signed through, as `application_packet_marks` holds one.
 *
 * ⚠ Built from `driverPlacements()` rather than hand-listed — a fixture naming its own stops would
 * keep passing after the inventory changed, and the inventory is a measurement of somebody else's
 * paper that has been corrected twice.
 */
const signedPacket = () =>
  driverPlacements().map((pl) => ({
    placement_id: pl.id,
    signed_name: pl.mark === "initials" ? "SG" : "Susan Godfrey",
    signed_at: "2026-08-21T18:00:00Z",
  }));

const seed = (over: {
  application?: Record<string, unknown> | null;
  record?: Record<string, unknown> | null;
  document?: Record<string, unknown> | null;
  marks?: Array<Record<string, unknown>>;
} = {}) =>
  createSupabaseRecorder({
    tables: {
      driver_applications: over.application === null ? [] : [over.application ?? APPLICATION_ROW],
      organizations: [{ name: "Silvicom Inc", legal_address: null }],
      driver_authorizations: [],
      esign_consents: [],
      qualification_records: over.record === undefined ? [{ document_id: null }] : over.record ? [over.record] : [],
      documents: over.document ? [over.document] : [],
      // ⚠ Empty by default, which is an application from BEFORE the ceremony — the case that keeps
      // rendering `render.ts`'s summary (D-PKT5). The tests about the packet pass their own.
      application_packet_marks: over.marks ?? [],
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

/**
 * The evidence the query has to ask for (X7).
 *
 * ⚠ This one asserts the QUERY and not the document, on purpose. `record_driver_release` has written
 * `method`, `accepted_ip` and `accepted_user_agent` since 0215/0228, and this file selected five
 * columns of the eight — so the renderer could not print what the database held however well it was
 * written, and no test of the renderer could ever notice. The defect lived in the column list, so the
 * pin is on the column list.
 */
describe("what the filed document is allowed to know", () => {
  const selectFor = (rec: ReturnType<typeof seed>, table: string): string =>
    String(
      rec
        .forTable(table)
        .flatMap((q) => q.ops)
        .find((op) => op.method === "select")?.args[0] ?? "",
    );

  it("asks for every fact stored about a signature, not five of the eight", async () => {
    const rec = seed();
    await ensureApplicationPdf(rec.client, ORG, APP_ID);

    const select = selectFor(rec, "driver_authorizations");
    for (const column of [
      "purpose", "disclosure_version", "disclosure_text", "intent_statement",
      "signed_name", "accepted_at", "method", "accepted_ip", "accepted_user_agent",
    ]) {
      expect(select).toContain(column);
    }
  });

  it("asks how the electronic-records consent was given, as well as that it was", async () => {
    const rec = seed();
    await ensureApplicationPdf(rec.client, ORG, APP_ID);

    const select = selectFor(rec, "esign_consents");
    expect(select).toContain("applicant_ip");
    expect(select).toContain("applicant_user_agent");
  });

  it("asks for the browser the certification itself was made in", async () => {
    const rec = seed();
    await ensureApplicationPdf(rec.client, ORG, APP_ID);

    expect(selectFor(rec, "driver_applications")).toContain("applicant_user_agent");
  });
});


/**
 * ⚠ **Which document gets filed, and what decides it** (D-PKT1, D-PKT5, wired 2026-09-14).
 *
 * The owner asked for the carrier's own form. `render.ts`'s §391.21 summary is regulation-correct
 * and is not that document, so a submission that came through the ceremony now files the packet.
 * What it must NOT do is draw the packet for an application that has no marks: that produces the
 * carrier's 31 pages with every signature line blank, which looks like a form nobody signed and is
 * worse than the summary. `driver_applications` is append-only, so those applications can never gain
 * marks and must keep rendering the way they always did.
 */
describe("which document an application files", () => {
  const bytesOf = async (rec: ReturnType<typeof seed>): Promise<Buffer> => {
    await ensureApplicationPdf(rec.client, ORG, APP_ID);
    const upload = rec.storageCalls().find((c) => c.fn === "upload")!;
    return upload.args[1] as Buffer;
  };

  /**
   * ⚠ Thirty-one pages is the carrier's packet; the summary is a handful. Counted by LOADING the
   * document rather than by grepping for `/Type /Page`: pdf-lib writes object streams, so the
   * pattern finds nothing in the packet and everything in PDFKit's uncompressed summary — which
   * makes the packet look like a zero-page document and the assertion fail for the wrong reason.
   */
  const pageCount = async (pdf: Buffer): Promise<number> =>
    (await PDFDocument.load(pdf, { ignoreEncryption: true })).getPageCount();

  it("files the carrier's own packet when the application was signed through", async () => {
    const pdf = await bytesOf(seed({ marks: signedPacket() }));
    expect(await pageCount(pdf)).toBeGreaterThanOrEqual(31);
    // The carrier's own letterhead is on it, because nothing redrew their pages.
    expect(pdf.length).toBeGreaterThan(50_000);
  });

  it("files the §391.21 summary when the application carries no marks", async () => {
    const pdf = await bytesOf(seed({ marks: [] }));
    expect(await pageCount(pdf)).toBeLessThan(31);
  });

  /**
   * ⚠ The two really are different documents. Asserted by comparing them rather than by trusting the
   * page counts, because a switch that silently rendered the same thing both ways would satisfy two
   * plausible-looking count assertions.
   */
  it("produces genuinely different documents for the two paths", async () => {
    const signed = await bytesOf(seed({ marks: signedPacket() }));
    const summary = await bytesOf(seed({ marks: [] }));
    expect(signed.equals(summary)).toBe(false);
    expect(signed.length).toBeGreaterThan(summary.length);
  });

  /** ⚠ Org-scoped like every other read here: the service role bypasses RLS. */
  it("scopes the packet-mark read to the org and the invitation", async () => {
    const rec = seed({ marks: signedPacket() });
    await ensureApplicationPdf(rec.client, ORG, APP_ID);
    const q = rec.forTable("application_packet_marks")[0]!;
    expect(q.filters()).toContainEqual({ col: "org_id", val: ORG });
    expect(q.filters()).toContainEqual({ col: "invitation_id", val: "inv-1" });
  });

  /**
   * ⚠ An application with no invitation at all — a path `invitation_id` is nullable for — must not
   * query for marks and must not throw. It files the summary.
   */
  it("files the summary for an application with no invitation, without asking for marks", async () => {
    const rec = seed({ application: { ...APPLICATION_ROW, invitation_id: null }, marks: signedPacket() });
    const filed = await ensureApplicationPdf(rec.client, ORG, APP_ID);
    expect(filed?.rendered).toBe(true);
    expect(rec.forTable("application_packet_marks")).toHaveLength(0);
  });
});
