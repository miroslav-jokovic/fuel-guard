import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What a read was given (0455, D-DR14): ONE source (a file — the path a read took before assemblies,
 * and the one the intake's own read still takes) or ONE assembly (an ordered set of pages, usually a
 * driver's photos of one BOL, each photo its own source). `document_reads_names_one` holds a row to
 * exactly one of the two; this file is the one place that turns either into its pages, so the read,
 * the review screen and the cache key cannot disagree about which pages, in which order, a read means.
 *
 * Order: a source's pages by `page_number`; an assembly's by `position` — the order the sender or the
 * reviewer gave, never re-sorted here. `position` on every returned page is its place in THIS document
 * (1..n), which for a source is its page number.
 */
export type ReadTarget = { kind: "source"; id: string } | { kind: "assembly"; id: string };

export const targetColumn = (t: ReadTarget): "source_id" | "assembly_id" => (t.kind === "source" ? "source_id" : "assembly_id");

/** The target a `document_reads` row names. A row selected without `assembly_id` (pre-0455 code) is a source's. */
export function targetOfRow(row: { source_id: string | null; assembly_id?: string | null }): ReadTarget {
  if (row.assembly_id) return { kind: "assembly", id: row.assembly_id };
  if (row.source_id) return { kind: "source", id: row.source_id };
  throw new Error("a document read names neither a source nor an assembly (0455 document_reads_names_one)");
}

/** The response's pair: exactly one is set. */
export const targetIds = (t: ReadTarget): { sourceId: string | null; assemblyId: string | null } =>
  t.kind === "source" ? { sourceId: t.id, assemblyId: null } : { sourceId: null, assemblyId: t.id };

interface BasePage {
  id: string;
  source_id: string;
  page_number: number;
}
export type TargetPage<T> = T & BasePage & { position: number };

/**
 * The target's pages in document order, with `columns` (a `document_pages` select list) on each. An
 * assembly page that cannot be found is an error, not a shorter document: the composite FK (0454) makes
 * it impossible, so seeing it means the query is wrong, and a read of fewer pages than were given would
 * be a read of a different document.
 */
export async function targetPages<T extends object>(
  admin: SupabaseClient,
  orgId: string,
  target: ReadTarget,
  columns: string,
): Promise<TargetPage<T>[]> {
  const select = `id, source_id, page_number, ${columns}`;
  if (target.kind === "source") {
    const { data, error } = await admin
      .from("document_pages").select(select)
      .eq("org_id", orgId).eq("source_id", target.id).order("page_number", { ascending: true });
    if (error) throw new Error(`document_pages: ${error.message}`);
    return ((data ?? []) as unknown as (T & BasePage)[]).map((p) => ({ ...p, position: p.page_number }));
  }
  const { data: slots, error: sErr } = await admin
    .from("document_assembly_pages").select("position, page_id")
    .eq("org_id", orgId).eq("assembly_id", target.id).order("position", { ascending: true });
  if (sErr) throw new Error(`document_assembly_pages: ${sErr.message}`);
  const order = (slots ?? []) as { position: number; page_id: string }[];
  if (order.length === 0) return [];
  const { data, error } = await admin
    .from("document_pages").select(select)
    .eq("org_id", orgId).in("id", order.map((s) => s.page_id));
  if (error) throw new Error(`document_pages: ${error.message}`);
  const byId = new Map(((data ?? []) as unknown as (T & BasePage)[]).map((p) => [p.id, p]));
  return order.map((s) => {
    const p = byId.get(s.page_id);
    if (!p) throw new Error(`assembly ${target.id} position ${s.position}: page ${s.page_id} not found in this organization`);
    return { ...p, position: s.position };
  });
}

/**
 * The cache key's review epoch (cacheKey.ts, F-EX10): how many reviews are held by every read that was
 * given any of these pages — by their source, or by any assembly that contains one of them. Not only
 * this target's reads: a reviewer's edit is a NEW assembly, so counting one assembly's reads alone would
 * start the edited document at epoch 0 and let it replay the unreviewed read of the same bytes. Reviews
 * are append-only (0448), so the count only rises.
 */
export async function reviewEpoch(admin: SupabaseClient, orgId: string, pages: readonly BasePage[]): Promise<number> {
  if (pages.length === 0) return 0;
  const sourceIds = [...new Set(pages.map((p) => p.source_id))];
  const { data: slots, error: aErr } = await admin
    .from("document_assembly_pages").select("assembly_id")
    .eq("org_id", orgId).in("page_id", pages.map((p) => p.id));
  if (aErr) throw new Error(`document_assembly_pages: ${aErr.message}`);
  const assemblyIds = [...new Set(((slots ?? []) as { assembly_id: string }[]).map((s) => s.assembly_id))];

  const ids = new Set<string>();
  const { data: bySource, error: sErr } = await admin.from("document_reads").select("id").eq("org_id", orgId).in("source_id", sourceIds);
  if (sErr) throw new Error(`document_reads: ${sErr.message}`);
  for (const r of (bySource ?? []) as { id: string }[]) ids.add(r.id);
  if (assemblyIds.length > 0) {
    const { data: byAssembly, error: rErr } = await admin.from("document_reads").select("id").eq("org_id", orgId).in("assembly_id", assemblyIds);
    if (rErr) throw new Error(`document_reads: ${rErr.message}`);
    for (const r of (byAssembly ?? []) as { id: string }[]) ids.add(r.id);
  }
  if (ids.size === 0) return 0;
  const { count, error } = await admin
    .from("document_read_reviews")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .in("read_id", [...ids]);
  if (error) throw new Error(`document_read_reviews: ${error.message}`);
  return count ?? 0;
}
