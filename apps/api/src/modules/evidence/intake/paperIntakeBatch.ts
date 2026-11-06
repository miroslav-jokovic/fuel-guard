import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PAPER_STACK_FAILURES,
  type PaperBatchResponse,
  type PaperIntakeItemDto,
  type PaperStackDto,
  type PaperStackFailure,
  type PaperStackStatus,
} from "@silvicom/shared";
import { chunks } from "../../../lib/paging.js";
import { PAPER_INTAKE_BUCKET } from "./paperIntake.js";
import { syncStackItems, type StackReading } from "./paperIntakeItems.js";

/**
 * One drop, as the upload-and-review page shows it (DRIVER-PAPER-INTAKE-PLAN PI4): its stacks, the pieces
 * each was cut into, how far reading has got, and the review rows the finished reads became. Reads only;
 * asking is also what turns finished reads into rows (`syncStackItems`, PI3).
 *
 * A row is shown on the STACK's page numbers — the scan the person made — mapped through its piece
 * (`paper_intake_parts.stack_pages`); a row's piece is found by its reader source, which
 * `syncStackItems` reports for every finished piece.
 */
type StackRow = {
  id: string; batch_id: string; file_name: string; status: PaperStackStatus; failure_code: string | null;
  page_count: number | null; cover_sheet_count: number | null; blank_page_count: number | null; created_at: string;
};
type PartRow = { stack_id: string; part_index: number; driver_id: string | null; basis: "cover_sheet" | "none"; stack_pages: number[] };
type ItemRow = {
  id: string; source_id: string; page_from: number; page_to: number; proposed_subject_id: string | null; match_basis: string | null;
  proposed_kind: string | null; proposed_issued_on: string | null; proposed_expires_on: string | null;
  read_identifiers: Record<string, unknown>; status: PaperIntakeItemDto["status"];
};

async function driverNames(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const part of chunks([...new Set(ids)])) {
    const { data, error } = await admin.from("drivers").select("id, full_name").eq("org_id", orgId).in("id", part);
    if (error) throw new Error(`drivers: ${error.message}`);
    for (const d of (data ?? []) as Array<{ id: string; full_name: string }>) names.set(d.id, d.full_name);
  }
  return names;
}

export async function listBatch(admin: SupabaseClient, orgId: string, batchId: string): Promise<PaperBatchResponse> {
  const stacks = await admin
    .from("paper_intake_stacks")
    .select("id, batch_id, file_name, status, failure_code, page_count, cover_sheet_count, blank_page_count, created_at")
    .eq("org_id", orgId)
    .eq("batch_id", batchId)
    .order("created_at");
  if (stacks.error) throw new Error(`paper_intake_stacks: ${stacks.error.message}`);
  const list = (stacks.data ?? []) as StackRow[];
  if (!list.length) return { stacks: [], items: [] };

  const parts = await admin
    .from("paper_intake_parts")
    .select("stack_id, part_index, driver_id, basis, stack_pages")
    .eq("org_id", orgId)
    .in("stack_id", list.map((s) => s.id))
    .order("part_index");
  if (parts.error) throw new Error(`paper_intake_parts: ${parts.error.message}`);
  const partRows = (parts.data ?? []) as PartRow[];

  const reading = new Map<string, StackReading>();
  for (const s of list.filter((x) => x.status === "split")) {
    reading.set(s.id, await syncStackItems(admin, orgId, { id: s.id, batchId: s.batch_id }));
  }
  const pieceBySource = new Map<string, { stackId: string; part: PartRow }>();
  for (const [stackId, r] of reading) {
    for (const [index, sourceId] of r.sources) {
      const part = partRows.find((p) => p.stack_id === stackId && p.part_index === index);
      if (part) pieceBySource.set(sourceId, { stackId, part });
    }
  }

  let itemRows: ItemRow[] = [];
  if (reading.size) {
    const items = await admin
      .from("file_intake_items")
      .select("id, source_id, page_from, page_to, proposed_subject_id, match_basis, proposed_kind, proposed_issued_on, proposed_expires_on, read_identifiers, status")
      .eq("org_id", orgId)
      .eq("batch_id", batchId)
      .order("created_at");
    if (items.error) throw new Error(`file_intake_items: ${items.error.message}`);
    itemRows = (items.data ?? []) as ItemRow[];
  }

  const names = await driverNames(admin, orgId, [
    ...partRows.flatMap((p) => (p.driver_id ? [p.driver_id] : [])),
    ...itemRows.flatMap((i) => (i.proposed_subject_id ? [i.proposed_subject_id] : [])),
  ]);

  const stackDtos: PaperStackDto[] = list.map((s) => {
    const r = reading.get(s.id);
    return {
      id: s.id,
      batchId: s.batch_id,
      fileName: s.file_name,
      status: s.status,
      failure: s.failure_code ? (PAPER_STACK_FAILURES[s.failure_code as PaperStackFailure] ?? s.failure_code) : null,
      pageCount: s.page_count,
      coverSheetCount: s.cover_sheet_count,
      blankPageCount: s.blank_page_count,
      createdAt: s.created_at,
      reading: r ? { done: r.done, pending: r.pending, failed: r.failed } : null,
      parts: partRows
        .filter((p) => p.stack_id === s.id)
        .map((p) => ({ partIndex: p.part_index, driverId: p.driver_id, driverName: p.driver_id ? (names.get(p.driver_id) ?? null) : null, basis: p.basis, stackPages: p.stack_pages })),
    };
  });

  const items: PaperIntakeItemDto[] = itemRows.flatMap((i) => {
    const piece = pieceBySource.get(i.source_id);
    if (!piece) return [];
    return [{
      id: i.id,
      stackId: piece.stackId,
      partIndex: piece.part.part_index,
      pages: piece.part.stack_pages.slice(i.page_from - 1, i.page_to),
      pieceFrom: i.page_from,
      pieceTo: i.page_to,
      driverId: i.proposed_subject_id,
      driverName: i.proposed_subject_id ? (names.get(i.proposed_subject_id) ?? null) : null,
      basis: i.match_basis,
      kind: i.proposed_kind,
      issuedOn: i.proposed_issued_on,
      expiresOn: i.proposed_expires_on,
      title: typeof i.read_identifiers?.title === "string" ? i.read_identifiers.title : null,
      unread: i.read_identifiers?.unread === true,
      status: i.status,
    }];
  });
  return { stacks: stackDtos, items };
}

/** A five-minute signed URL to one piece's PDF, for the review page's viewer. Null when no such piece. */
export async function pieceUrl(admin: SupabaseClient, orgId: string, stackId: string, partIndex: number): Promise<string | null> {
  const { data, error } = await admin
    .from("paper_intake_parts")
    .select("object_path")
    .eq("org_id", orgId)
    .eq("stack_id", stackId)
    .eq("part_index", partIndex)
    .maybeSingle();
  if (error) throw new Error(`paper_intake_parts: ${error.message}`);
  const path = (data as { object_path: string } | null)?.object_path;
  if (!path) return null;
  const signed = await admin.storage.from(PAPER_INTAKE_BUCKET).createSignedUrl(path, 300);
  if (signed.error || !signed.data) throw new Error(`paper-intake sign: ${signed.error?.message ?? "no url"}`);
  return signed.data.signedUrl;
}
