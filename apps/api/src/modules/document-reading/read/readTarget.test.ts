import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { reviewEpoch, targetOfRow, targetPages } from "./readTarget.js";

/**
 * What a read was given (0455): one place turns a source or an assembly into its pages, so the read, the
 * review screen and the cache key agree. The mistakes it guards against are quiet ones — a document read
 * in the wrong order, a page dropped, and an edited assembly replaying the unreviewed read of the same
 * photos because its own reads hold no reviews yet (F-EX10).
 */
const ORG = "org-1";

describe("targetOfRow", () => {
  it("names the assembly when a read has one, the source otherwise, and refuses a row naming neither", () => {
    expect(targetOfRow({ source_id: null, assembly_id: "a" })).toEqual({ kind: "assembly", id: "a" });
    expect(targetOfRow({ source_id: "s", assembly_id: null })).toEqual({ kind: "source", id: "s" });
    expect(targetOfRow({ source_id: "s" })).toEqual({ kind: "source", id: "s" });
    expect(() => targetOfRow({ source_id: null, assembly_id: null })).toThrow(/neither/);
  });
});

describe("targetPages", () => {
  it("refuses an assembly whose page cannot be found rather than reading a shorter document", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        document_assembly_pages: [{ position: 1, page_id: "p1" }, { position: 2, page_id: "gone" }],
        document_pages: [{ id: "p1", source_id: "s1", page_number: 1 }],
      },
    });
    await expect(targetPages(rec.client, ORG, { kind: "assembly", id: "a" }, "width")).rejects.toThrow(/position 2/);
  });
});

describe("reviewEpoch", () => {
  it("counts the reviews of every read given these pages — by their sources and by every assembly holding one", async () => {
    const readIds = (q: RecordedQuery) => {
      const f = q.filters();
      if (f.some((x) => x.col === "source_id")) return [{ id: "read-of-file" }];
      if (f.some((x) => x.col === "assembly_id")) return [{ id: "read-of-first-version" }, { id: "read-of-file" }];
      return [];
    };
    const rec = createSupabaseRecorder({
      tables: {
        document_assembly_pages: [{ assembly_id: "v1" }, { assembly_id: "v2" }, { assembly_id: "v1" }],
        document_reads: readIds,
        document_read_reviews: { data: [], count: 4 },
      },
    });
    const pages = [{ id: "p1", source_id: "s1", page_number: 1 }, { id: "p2", source_id: "s2", page_number: 1 }];
    expect(await reviewEpoch(rec.client, ORG, pages)).toBe(4);
    expect(rec.forTable("document_assembly_pages")[0]!.filters()).toContainEqual({ col: "page_id", val: ["p1", "p2"] });
    const [bySource, byAssembly] = rec.forTable("document_reads").map((q) => q.filters());
    expect(bySource).toContainEqual({ col: "source_id", val: ["s1", "s2"] });
    expect(byAssembly).toContainEqual({ col: "assembly_id", val: ["v1", "v2"] });
    expect(rec.forTable("document_read_reviews")[0]!.filters()).toContainEqual({ col: "read_id", val: ["read-of-file", "read-of-first-version"] });
    expectOrgScoped(rec, ORG);
  });

  it("is 0 with no reads to count, without asking the reviews table", async () => {
    const rec = createSupabaseRecorder({ tables: { document_assembly_pages: [], document_reads: [] } });
    expect(await reviewEpoch(rec.client, ORG, [{ id: "p1", source_id: "s1", page_number: 1 }])).toBe(0);
    expect(rec.forTable("document_read_reviews")).toEqual([]);
  });
});
