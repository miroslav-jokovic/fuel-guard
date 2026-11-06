import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { pdfPageTexts } from "../../../testing/pdfText.js";

/**
 * Filing a reviewed paper (DRIVER-PAPER-INTAKE-PLAN PI5), on a real stack: the paper's pages cut from the
 * ORIGINAL scan and filed on the driver, then the certification or the dated record citing it, then the row.
 * What is refused, and why, is pinned by the same tests.
 */
const ORG = "org-1";
const ITEM = "11111111-2222-4333-8444-555555555555";
const STACK = "5a5a5a5a-1111-4222-8333-444444444444";
const A = "3f2b9c1e-8d4a-4b6f-9e21-5c7a0d1e2f34";
const B = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
vi.mock("../../document-reading/index.js", () => ({
  readOfBytes: async (_a: unknown, _o: unknown, sha: string) => ({ status: "done", sourceId: sha === "1".repeat(64) ? "src-1" : "other", readId: "r", failureCode: null, result: null, evidence: [] }),
}));
const { discardIntakeItem, fileIntakeItem } = await import("./paperIntakeFiling.js");

let stackPdf: Buffer;
beforeAll(async () => {
  const doc = new PDFDocument({ size: "LETTER", autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  for (let p = 1; p <= 8; p++) doc.addPage().fontSize(14).text(`Stack page ${p}`, 72, 72);
  doc.end();
  stackPdf = await done;
});

const item = (over: Record<string, unknown> = {}) => ({
  id: ITEM, batch_id: "batch-1", source_id: "src-1", page_from: 2, page_to: 3, status: "pending",
  proposed_subject_id: A, proposed_kind: "mvr", proposed_issued_on: "2026-01-05", proposed_expires_on: null, ...over,
});
function recorder(opts: { item?: Record<string, unknown>; driverStatus?: string; dupDoc?: boolean } = {}): SupabaseRecorder {
  return createSupabaseRecorder({
    tables: {
      file_intake_items: [item(opts.item)],
      // The recorder does not filter: answer on the id actually asked for, as Postgres would.
      drivers: (q) => ({ data: q.filters().some((f) => f.col === "id" && f.val === A) ? [{ id: A, status: opts.driverStatus ?? "active" }] : [] }),
      paper_intake_stacks: [{ id: STACK }],
      // The piece holds stack pages 4, 5, 7 (6 was a blank back): rows 2–3 are stack pages 5 and 7.
      paper_intake_parts: [{ stack_id: STACK, stack_pages: [4, 5, 7], sha256: "1".repeat(64) }],
      documents: (q) => ({ data: opts.dupDoc && q.filters().some((f) => f.col === "sha256") ? [{ id: "doc-old" }] : [] }),
    },
    rpc: { insert_certification: [{ id: ITEM, superseded_id: null }] },
    storage: {
      download: async () => ({ data: new Blob([new Uint8Array(stackPdf)]), error: null }),
      upload: async (path: string) => ({ data: { path }, error: null }),
    },
  });
}
const writes = (rec: SupabaseRecorder, table: string, method: string) =>
  rec.forTable(table).filter((q) => q.write?.method === method).map((q) => q.write!.payload as Record<string, unknown>);
const user = (role = "safety_manager") => ({ id: "u-1", role: role as never });
const NOW = () => new Date("2026-11-06T20:00:00Z");

describe("fileIntakeItem (PI5)", () => {
  let rec: SupabaseRecorder;
  beforeEach(() => {
    rec = recorder();
  });

  it("files an MVR: the scan cut from the original stack's pages, then the dated record citing it, then the row", async () => {
    const out = await fileIntakeItem(rec.client, ORG, user(), ITEM, { driverId: A, kind: "mvr", date: "2026-01-05", expiresOn: null }, NOW);
    expect(out).toEqual({ status: "filed", documentId: ITEM, certificationId: null, recordId: ITEM });

    const upload = rec.storageCalls().find((c) => c.bucket === "compliance-docs" && c.fn === "upload")!;
    expect(await pdfPageTexts(upload.args[1] as Buffer)).toEqual([expect.stringContaining("Stack page 5"), expect.stringContaining("Stack page 7")]);
    const [doc] = writes(rec, "documents", "insert");
    expect(doc).toMatchObject({ id: ITEM, subject_type: "driver", subject_id: A, kind: "mvr", sha256: createHash("sha256").update(upload.args[1] as Buffer).digest("hex") });
    const [record] = writes(rec, "qualification_records", "insert");
    expect(record).toMatchObject({ id: ITEM, driver_id: A, kind: "mvr", occurred_on: "2026-01-05", document_id: ITEM, detail: { source: "paper_intake", intake_item_id: ITEM, stack_id: STACK, stack_pages: [5, 7] } });
    expect(writes(rec, "file_intake_items", "update").at(-1)).toEqual({
      status: "filed", decided_by: "u-1", decided_at: "2026-11-06T20:00:00.000Z", changed: false, filed_document_id: ITEM, filed_certification_ids: [],
    });
    expectOrgScoped(rec, ORG);
  });

  it("files a medical card as a certification through the supersede chain, and records that the person changed the proposal", async () => {
    const out = await fileIntakeItem(rec.client, ORG, user(), ITEM, { driverId: A, kind: "medical_card", date: "2026-06-01", expiresOn: "2027-06-30" }, NOW);
    expect(out).toMatchObject({ status: "filed", certificationId: ITEM, recordId: null });
    expect(rec.rpcs()).toContainEqual({ fn: "insert_certification", args: expect.objectContaining({ p_id: ITEM, p_kind: "medical_card", p_subject_id: A, p_expires_at: "2027-06-30", p_document_id: ITEM }) });
    expect(writes(rec, "file_intake_items", "update").at(-1)).toMatchObject({ changed: true, filed_certification_ids: [ITEM] });
    expect(writes(rec, "qualification_records", "insert")).toEqual([]);
  });

  it("counts choosing the driver the reader did not propose as a change, though kind and date are as read", async () => {
    const unowned = recorder({ item: { proposed_subject_id: null } });
    await fileIntakeItem(unowned.client, ORG, user(), ITEM, { driverId: A, kind: "mvr", date: "2026-01-05", expiresOn: null }, NOW);
    expect(writes(unowned, "file_intake_items", "update").at(-1)).toMatchObject({ status: "filed", changed: true });
  });

  it("files a hired driver's paper application, and refuses an applicant's — nothing written", async () => {
    expect(await fileIntakeItem(rec.client, ORG, user(), ITEM, { driverId: A, kind: "employment_application", date: "2019-03-01", expiresOn: null }, NOW)).toMatchObject({ status: "filed" });
    const applicant = recorder({ driverStatus: "applicant" });
    expect(await fileIntakeItem(applicant.client, ORG, user(), ITEM, { driverId: A, kind: "employment_application", date: "2026-11-01", expiresOn: null }, NOW)).toMatchObject({ code: "refused" });
    expect(applicant.storageCalls()).toEqual([]);
    expect(writes(applicant, "file_intake_items", "update")).toEqual([]);
  });

  it("refuses a drug test to a role that may not read testing records", async () => {
    expect(await fileIntakeItem(rec.client, ORG, user("fleet_manager"), ITEM, { driverId: A, kind: "drug_test", date: "2026-02-02", expiresOn: null }, NOW)).toMatchObject({ code: "forbidden" });
    expect(rec.storageCalls()).toEqual([]);
    expect(await fileIntakeItem(recorder().client, ORG, user("safety_manager"), ITEM, { driverId: A, kind: "drug_test", date: "2026-02-02", expiresOn: null }, NOW)).toMatchObject({ status: "filed" });
  });

  it("refuses a driver who is not on this roster", async () => {
    expect(await fileIntakeItem(rec.client, ORG, user(), ITEM, { driverId: B, kind: "mvr", date: "2026-01-05", expiresOn: null }, NOW)).toEqual({ code: "refused", error: "That driver is not on this roster." });
  });

  it("marks a paper already in the driver's file a duplicate, and files nothing", async () => {
    const dup = recorder({ dupDoc: true });
    expect(await fileIntakeItem(dup.client, ORG, user(), ITEM, { driverId: A, kind: "mvr", date: "2026-01-05", expiresOn: null }, NOW)).toEqual({ status: "duplicate", documentId: "doc-old" });
    expect(writes(dup, "documents", "insert")).toEqual([]);
    expect(writes(dup, "qualification_records", "insert")).toEqual([]);
    expect(writes(dup, "file_intake_items", "update").at(-1)).toEqual({ status: "duplicate", decided_at: "2026-11-06T20:00:00.000Z" });
  });

  it("will not decide a row twice", async () => {
    const decided = recorder({ item: { status: "filed" } });
    expect(await fileIntakeItem(decided.client, ORG, user(), ITEM, { driverId: A, kind: "mvr", date: "2026-01-05", expiresOn: null }, NOW)).toMatchObject({ code: "already_decided" });
    expect(await discardIntakeItem(decided.client, ORG, "u-1", ITEM, { reason: "other" }, NOW)).toMatchObject({ code: "already_decided" });
  });

  it("sets a page aside, deciding only a pending row", async () => {
    expect(await discardIntakeItem(rec.client, ORG, "u-1", ITEM, { reason: "not_dq_paper" }, NOW)).toEqual({ status: "discarded" });
    const [patch] = writes(rec, "file_intake_items", "update");
    expect(patch).toEqual({ status: "discarded", decided_by: "u-1", decided_at: "2026-11-06T20:00:00.000Z", changed: false });
    const update = rec.forTable("file_intake_items").find((q) => q.write?.method === "update")!;
    expect(update.filters()).toContainEqual({ col: "status", val: "pending" });
  });
});
