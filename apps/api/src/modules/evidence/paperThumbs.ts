import type { SupabaseClient } from "@supabase/supabase-js";
import { chunks, DOCUMENTS_BUCKET, IN_LIST_CHUNK, PAPERS_PER_ROW, type PaperThumb } from "@silvicom/shared";
import { DOCUMENT_URL_TTL_SEC } from "./compliance.js";

/**
 * A list cell's papers, for every subject of one kind in one pass (UNIT-FILES-PLAN UF4): the newest
 * `PAPERS_PER_ROW` originals per subject, each with its 320 px thumbnail signed, and the count of every
 * original for the "+N". The truck and trailer rollup (`unitFiles.ts`) and the driver overview
 * (`complianceOverview.ts`, UF4b) both read it, so a driver's cell and a truck's cell are built by the
 * same code and mean the same thing.
 *
 * The caller has already read the subject type's `documents` rows (org-filtered, paged); this only
 * folds them and signs. One Storage batch per 500 thumbnails, never one per subject.
 */

/** The `documents` columns a papers reader selects — the rollup and the overview ask for the same list. */
export const PAPER_DOC_COLUMNS = "id, subject_id, kind, content_type, variant, derived_from, storage_path, captured_at, created_at, uploaded_by";

export interface PaperDocRow {
  id: string;
  subject_id: string;
  kind: string;
  content_type: string;
  variant: string;
  derived_from: string | null;
  storage_path: string;
  captured_at: string | null;
  created_at: string;
  uploaded_by: string | null;
}

export interface SubjectPapers {
  papers: PaperThumb[];
  paperCount: number;
}

/**
 * Signed URLs in batches; a failed signature degrades a thumb to null. Batches of 500, not
 * `IN_LIST_CHUNK`: the paths travel in a POST body, so the header limit that sizes an `.in()` list
 * does not apply, and a 400-unit fleet's 1,200 thumbs are three calls rather than twenty-four.
 */
const SIGN_BATCH = 500;
async function signPaths(admin: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunks(paths, SIGN_BATCH)) {
    const { data } = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUrls(part, DOCUMENT_URL_TTL_SEC);
    for (const s of data ?? []) if (s.signedUrl && s.path) out.set(s.path, s.signedUrl);
  }
  return out;
}

/**
 * Every subject's papers, by subject id. A subject with no originals is absent, so a caller reads
 * `?? { papers: [], paperCount: 0 }`.
 *
 * `readable` is the READER's say on a paper's kind, asked before the newest three are picked and before
 * anything is counted — a driver's file holds scans of restricted records (Phase G, D-DQ15: a drug test
 * is as restricted as its result), and a thumbnail of one in a dispatcher's roster would be the leak
 * the documents list already refuses. A paper the reader may not see is not on file as far as the cell
 * is concerned: not drawn, not counted. Equipment has no restricted kinds and passes nothing.
 */
export async function paperThumbsBySubject(
  admin: SupabaseClient,
  docs: readonly PaperDocRow[],
  readable: (kind: string) => boolean = () => true,
): Promise<Map<string, SubjectPapers>> {
  const thumbOf = new Map<string, PaperDocRow>();
  for (const d of docs) if (d.variant === "thumb" && d.derived_from) thumbOf.set(d.derived_from, d);

  // Newest first — the cell shows the papers most recently filed, the "+N" counts the rest.
  const originalsBy = new Map<string, PaperDocRow[]>();
  for (const d of docs) {
    if (d.variant !== "original" || !readable(d.kind)) continue;
    const list = originalsBy.get(d.subject_id);
    if (list) list.push(d);
    else originalsBy.set(d.subject_id, [d]);
  }
  for (const list of originalsBy.values()) list.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const thumbPaths = [...originalsBy.values()]
    .flatMap((list) => list.slice(0, PAPERS_PER_ROW))
    .map((d) => thumbOf.get(d.id)?.storage_path)
    .filter((p): p is string => p !== undefined);
  const drawn = [...originalsBy.values()].flatMap((list) => list.slice(0, PAPERS_PER_ROW));
  const [signed, names] = await Promise.all([
    signPaths(admin, thumbPaths),
    uploaderNames(admin, [...new Set(drawn.map((d) => d.uploaded_by).filter((u): u is string => typeof u === "string" && u !== ""))]),
  ]);

  const out = new Map<string, SubjectPapers>();
  for (const [subjectId, list] of originalsBy) {
    const papers: PaperThumb[] = list.slice(0, PAPERS_PER_ROW).map((d) => {
      const thumb = thumbOf.get(d.id);
      return {
        documentId: d.id, kind: d.kind, contentType: d.content_type,
        thumbUrl: thumb ? (signed.get(thumb.storage_path) ?? null) : null,
        filedAt: d.created_at,
        uploadedBy: d.uploaded_by ? (names.get(d.uploaded_by) ?? null) : null,
      };
    });
    out.set(subjectId, { papers, paperCount: list.length });
  }
  return out;
}

/**
 * The names behind `uploaded_by`, one chunked read for every paper a cell will draw. `user_profiles`
 * is keyed by user, not org — the ids come from this org's own `documents` rows, read org-filtered
 * above, so the lookup cannot reach another tenant's member. A member with no profile name is null,
 * and the card says only when the paper was filed.
 */
async function uploaderNames(admin: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunks(userIds, IN_LIST_CHUNK)) {
    const { data } = await admin.from("user_profiles").select("user_id, full_name").in("user_id", part);
    for (const r of (data ?? []) as Array<{ user_id: string; full_name: string | null }>) if (r.full_name) out.set(r.user_id, r.full_name);
  }
  return out;
}

export const NO_PAPERS: SubjectPapers = { papers: [], paperCount: 0 };
