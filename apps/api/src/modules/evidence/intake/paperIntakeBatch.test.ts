import { describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";

/**
 * One drop as the review page shows it (DRIVER-PAPER-INTAKE-PLAN PI4): its rows on the STACK's page numbers,
 * each joined to its piece through the reader source, with the driver's name from this roster.
 */
const ORG = "org-1";
const STACK = "5a5a5a5a-1111-4222-8333-444444444444";
const A = "3f2b9c1e-8d4a-4b6f-9e21-5c7a0d1e2f34";
const sync = vi.hoisted(() => vi.fn());
vi.mock("./paperIntakeItems.js", () => ({ syncStackItems: sync }));
const { listBatch, pieceUrl } = await import("./paperIntakeBatch.js");

describe("listBatch (PI4)", () => {
  it("shows each row on the stack's own page numbers, with its driver's name and how sure the owner is", async () => {
    sync.mockResolvedValue({ done: 1, pending: 1, failed: 0, sources: new Map([[0, "src-0"]]) });
    const rec = createSupabaseRecorder({
      tables: {
        paper_intake_stacks: [{ id: STACK, batch_id: "b", file_name: "stack.pdf", status: "split", failure_code: null, page_count: 9, cover_sheet_count: 1, blank_page_count: 1, created_at: "2026-11-06T18:00:00Z" }],
        paper_intake_parts: [
          { stack_id: STACK, part_index: 0, driver_id: A, basis: "cover_sheet", stack_pages: [2, 4, 5, 6] },
          { stack_id: STACK, part_index: 1, driver_id: null, basis: "none", stack_pages: [8, 9] },
        ],
        file_intake_items: [
          { id: "i1", source_id: "src-0", page_from: 2, page_to: 3, proposed_subject_id: A, match_basis: "scope", proposed_kind: "mvr", proposed_issued_on: "2026-01-05", proposed_expires_on: null, read_identifiers: { title: "Driving Record" }, status: "pending" },
          // A row whose piece has not been reported back is not shown half-mapped.
          { id: "i2", source_id: "src-unknown", page_from: 1, page_to: 1, proposed_subject_id: null, match_basis: null, proposed_kind: null, proposed_issued_on: null, proposed_expires_on: null, read_identifiers: { unread: true }, status: "pending" },
        ],
        drivers: [{ id: A, full_name: "Ann Driver" }],
      },
    });
    const out = await listBatch(rec.client, ORG, "b0b0b0b0-1111-4222-8333-444444444444");
    expect(out.stacks[0]).toMatchObject({ reading: { done: 1, pending: 1, failed: 0 }, coverSheetCount: 1 });
    expect(out.items).toEqual([
      expect.objectContaining({ id: "i1", partIndex: 0, pages: [4, 5], pieceFrom: 2, pieceTo: 3, driverName: "Ann Driver", basis: "scope", kind: "mvr", title: "Driving Record", unread: false }),
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("answers an empty drop with nothing, and reads no rows for a batch with no split stack", async () => {
    sync.mockReset();
    const empty = createSupabaseRecorder({ tables: { paper_intake_stacks: [] } });
    expect(await listBatch(empty.client, ORG, "b")).toEqual({ stacks: [], items: [] });
    const splitting = createSupabaseRecorder({
      tables: { paper_intake_stacks: [{ id: STACK, batch_id: "b", file_name: "s.pdf", status: "splitting", failure_code: null, page_count: null, cover_sheet_count: null, blank_page_count: null, created_at: "x" }] },
    });
    expect((await listBatch(splitting.client, ORG, "b")).items).toEqual([]);
    expect(splitting.forTable("file_intake_items")).toEqual([]);
    expect(sync).not.toHaveBeenCalled();
  });
});

describe("pieceUrl (PI4)", () => {
  it("signs this org's piece for five minutes, and answers null for one that is not on file", async () => {
    const rec = createSupabaseRecorder({
      tables: { paper_intake_parts: [{ object_path: `${ORG}/${STACK}/part-000.pdf` }] },
      storage: { createSignedUrl: async () => ({ data: { signedUrl: "https://signed/piece" }, error: null }) },
    });
    expect(await pieceUrl(rec.client, ORG, STACK, 0)).toBe("https://signed/piece");
    expect(rec.storageCalls()[0]).toMatchObject({ bucket: "paper-intake", fn: "createSignedUrl", args: [`${ORG}/${STACK}/part-000.pdf`, 300] });
    expectOrgScoped(rec, ORG);
    const none = createSupabaseRecorder({ tables: { paper_intake_parts: [] } });
    expect(await pieceUrl(none.client, ORG, STACK, 7)).toBeNull();
  });
});
