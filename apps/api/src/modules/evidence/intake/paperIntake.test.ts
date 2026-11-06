import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import { PDFDocument as LibDocument } from "pdf-lib";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { pdfPageTexts } from "../../../testing/pdfText.js";
import { renderCoverSheets } from "../coverSheetPdf.js";
import { listBatch, markQueued, PAPER_INTAKE_BUCKET, registerStack, splitStack } from "./paperIntake.js";

/**
 * The split (DRIVER-PAPER-INTAKE-PLAN PI2), end to end on a real stack — cover sheets rendered by PI1,
 * papers, a blank back, a sheet for a driver who is not on this roster — with the database and Storage
 * faked by the recorder, so every write and its org scope is asserted.
 */
const ORG = "org-1";
const STACK = "5a5a5a5a-1111-4222-8333-444444444444";
const A = "3f2b9c1e-8d4a-4b6f-9e21-5c7a0d1e2f34";
const B = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const GONE = "77777777-6666-4555-8444-333333333333"; // a driver a merge folded away
const sheet = (id: string, name: string) => ({ id, fullName: name, employeeId: null, hireDate: null });

async function papers(labels: string[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
  for (const l of labels) {
    doc.addPage();
    if (l) doc.fontSize(14).text(l, 72, 72);
  }
  doc.end();
  return done;
}

/** sheet A · A-1 · (blank) · A-2 · sheet B · B-1 · sheet GONE · G-1 — eight pages. */
async function stack(): Promise<Buffer> {
  const sheets = await LibDocument.load(await renderCoverSheets([sheet(A, "Ann"), sheet(B, "Bo"), sheet(GONE, "Gone")], "2026-11-06"));
  const paper = await LibDocument.load(await papers(["A application", "", "A road test", "B medical card", "G mvr"]));
  const out = await LibDocument.create();
  const [sA, sB, sG] = await out.copyPages(sheets, [0, 1, 2]);
  const [a1, blank, a2, b1, g1] = await out.copyPages(paper, [0, 1, 2, 3, 4]);
  for (const p of [sA!, a1!, blank!, a2!, sB!, b1!, sG!, g1!]) out.addPage(p);
  return Buffer.from(await out.save());
}

function recorderFor(bytes: Buffer, status = "queued") {
  const uploads: Array<{ path: string; bytes: Buffer }> = [];
  const rec = createSupabaseRecorder({
    tables: {
      paper_intake_stacks: [{ id: STACK, status, sha256: createHash("sha256").update(bytes).digest("hex") }],
      drivers: [{ id: A, full_name: "Ann" }, { id: B, full_name: "Bo" }],
    },
    storage: {
      download: async () => ({ data: new Blob([new Uint8Array(bytes)]), error: null }),
      upload: async (path: string, body: Buffer) => {
        uploads.push({ path, bytes: Buffer.from(body) });
        return { data: { path }, error: null };
      },
    },
  });
  return { rec, uploads };
}

const writesTo = (rec: ReturnType<typeof createSupabaseRecorder>, table: string, method: string) =>
  rec.forTable(table).filter((q) => q.write?.method === method).map((q) => q.write!.payload);

describe("splitStack (PI2)", () => {
  it("cuts the stack at its cover sheets, drops the blank back, and gives an unknown sheet's pages to nobody", async () => {
    const bytes = await stack();
    const { rec, uploads } = recorderFor(bytes);
    const outcome = await splitStack(rec.client, ORG, STACK, () => new Date("2026-11-06T18:00:00Z"));
    expect(outcome).toEqual({ outcome: "split", pageCount: 8, coverSheets: 2, blankPages: 1, parts: 3, unknownSheets: 1 });

    const [rows] = writesTo(rec, "paper_intake_parts", "insert") as Array<Array<Record<string, unknown>>>;
    expect(rows!.map((r) => [r.driver_id, r.basis, r.stack_pages])).toEqual([
      [A, "cover_sheet", [2, 4]],
      [B, "cover_sheet", [6]],
      [null, "none", [8]],
    ]);
    // Each piece is its own PDF holding exactly its pages, stored under the stack's own key.
    expect(uploads.map((u) => u.path)).toEqual([`${ORG}/${STACK}/part-000.pdf`, `${ORG}/${STACK}/part-001.pdf`, `${ORG}/${STACK}/part-002.pdf`]);
    expect(await pdfPageTexts(uploads[0]!.bytes)).toEqual([expect.stringContaining("A application"), expect.stringContaining("A road test")]);
    expect(rows![0]!.sha256).toBe(createHash("sha256").update(uploads[0]!.bytes).digest("hex"));
    expect(rec.storageCalls().every((c) => c.bucket === PAPER_INTAKE_BUCKET)).toBe(true);

    // A retry replaces the set rather than adding to it: delete before insert, both on this stack.
    const writes = rec.forTable("paper_intake_parts").filter((q) => q.write);
    expect(writes.map((q) => q.write!.method)).toEqual(["delete", "insert"]);
    expect(writes[0]!.filters()).toEqual(expect.arrayContaining([{ col: "stack_id", val: STACK }, { col: "org_id", val: ORG }]));
    const finished = writesTo(rec, "paper_intake_stacks", "update").at(-1) as Record<string, unknown>;
    expect(finished).toMatchObject({ status: "split", page_count: 8, cover_sheet_count: 2, blank_page_count: 1, split_at: "2026-11-06T18:00:00.000Z" });
    expectOrgScoped(rec, ORG);
  }, 120_000);

  it("fails a stack whose bytes are not the ones registered, and reads nothing from them", async () => {
    // The registered hash is of different bytes.
    const tampered = createSupabaseRecorder({
      tables: { paper_intake_stacks: [{ id: STACK, status: "queued", sha256: "0".repeat(64) }] },
      storage: { download: async () => ({ data: new Blob([new Uint8Array(await stack())]), error: null }) },
    });
    expect(await splitStack(tampered.client, ORG, STACK)).toEqual({ outcome: "failed", failure: "bytes_changed" });
    expect(writesTo(tampered, "paper_intake_parts", "insert")).toEqual([]);
  }, 60_000);

  it("fails a stack that never reached Storage, and one that is not a PDF", async () => {
    const missing = createSupabaseRecorder({
      tables: { paper_intake_stacks: [{ id: STACK, status: "queued", sha256: "0".repeat(64) }] },
      storage: { download: async () => ({ data: null, error: { message: "Object not found" } }) },
    });
    expect(await splitStack(missing.client, ORG, STACK)).toEqual({ outcome: "failed", failure: "not_uploaded" });

    const junk = Buffer.from("not a pdf at all");
    const { rec } = recorderFor(junk);
    expect(await splitStack(rec.client, ORG, STACK)).toEqual({ outcome: "failed", failure: "decode_failed" });
  });

  it("leaves a stack that is already split exactly as it is", async () => {
    const { rec } = recorderFor(Buffer.from("x"), "split");
    expect(await splitStack(rec.client, ORG, STACK)).toEqual({ outcome: "skipped", reason: "already split" });
    expect(rec.storageCalls()).toEqual([]);
  });
});

describe("registerStack / markQueued (PI2)", () => {
  const req = { batchId: "b0b0b0b0-1111-4222-8333-444444444444", fileName: "stack.pdf", sha256: "a".repeat(64), bytes: 1000 };

  it("registers a new file and signs an upload to the stack's own key", async () => {
    const rec = createSupabaseRecorder({ storage: { createSignedUploadUrl: async () => ({ data: { signedUrl: "https://signed/put" }, error: null }) } });
    const out = await registerStack(rec.client, ORG, "u-1", req, () => STACK);
    expect(out).toEqual({ stackId: STACK, uploadUrl: "https://signed/put", duplicate: false });
    expect(rec.storageCalls()[0]).toMatchObject({ bucket: PAPER_INTAKE_BUCKET, fn: "createSignedUploadUrl", args: [`${ORG}/${STACK}/stack.pdf`, { upsert: true }] });
    expect(writesTo(rec, "paper_intake_stacks", "insert")[0]).toMatchObject({ id: STACK, org_id: ORG, sha256: req.sha256, uploaded_by: "u-1" });
    expectOrgScoped(rec, ORG);
  });

  it("answers the same bytes, already split, with the first stack and no upload", async () => {
    const rec = createSupabaseRecorder({ tables: { paper_intake_stacks: [{ id: STACK, status: "split" }] } });
    expect(await registerStack(rec.client, ORG, "u-1", req)).toEqual({ stackId: STACK, uploadUrl: null, duplicate: true });
  });

  it("offers a failed stack the upload again under its own id, as its failure text promises", async () => {
    const rec = createSupabaseRecorder({
      tables: { paper_intake_stacks: [{ id: STACK, status: "failed" }] },
      storage: { createSignedUploadUrl: async () => ({ data: { signedUrl: "https://signed/again" }, error: null }) },
    });
    expect(await registerStack(rec.client, ORG, "u-1", req)).toEqual({ stackId: STACK, uploadUrl: "https://signed/again", duplicate: false });
    expect(writesTo(rec, "paper_intake_stacks", "update")[0]).toMatchObject({ status: "uploading", failure_code: null });
  });

  it("queues an uploaded stack once, and says so for one already on its way", async () => {
    const waiting = createSupabaseRecorder({ tables: { paper_intake_stacks: [{ status: "uploading" }] } });
    expect(await markQueued(waiting.client, ORG, STACK)).toBe("queued");
    const queued = createSupabaseRecorder({ tables: { paper_intake_stacks: [{ status: "splitting" }] } });
    expect(await markQueued(queued.client, ORG, STACK)).toBe("already");
    expect(writesTo(queued, "paper_intake_stacks", "update")).toEqual([]);
  });
});

describe("listBatch (PI2)", () => {
  it("names each piece's driver from this roster, and none for a piece nobody owns", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        paper_intake_stacks: [{ id: STACK, batch_id: "b", file_name: "stack.pdf", status: "split", failure_code: null, page_count: 8, cover_sheet_count: 2, blank_page_count: 1, created_at: "2026-11-06T18:00:00Z" }],
        paper_intake_parts: [
          { stack_id: STACK, part_index: 0, driver_id: A, basis: "cover_sheet", stack_pages: [2, 4] },
          { stack_id: STACK, part_index: 1, driver_id: null, basis: "none", stack_pages: [8] },
        ],
        drivers: [{ id: A, full_name: "Ann" }],
      },
    });
    const [s] = await listBatch(rec.client, ORG, "b0b0b0b0-1111-4222-8333-444444444444");
    expect(s!.parts.map((p) => [p.driverName, p.stackPages])).toEqual([["Ann", [2, 4]], [null, [8]]]);
    expectOrgScoped(rec, ORG);
  });
});
