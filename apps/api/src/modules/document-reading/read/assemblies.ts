import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSEMBLY_MAX_PAGES, type CreateAssemblyRequest, type CreateAssemblyResponse } from "@silvicom/shared";
import { fail, type ReaderError } from "./requests.js";

/**
 * `POST /api/documents/assemblies` (D-DR14, 0454): "these pages, in this order, are one document".
 *
 * Two makers reach it from a person. A SENDER names the files they uploaded, in the order they chose; each
 * file contributes all its pages in page order (a two-page PDF and a phone photo make a three-page
 * document). A REVIEWER sends the full new page list of an assembly they edited — unticked, reordered or
 * with a page added from another file — and names the version it replaces. Layer 1's own proposal
 * (`prepare`) is written by the worker, never by this route.
 *
 * The one writer is `document_assembly_create`, which checks every page is this org's (DO017), the list
 * is non-empty and repeats nothing (DO016), the superseded assembly is this org's (DO018) and was not
 * already replaced (23505) — so this file maps those codes rather than re-checking them. What it does
 * check itself is what the function cannot see: that each named FILE is this org's, and that the files'
 * pages together still fit `ASSEMBLY_MAX_PAGES`.
 */

const PG_CODES: Record<string, Pick<ReaderError, "code" | "error">> = {
  DO016: { code: "invalid_assembly", error: "A document needs at least one page, each listed once." },
  DO017: { code: "not_found", error: "A page is not in this organization." },
  DO018: { code: "not_found", error: "That document is not in this organization." },
  "23505": { code: "edited_elsewhere", error: "Someone else changed this document's pages first. Reload it and try again." },
};

/** The sender's files → their pages, files in the order given, each file's pages in page order. */
async function pagesOfSources(admin: SupabaseClient, orgId: string, sourceIds: readonly string[]): Promise<string[] | ReaderError> {
  const { data: sources, error: sErr } = await admin.from("document_sources").select("id").eq("org_id", orgId).in("id", sourceIds);
  if (sErr) return fail("query_failed", sErr.message);
  if ((sources ?? []).length !== sourceIds.length) return fail("not_found", "A file is not in this organization.");
  const { data, error } = await admin
    .from("document_pages").select("id, source_id, page_number")
    .eq("org_id", orgId).in("source_id", sourceIds);
  if (error) return fail("query_failed", error.message);
  const rank = new Map(sourceIds.map((id, i) => [id, i]));
  return ((data ?? []) as { id: string; source_id: string; page_number: number }[])
    .sort((a, b) => rank.get(a.source_id)! - rank.get(b.source_id)! || a.page_number - b.page_number)
    .map((p) => p.id);
}

export async function createAssembly(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  body: CreateAssemblyRequest,
): Promise<CreateAssemblyResponse | ReaderError> {
  const sender = "sourceIds" in body;
  const pages = sender ? await pagesOfSources(admin, orgId, body.sourceIds) : body.pageIds;
  if (!Array.isArray(pages)) return pages;
  if (pages.length > ASSEMBLY_MAX_PAGES) {
    return fail("invalid_assembly", `These files hold ${pages.length} pages; one document holds at most ${ASSEMBLY_MAX_PAGES}.`);
  }
  const { data, error } = await admin.rpc("document_assembly_create", {
    p_org: orgId,
    p_pages: pages,
    p_made_by: sender ? "sender" : "reviewer",
    p_actor: userId,
    p_supersedes: sender ? null : body.supersedes,
  });
  if (error) {
    const known = PG_CODES[(error as { code?: string }).code ?? ""];
    return known ? fail(known.code, known.error) : fail("insert_failed", error.message);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { id: string } | null;
  if (!row?.id) return fail("insert_failed", "The document's pages were not recorded.");
  return { assemblyId: row.id, pageCount: pages.length };
}
