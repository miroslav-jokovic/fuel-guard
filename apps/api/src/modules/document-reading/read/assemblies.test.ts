import { describe, expect, it } from "vitest";
import { ASSEMBLY_MAX_PAGES } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { MANY_IMAGES_THRESHOLD } from "../model/visionTier.js";
import { createAssembly } from "./assemblies.js";

/**
 * `createAssembly` (D-DR14): the order a person gives is the order the document is read in. The mistakes
 * are a document whose pages are silently re-sorted, one that names another carrier's file, and a second
 * dispatcher's edit landing on top of the first instead of being told it was edited elsewhere.
 */
const ORG = "org-1";
const USER = "user-1";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const V1 = "33333333-3333-4333-8333-333333333333";

function world(opts: { sources?: string[]; pages?: unknown[]; rpc?: unknown } = {}) {
  return createSupabaseRecorder({
    tables: {
      document_sources: (opts.sources ?? [A, B]).map((id) => ({ id })),
      // Returned in no useful order: the files' order, then page order, is the function's to impose.
      document_pages: opts.pages ?? [
        { id: "a1", source_id: A, page_number: 1 },
        { id: "b2", source_id: B, page_number: 2 },
        { id: "b1", source_id: B, page_number: 1 },
      ],
    },
    rpc: { document_assembly_create: opts.rpc ?? { id: "new-assembly" } },
  });
}
const rpcArgs = (rec: ReturnType<typeof world>) => rec.rpcs().find((r) => r.fn === "document_assembly_create")?.args;

describe("createAssembly — the sender's files", () => {
  it("lists the files in the order given, each file's pages in page order, as the sender's assembly", async () => {
    const rec = world();
    expect(await createAssembly(rec.client, ORG, USER, { sourceIds: [B, A] })).toEqual({ assemblyId: "new-assembly", pageCount: 3 });
    expect(rpcArgs(rec)).toEqual({ p_org: ORG, p_pages: ["b1", "b2", "a1"], p_made_by: "sender", p_actor: USER, p_supersedes: null });
    expectOrgScoped(rec, ORG);
  });

  it("answers not_found when a file is not this organization's, writing nothing", async () => {
    const rec = world({ sources: [A] });
    expect(await createAssembly(rec.client, ORG, USER, { sourceIds: [A, B] })).toMatchObject({ code: "not_found" });
    expect(rpcArgs(rec)).toBeUndefined();
  });

  it("refuses files that hold more pages than one document may, before writing anything", async () => {
    const pages = Array.from({ length: ASSEMBLY_MAX_PAGES + 1 }, (_, i) => ({ id: `p${i}`, source_id: A, page_number: i + 1 }));
    const rec = world({ sources: [A], pages });
    expect(await createAssembly(rec.client, ORG, USER, { sourceIds: [A] })).toMatchObject({ code: "invalid_assembly" });
    expect(rpcArgs(rec)).toBeUndefined();
  });

  it("holds a document under the vision API's many-image threshold, so no page of a long one is read smaller", () => {
    expect(ASSEMBLY_MAX_PAGES).toBeLessThanOrEqual(MANY_IMAGES_THRESHOLD);
  });
});

describe("createAssembly — a reviewer's edit", () => {
  it("sends the reviewer's page list as given, naming the version it replaces", async () => {
    const rec = world();
    expect(await createAssembly(rec.client, ORG, USER, { supersedes: V1, pageIds: ["b2", "a1"] })).toEqual({ assemblyId: "new-assembly", pageCount: 2 });
    expect(rpcArgs(rec)).toEqual({ p_org: ORG, p_pages: ["b2", "a1"], p_made_by: "reviewer", p_actor: USER, p_supersedes: V1 });
  });

  it("answers edited_elsewhere when that version was already replaced (23505), and names each of the function's refusals", async () => {
    const table: Array<[string, string]> = [["23505", "edited_elsewhere"], ["DO016", "invalid_assembly"], ["DO017", "not_found"], ["DO018", "not_found"], ["XX000", "insert_failed"]];
    for (const [pg, code] of table) {
      const rec = world({ rpc: { error: { code: pg, message: "refused" } } });
      expect(await createAssembly(rec.client, ORG, USER, { supersedes: V1, pageIds: ["a1"] })).toMatchObject({ code });
    }
  });
});
