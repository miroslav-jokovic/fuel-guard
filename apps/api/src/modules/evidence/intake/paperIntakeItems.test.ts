import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { itemsForPiece, syncStackItems } from "./paperIntakeItems.js";

/**
 * A stack's read pieces become review rows (DRIVER-PAPER-INTAKE-PLAN PI3): every page lands in exactly one
 * row, a cover sheet's driver is the scope, an unsheeted piece asks the matcher, a failed read is still a
 * row, and a piece already turned into rows is not turned again.
 */
const ORG = "org-1";
const A = "3f2b9c1e-8d4a-4b6f-9e21-5c7a0d1e2f34";
const B = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const base = (driverId: string | null, pages: number) => ({
  orgId: ORG,
  batchId: "batch-1",
  sourceId: "src-1",
  part: { part_index: 0, driver_id: driverId, stack_pages: Array.from({ length: pages }, (_, i) => i + 10), sha256: "a".repeat(64) },
});
const paper = (over: Record<string, unknown>) => ({
  pageFrom: null, pageTo: null, kind: null, title: null, issuer: null, unitNumbers: [], vins: [], plates: [],
  driverName: null, licenseNumber: null, issuedOn: null, expiresOn: null, ...over,
}) as Parameters<typeof itemsForPiece>[1] extends readonly (infer P)[] | null ? P : never;
const ranges = (rows: Array<Record<string, unknown>>) => rows.map((r) => [r.page_from, r.page_to, r.proposed_kind]);

const readOf = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../document-reading/index.js", () => ({ readOfBytes: (...a: unknown[]) => readOf.fn(...a) }));

describe("itemsForPiece", () => {
  it("makes one row per paper, dated from what is printed, owned by the cover sheet's driver", () => {
    const rows = itemsForPiece(base(A, 4), [
      paper({ pageFrom: 1, pageTo: 2, kind: "employment_application", issuedOn: "03/01/2019" }),
      paper({ pageFrom: 3, pageTo: 4, kind: "medical_card", issuedOn: "June 1, 2026", expiresOn: "06/30/27" }),
    ], []);
    expect(ranges(rows)).toEqual([[1, 2, "employment_application"], [3, 4, "medical_card"]]);
    expect(rows[1]).toMatchObject({ proposed_issued_on: "2026-06-01", proposed_expires_on: "2027-06-30" });
    expect(rows.every((r) => r.scope_subject_id === A && r.proposed_subject_id === A && r.match_basis === "scope")).toBe(true);
  });

  it("puts pages no paper covers in a row of their own rather than dropping them", () => {
    const rows = itemsForPiece(base(A, 6), [paper({ pageFrom: 2, pageTo: 3, kind: "mvr" })], []);
    expect(ranges(rows)).toEqual([[1, 1, null], [2, 3, "mvr"], [4, 6, null]]);
  });

  it("gives an overlapping page to the first paper that claims it, so no page is in two rows", () => {
    const rows = itemsForPiece(base(A, 4), [paper({ pageFrom: 1, pageTo: 3, kind: "mvr" }), paper({ pageFrom: 3, pageTo: 4, kind: "road_test" })], []);
    expect(ranges(rows)).toEqual([[1, 3, "mvr"], [4, 4, "road_test"]]);
  });

  it("clamps a range past the piece and puts a backwards one right", () => {
    expect(ranges(itemsForPiece(base(A, 3), [paper({ pageFrom: 3, pageTo: 1, kind: "mvr" })], []))).toEqual([[1, 3, "mvr"]]);
    expect(ranges(itemsForPiece(base(A, 3), [paper({ pageFrom: 2, pageTo: 9, kind: "mvr" })], []))).toEqual([[1, 1, null], [2, 3, "mvr"]]);
  });

  it("turns a failed read into one row over the whole piece, to classify by hand", () => {
    const rows = itemsForPiece(base(A, 5), null, []);
    expect(ranges(rows)).toEqual([[1, 5, null]]);
    expect(rows[0]!.read_identifiers).toEqual({ unread: true });
  });

  it("asks the matcher for a piece with no cover sheet, and proposes nobody between two equal names", () => {
    const roster = [{ id: A, fullName: "Ann Driver", cdlNumber: "D123" }, { id: B, fullName: "Bo Hauler", cdlNumber: null }];
    const [byCdl] = itemsForPiece(base(null, 1), [paper({ pageFrom: 1, pageTo: 1, kind: "cdl", licenseNumber: "D123" })], roster);
    expect(byCdl).toMatchObject({ scope_subject_id: null, proposed_subject_id: A, match_basis: "cdl" });
    const twins = [{ id: A, fullName: "Sam Lee", cdlNumber: null }, { id: B, fullName: "Sam Lee", cdlNumber: null }];
    const [ambiguous] = itemsForPiece(base(null, 1), [paper({ pageFrom: 1, pageTo: 1, kind: "mvr", driverName: "Sam Lee" })], twins);
    expect(ambiguous).toMatchObject({ proposed_subject_id: null, match_basis: null });
  });

  it("keeps a kind outside the catalogue, or other, out of the proposal", () => {
    const rows = itemsForPiece(base(A, 2), [paper({ pageFrom: 1, pageTo: 1, kind: "other" }), paper({ pageFrom: 2, pageTo: 2, kind: "unicorn" })], []);
    expect(rows.map((r) => r.proposed_kind)).toEqual([null, null]);
  });
});

describe("syncStackItems", () => {
  beforeEach(() => readOf.fn.mockReset());
  const parts = [
    { part_index: 0, driver_id: A, stack_pages: [2, 3], sha256: "1".repeat(64) },
    { part_index: 1, driver_id: B, stack_pages: [5], sha256: "2".repeat(64) },
    { part_index: 2, driver_id: B, stack_pages: [6], sha256: "3".repeat(64) },
  ];

  it("turns finished reads into rows, counts the rest, and inserts nothing for a piece already turned", async () => {
    readOf.fn.mockImplementation(async (_a: unknown, _o: unknown, sha: string) =>
      sha === "1".repeat(64)
        ? { status: "done", sourceId: "s1", readId: "r1", failureCode: null, evidence: [], result: { papers: [{ pageFrom: 1, pageTo: 2, kind: "mvr" }] } }
        : sha === "2".repeat(64)
          ? { status: "reading", sourceId: "s2", readId: "r2", failureCode: null, evidence: [], result: null }
          : { status: "failed", sourceId: "s3", readId: "r3", failureCode: "model_error", evidence: [], result: null },
    );
    const rec = createSupabaseRecorder({
      tables: {
        paper_intake_parts: parts,
        // s3 already has its rows; s1 has none.
        file_intake_items: (q) => ({ data: q.filters().some((f) => f.col === "source_id" && f.val === "s3") ? [{ id: "x" }] : [] }),
      },
    });
    const reading = await syncStackItems(rec.client, ORG, { id: "stack-1", batchId: "batch-1" });
    expect(reading).toEqual({ done: 1, pending: 1, failed: 1, sources: new Map([[0, "s1"], [2, "s3"]]) });
    const inserts = rec.forTable("file_intake_items").filter((q) => q.write?.method === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.write!.payload).toEqual([expect.objectContaining({ source_id: "s1", page_from: 1, page_to: 2, proposed_kind: "mvr", batch_id: "batch-1", org_id: ORG })]);
    expect(readOf.fn).toHaveBeenCalledWith(rec.client, ORG, "1".repeat(64), "compliance_paper");
    expectOrgScoped(rec, ORG);
  });

  it("takes another request's insert of the same piece as done, not as an error", async () => {
    readOf.fn.mockResolvedValue({ status: "failed", sourceId: "s1", readId: "r1", failureCode: "x", evidence: [], result: null });
    const rec = createSupabaseRecorder({
      tables: { paper_intake_parts: [parts[0]], file_intake_items: { data: [], writeError: { code: "23505", message: "duplicate key" } } },
    });
    await expect(syncStackItems(rec.client, ORG, { id: "stack-1", batchId: "batch-1" })).resolves.toEqual({ done: 0, pending: 0, failed: 1, sources: new Map([[0, "s1"]]) });
  });
});
