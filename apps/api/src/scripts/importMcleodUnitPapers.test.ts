import { describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { testEnv } from "../testing/testEnv.js";
import {
  classifyMcleodPaper,
  fileOne,
  paperDocumentId,
  planCsv,
  planImport,
  readExistingOriginals,
  readOurUnits,
  sniffContentType,
  uuidV5,
  type ManifestPaper,
  type OurUnit,
} from "./importMcleodUnitPapers.js";
import { createHash } from "node:crypto";

const dispatched: Array<{ kind: string; dedupKey?: string | null }> = [];
vi.mock("../queue/dispatch.js", () => ({
  dispatchJob: vi.fn(async (_a: unknown, _e: unknown, kind: string, opts: { dedupKey?: string | null }) => {
    dispatched.push({ kind, dedupKey: opts.dedupKey });
    return { jobId: "j" };
  }),
}));

/**
 * The McLeod unit-papers import. What it can get wrong: file a paper on the wrong unit, file a plate
 * cancellation as a registration, file the same paper twice, or file bytes that are not the bytes McLeod
 * held. Every label below is one the office actually wrote, from the 2026-10-09 sandbox export.
 */
const ORG = "86d6b3ea-4361-4f71-877f-e8373615769b";
const T = (text: string, filename = "805.pdf") => ({ parentType: "T", text, filename });
const E = (text: string, filename = "537673.pdf") => ({ parentType: "E", text, filename });
const kind = (c: ReturnType<typeof classifyMcleodPaper>) => ("kind" in c ? c.kind : `skip:${c.skip}`);

describe("classifyMcleodPaper", () => {
  it("reads the office's labels for an annual inspection, misspellings included", () => {
    for (const label of ["ANNUAL", "NEW ANNUAL", "ANNUAL INSPECTION", "ANNUALS"]) expect(kind(classifyMcleodPaper(E(label)))).toBe("annual_inspection");
  });

  it("does not take a bare INSPECTION for an annual — a roadside report says that too", () => {
    expect(kind(classifyMcleodPaper(T("DOT INSPECTION")))).toBe("skip:neither");
  });

  it("files IRP and the truck's temporary permit as IRP, a plain registration as registration", () => {
    expect(kind(classifyMcleodPaper(T("IRP 2027")))).toBe("irp");
    expect(kind(classifyMcleodPaper(T("TEMP", "834 TEMP.pdf")))).toBe("irp");
    expect(kind(classifyMcleodPaper(T("VP TEMP")))).toBe("irp");
    expect(kind(classifyMcleodPaper(E("REGISTRATION")))).toBe("registration");
    expect(kind(classifyMcleodPaper(E("REGISTARATION")))).toBe("registration");
    expect(kind(classifyMcleodPaper(E("TEMPORARY REGISTRATION")))).toBe("registration");
  });

  it("does not read TEMP alone on a trailer, or TEMP inside a long repair note, as a registration", () => {
    expect(kind(classifyMcleodPaper(E("TEMP", "536682.JPG")))).toBe("skip:neither");
    expect(kind(classifyMcleodPaper(T("12.23.16 TRUCK#268,DRIVER-CHARLES F NEED TO REPLACE DOC OUTLET TEMP SENSOR")))).toBe("skip:neither");
  });

  it("skips a plate cancellation — it is the end of a registration, not one", () => {
    for (const label of ["PLATE CANCELED", "PLATES REVOKED", "CANCEL PLATE REQUEST", "TITLE RELEASED TO STOYAN PLATES REVOKED AT THE END OF MARCH"]) {
      expect(kind(classifyMcleodPaper(E(label)))).toBe("skip:cancelled");
    }
  });

  it("skips our own annual-inspection report, which is already filed here", () => {
    expect(kind(classifyMcleodPaper(T("ANNUAL", "annual-inspection-834-2026-10-08.pdf")))).toBe("skip:ours");
    expect(kind(classifyMcleodPaper(E("annual", "annual-inspection-R534115-2026-03-09.pdf")))).toBe("skip:ours");
  });

  it("skips a paper that says it is both", () => {
    expect(kind(classifyMcleodPaper(T("IRP AND ANNUAL")))).toBe("skip:both");
  });
});

describe("sniffContentType", () => {
  it("reads the bytes, not the name", () => {
    expect(sniffContentType(Buffer.from("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(sniffContentType(Buffer.from("GIF89a"))).toBeNull();
  });
});

describe("paperDocumentId", () => {
  it("is RFC 4122 v5 — the published DNS example", () => {
    expect(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("is the same for the same comment on every run, and differs between comments and orgs", () => {
    const a = paperDocumentId(ORG, { companyId: "TMS", commentId: "C1" });
    expect(paperDocumentId(ORG, { companyId: "TMS", commentId: "C1" })).toBe(a);
    expect(paperDocumentId(ORG, { companyId: "TMS", commentId: "C2" })).not.toBe(a);
    expect(paperDocumentId("00000000-0000-0000-0000-0000000000a1", { companyId: "TMS", commentId: "C1" })).not.toBe(a);
  });
});

const paper = (over: Partial<ManifestPaper> = {}): ManifestPaper => ({
  commentId: "C1", companyId: "TMS", parentType: "T", mcleodUnitId: "805", enteredAt: "2026-10-05T12:00:00.000Z",
  enteredBy: "jane", filename: "805.pdf", commentType: null, text: "IRP 2027", bytes: 1000, sha256: "a".repeat(64), ...over,
});
const truck805: OurUnit = { subjectType: "tractor", id: "v-805", unitNumber: "805", mcleodId: "805" };
const trailer805: OurUnit = { subjectType: "trailer", id: "t-805", unitNumber: "805", mcleodId: "805" };

describe("planImport", () => {
  it("files a paper on the unit McLeod attached it to — a truck's on the truck even when a trailer shares the id", () => {
    const [truckPaper, trailerPaper] = planImport(ORG, [paper(), paper({ commentId: "C2", parentType: "E", text: "REGISTRATION", sha256: "b".repeat(64) })], [truck805, trailer805], []);
    expect(truckPaper!.plan).toMatchObject({ action: "file", unit: { id: "v-805" }, kind: "irp" });
    expect(trailerPaper!.plan).toMatchObject({ action: "file", unit: { id: "t-805" }, kind: "registration" });
  });

  it("skips a paper McLeod attached to anything but a truck or a trailer — a driver's is never a truck's", () => {
    expect(planImport(ORG, [paper({ parentType: "D" })], [truck805], [])[0]!.plan).toMatchObject({ action: "skip", reason: "unknown_parent" });
  });

  it("holds a paper whose file name is another unit's — 688's cab card hanging on truck 687", () => {
    const t687: OurUnit = { subjectType: "tractor", id: "v-687", unitNumber: "687", mcleodId: "687" };
    expect(planImport(ORG, [paper({ mcleodUnitId: "687", filename: "688.pdf" })], [t687], [])[0]!.plan).toMatchObject({ action: "skip", reason: "name_says_other_unit" });
  });

  it("does not hold a name that is the same unit written differently, or no number at all", () => {
    const r: OurUnit = { subjectType: "trailer", id: "t-r", unitNumber: "R537390", mcleodId: "R537390" };
    expect(planImport(ORG, [paper({ parentType: "E", mcleodUnitId: "R537390", filename: "537390 REG.pdf", text: "REGISTRATION" })], [r], [])[0]!.plan.action).toBe("file");
    expect(planImport(ORG, [paper({ filename: "0805 IRP.pdf" })], [truck805], [])[0]!.plan.action).toBe("file");
    expect(planImport(ORG, [paper({ filename: "CCF04262017.pdf" })], [truck805], [])[0]!.plan.action).toBe("file");
  });

  it("skips a paper whose unit we do not hold", () => {
    expect(planImport(ORG, [paper({ mcleodUnitId: "999" })], [truck805], [])[0]!.plan).toMatchObject({ action: "skip", reason: "no_unit" });
  });

  it("matches McLeod's padded id to ours", () => {
    expect(planImport(ORG, [paper({ mcleodUnitId: "805   " })], [truck805], [])[0]!.plan.action).toBe("file");
  });

  it("a re-run finds its own row and files nothing", () => {
    const id = paperDocumentId(ORG, paper());
    expect(planImport(ORG, [paper()], [truck805], [{ id, subjectType: "tractor", subjectId: "v-805", sha256: "a".repeat(64) }])[0]!.plan.action).toBe("already_imported");
  });

  it("the same bytes already on the unit, or twice in McLeod, are filed once", () => {
    const filedByHand = { id: "doc-x", subjectType: "tractor", subjectId: "v-805", sha256: "a".repeat(64) };
    expect(planImport(ORG, [paper()], [truck805], [filedByHand])[0]!.plan).toMatchObject({ action: "skip", reason: "same_paper_on_unit" });
    const twice = planImport(ORG, [paper(), paper({ commentId: "C9" })], [truck805], []);
    expect(twice.map((p) => p.plan.action === "skip" ? p.plan.reason : p.plan.action)).toEqual(["file", "duplicate_in_mcleod"]);
  });

  it("the same bytes on two different units are two papers", () => {
    const other: OurUnit = { subjectType: "tractor", id: "v-806", unitNumber: "806", mcleodId: "806" };
    const out = planImport(ORG, [paper(), paper({ commentId: "C2", mcleodUnitId: "806", filename: "806.pdf" })], [truck805, other], []);
    expect(out.map((p) => p.plan.action)).toEqual(["file", "file"]);
  });

  it("writes one CSV row per paper, quoting what needs it", () => {
    const csv = planCsv(planImport(ORG, [paper({ text: 'IRP, "2027"' })], [truck805], []));
    expect(csv.split("\n")[1]).toContain('"IRP, ""2027"""');
  });
});

describe("the reads and the filing", () => {
  const PDF = Buffer.from("%PDF-1.4\nhello");
  const sha = createHash("sha256").update(PDF).digest("hex");

  it("reads units and papers scoped to the org", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicles: [{ id: "v-805", unit_number: "805", mcleod_tractor_id: "805" }],
        trailers: [{ id: "t-1", unit_number: "R1", mcleod_trailer_id: "R1" }],
        documents: [{ id: "d", subject_type: "tractor", subject_id: "v-805", sha256: sha }],
      },
    });
    expect(await readOurUnits(rec.client, ORG)).toHaveLength(2);
    expect(await readExistingOriginals(rec.client, ORG)).toHaveLength(1);
    expectOrgScoped(rec, ORG);
  });

  it("files the original with its type, records where it came from, and queues its thumb", async () => {
    const rec = createSupabaseRecorder({
      tables: { documents: { data: null }, audit_logs: { data: null } },
      storage: { upload: () => ({ data: { path: "p" }, error: null }) },
    });
    const plan = planImport(ORG, [paper({ sha256: sha })], [truck805], [])[0]!.plan;
    if (plan.action !== "file") throw new Error("expected a file action");
    const out = await fileOne(rec.client, testEnv(), ORG, { source: "lme_analytics", restoredAt: "2026-10-09T13:13:31.280Z" }, paper({ sha256: sha }), plan, PDF);
    expect(out).toBe("filed");
    const inserted = rec.forTable("documents").find((q) => q.write?.method === "insert");
    expect(inserted?.write?.payload).toMatchObject({ id: plan.documentId, subject_type: "tractor", subject_id: "v-805", kind: "irp", content_type: "application/pdf", sha256: sha, uploaded_by: null });
    const audit = rec.forTable("audit_logs").find((q) => q.write?.method === "insert");
    expect(audit?.write?.payload).toMatchObject({ action: "compliance.document_imported", entity_id: plan.documentId, meta: { mcleodCommentId: "C1", mcleodUnitId: "805", source: "mcleod_comments" } });
    expect(dispatched).toContainEqual({ kind: "document_derive", dedupKey: `document_derive:${plan.documentId}` });
    expect(rec.storageCalls()[0]).toMatchObject({ bucket: "compliance-docs", fn: "upload" });
    expectOrgScoped(rec, ORG);
  });

  it("refuses bytes that are not the bytes the manifest hashed", async () => {
    const rec = createSupabaseRecorder({ tables: {} });
    const plan = planImport(ORG, [paper({ sha256: sha })], [truck805], [])[0]!.plan;
    if (plan.action !== "file") throw new Error("expected a file action");
    expect(await fileOne(rec.client, testEnv(), ORG, { source: "x", restoredAt: null }, paper({ sha256: sha }), plan, Buffer.from("%PDF-other"))).toBe("bytes do not match the manifest");
    expect(rec.forTable("documents")).toHaveLength(0);
  });
});
