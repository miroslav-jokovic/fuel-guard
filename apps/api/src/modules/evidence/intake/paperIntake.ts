import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import {
  PAPER_STACK_FAILURES,
  PAPER_STACK_MAX_PAGES,
  planParts,
  type PaperStackDto,
  type PaperStackFailure,
  type PaperStackRegisterRequest,
  type PaperStackRegisterResponse,
  type PaperStackStatus,
} from "@silvicom/shared";
import { chunks } from "../../../lib/paging.js";
import { scanStack } from "./findCoverSheets.js";

/**
 * Scanned stacks of paper driver files: register the upload, split it, read it back
 * (DRIVER-PAPER-INTAKE-PLAN PI2; tables 0572). THE ONE FILE THAT WRITES `paper_intake_stacks` and
 * `paper_intake_parts` (`lint:table-writers`).
 *
 * ── THE THREE STEPS ──────────────────────────────────────────────────────────────────────────────
 * 1. `registerStack` — a row in `uploading`, and a signed PUT URL for `<org>/<stack>/stack.pdf`. The
 *    bytes go from the browser to Storage directly; a 50 MB scan never passes through the API (the
 *    reader's intake reason). The org already holding these bytes gets that stack back, `duplicate`.
 * 2. `queueSplit` — the browser says the PUT finished; the row moves to `queued` and the
 *    `paper_intake_split` job is dispatched, deduplicated on the stack.
 * 3. `splitStack`, on the worker — download, check the bytes are the ones registered, find the cover
 *    sheets and blank pages (`scanStack`), cut the pieces (`planParts`), store each piece as its own
 *    PDF, and record them. PI3 reads the pieces.
 *
 * ── IDEMPOTENT ───────────────────────────────────────────────────────────────────────────────────
 * A lease can expire on a slow-but-alive split. A `split` stack is left as it is; any other is split
 * again from its original bytes: piece objects are written with `upsert` (the same pages, the same
 * key), and the stack's pieces are deleted and re-inserted together, so a retry never leaves half a
 * set. Pieces are work items, not evidence; nothing PI3 builds on them exists until the stack is `split`.
 */

export const PAPER_INTAKE_BUCKET = "paper-intake";
const stackPath = (orgId: string, stackId: string) => `${orgId}/${stackId}/stack.pdf`;
const partPath = (orgId: string, stackId: string, index: number) => `${orgId}/${stackId}/part-${String(index).padStart(3, "0")}.pdf`;

export type PaperIntakeError = { code: "query_failed" | "sign_failed" | "not_found" | "not_uploadable"; error: string };
const fail = (code: PaperIntakeError["code"], error: string): PaperIntakeError => ({ code, error });

async function stackBySha(admin: SupabaseClient, orgId: string, sha256: string): Promise<{ id: string; status: PaperStackStatus } | null> {
  const { data, error } = await admin.from("paper_intake_stacks").select("id, status").eq("org_id", orgId).eq("sha256", sha256).maybeSingle();
  if (error) throw new Error(`paper_intake_stacks: ${error.message}`);
  return (data as { id: string; status: PaperStackStatus } | null) ?? null;
}

async function signUpload(admin: SupabaseClient, orgId: string, stackId: string): Promise<PaperStackRegisterResponse | PaperIntakeError> {
  const signed = await admin.storage.from(PAPER_INTAKE_BUCKET).createSignedUploadUrl(stackPath(orgId, stackId), { upsert: true });
  if (signed.error || !signed.data) return fail("sign_failed", signed.error?.message ?? "The upload could not be started.");
  return { stackId, uploadUrl: signed.data.signedUrl, duplicate: false };
}

export async function registerStack(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null,
  req: PaperStackRegisterRequest,
  newId: () => string = randomUUID,
): Promise<PaperStackRegisterResponse | PaperIntakeError> {
  try {
    const existing = await stackBySha(admin, orgId, req.sha256);
    // The same bytes again. A stack that never finished uploading, or failed, is offered the upload
    // again under its own id — the failure text says "upload it again", so that must work; any other
    // is the duplicate it is, and the page shows the first one.
    if (existing && (existing.status === "uploading" || existing.status === "failed")) {
      const reset = await admin
        .from("paper_intake_stacks")
        .update({ status: "uploading", failure_code: null, batch_id: req.batchId, file_name: req.fileName })
        .eq("org_id", orgId)
        .eq("id", existing.id);
      if (reset.error) return fail("query_failed", reset.error.message);
      return signUpload(admin, orgId, existing.id);
    }
    if (existing) return { stackId: existing.id, uploadUrl: null, duplicate: true };
    const stackId = newId();
    const { error } = await admin.from("paper_intake_stacks").insert({
      id: stackId,
      org_id: orgId,
      batch_id: req.batchId,
      file_name: req.fileName,
      sha256: req.sha256,
      byte_size: req.bytes,
      uploaded_by: userId,
    });
    if (error) {
      // Two drops of the same file racing: the loser reads the winner's stack.
      if (error.code === "23505") {
        const raced = await stackBySha(admin, orgId, req.sha256);
        if (raced) return { stackId: raced.id, uploadUrl: null, duplicate: true };
      }
      return fail("query_failed", error.message);
    }
    return signUpload(admin, orgId, stackId);
  } catch (e) {
    return fail("query_failed", (e as Error).message);
  }
}

/** The upload finished: mark it queued for the split. "already" when it is queued, splitting or split. */
export async function markQueued(admin: SupabaseClient, orgId: string, stackId: string): Promise<"queued" | "already" | PaperIntakeError> {
  const { data, error } = await admin.from("paper_intake_stacks").select("status").eq("org_id", orgId).eq("id", stackId).maybeSingle();
  if (error) return fail("query_failed", error.message);
  if (!data) return fail("not_found", "That upload is not on file.");
  const status = (data as { status: PaperStackStatus }).status;
  if (status === "failed") return fail("not_uploadable", "That upload failed. Upload the file again.");
  if (status !== "uploading") return "already";
  const upd = await admin.from("paper_intake_stacks").update({ status: "queued" }).eq("org_id", orgId).eq("id", stackId).eq("status", "uploading");
  if (upd.error) return fail("query_failed", upd.error.message);
  return "queued";
}

async function setStatus(admin: SupabaseClient, orgId: string, stackId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("paper_intake_stacks").update(patch).eq("org_id", orgId).eq("id", stackId);
  if (error) throw new Error(`paper_intake_stacks: ${error.message}`);
}

const failWith = (admin: SupabaseClient, orgId: string, stackId: string, code: PaperStackFailure) =>
  setStatus(admin, orgId, stackId, { status: "failed", failure_code: code }).then(() => ({ outcome: "failed" as const, failure: code }));

/** Of the driver ids the cover sheets name, the ones on this org's roster. A sheet naming anyone else owns nothing. */
async function rosterIds(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunks([...new Set(ids)])) {
    const { data, error } = await admin.from("drivers").select("id").eq("org_id", orgId).in("id", part);
    if (error) throw new Error(`drivers: ${error.message}`);
    for (const d of (data ?? []) as Array<{ id: string }>) found.add(d.id);
  }
  return found;
}

export type SplitOutcome =
  | { outcome: "failed"; failure: PaperStackFailure }
  | { outcome: "split"; pageCount: number; coverSheets: number; blankPages: number; parts: number; unknownSheets: number }
  | { outcome: "skipped"; reason: string };

export async function splitStack(admin: SupabaseClient, orgId: string, stackId: string, now: () => Date = () => new Date()): Promise<SplitOutcome> {
  const { data, error } = await admin.from("paper_intake_stacks").select("id, status, sha256").eq("org_id", orgId).eq("id", stackId).maybeSingle();
  if (error) throw new Error(`paper_intake_stacks: ${error.message}`);
  const row = data as { id: string; status: PaperStackStatus; sha256: string } | null;
  if (!row) return { outcome: "skipped", reason: "no such stack" };
  if (row.status === "split" || row.status === "failed") return { outcome: "skipped", reason: `already ${row.status}` };
  await setStatus(admin, orgId, stackId, { status: "splitting" });

  const download = await admin.storage.from(PAPER_INTAKE_BUCKET).download(stackPath(orgId, stackId));
  if (download.error || !download.data) return failWith(admin, orgId, stackId, "not_uploaded");
  const bytes = Buffer.from(await download.data.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) return failWith(admin, orgId, stackId, "bytes_changed");

  const scan = await scanStack(bytes, PAPER_STACK_MAX_PAGES);
  if (!scan.ok) return failWith(admin, orgId, stackId, scan.code);

  const onRoster = await rosterIds(admin, orgId, scan.sheets.map((s) => s.driverId));
  const known = scan.sheets.filter((s) => onRoster.has(s.driverId));
  // A sheet naming a driver not on this roster (merged away, or another carrier's sheet) still ENDS the
  // previous driver's run: its pages become nobody's, never the previous driver's. So it stays in the
  // plan as a boundary, under a driver id the plan then treats as unknown.
  const UNKNOWN = "00000000-0000-0000-0000-000000000000";
  const plan = planParts(
    scan.pageCount,
    scan.sheets.map((s) => (onRoster.has(s.driverId) ? s : { page: s.page, driverId: UNKNOWN })),
    new Set(scan.blankPages),
  ).map((p) => (p.driverId === UNKNOWN ? { ...p, driverId: null, basis: "none" as const } : p));

  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const rows: Array<Record<string, unknown>> = [];
  for (const [index, part] of plan.entries()) {
    const piece = await PDFDocument.create();
    for (const page of await piece.copyPages(source, part.pages.map((n) => n - 1))) piece.addPage(page);
    const pieceBytes = Buffer.from(await piece.save());
    const path = partPath(orgId, stackId, index);
    const up = await admin.storage.from(PAPER_INTAKE_BUCKET).upload(path, pieceBytes, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(`paper-intake upload: ${up.error.message}`);
    rows.push({
      org_id: orgId,
      stack_id: stackId,
      part_index: index,
      driver_id: part.driverId,
      basis: part.basis,
      stack_pages: part.pages,
      object_path: path,
      sha256: createHash("sha256").update(pieceBytes).digest("hex"),
    });
  }

  const del = await admin.from("paper_intake_parts").delete().eq("org_id", orgId).eq("stack_id", stackId);
  if (del.error) throw new Error(`paper_intake_parts: ${del.error.message}`);
  if (rows.length) {
    const ins = await admin.from("paper_intake_parts").insert(rows);
    if (ins.error) throw new Error(`paper_intake_parts: ${ins.error.message}`);
  }
  await setStatus(admin, orgId, stackId, {
    status: "split",
    page_count: scan.pageCount,
    cover_sheet_count: known.length,
    blank_page_count: scan.blankPages.length,
    split_at: now().toISOString(),
  });
  return {
    outcome: "split",
    pageCount: scan.pageCount,
    coverSheets: known.length,
    blankPages: scan.blankPages.length,
    parts: rows.length,
    unknownSheets: scan.sheets.length - known.length,
  };
}

/** One drop's stacks with their pieces, for the upload page (PI2) and review (PI4). */
export async function listBatch(admin: SupabaseClient, orgId: string, batchId: string): Promise<PaperStackDto[]> {
  const stacks = await admin
    .from("paper_intake_stacks")
    .select("id, batch_id, file_name, status, failure_code, page_count, cover_sheet_count, blank_page_count, created_at")
    .eq("org_id", orgId)
    .eq("batch_id", batchId)
    .order("created_at");
  if (stacks.error) throw new Error(`paper_intake_stacks: ${stacks.error.message}`);
  const list = (stacks.data ?? []) as Array<{
    id: string; batch_id: string; file_name: string; status: PaperStackStatus; failure_code: string | null;
    page_count: number | null; cover_sheet_count: number | null; blank_page_count: number | null; created_at: string;
  }>;
  if (!list.length) return [];

  const parts = await admin
    .from("paper_intake_parts")
    .select("stack_id, part_index, driver_id, basis, stack_pages")
    .eq("org_id", orgId)
    .in("stack_id", list.map((s) => s.id))
    .order("part_index");
  if (parts.error) throw new Error(`paper_intake_parts: ${parts.error.message}`);
  const partRows = (parts.data ?? []) as Array<{ stack_id: string; part_index: number; driver_id: string | null; basis: "cover_sheet" | "none"; stack_pages: number[] }>;

  const names = new Map<string, string>();
  for (const part of chunks([...new Set(partRows.flatMap((p) => (p.driver_id ? [p.driver_id] : [])))])) {
    const { data, error } = await admin.from("drivers").select("id, full_name").eq("org_id", orgId).in("id", part);
    if (error) throw new Error(`drivers: ${error.message}`);
    for (const d of (data ?? []) as Array<{ id: string; full_name: string }>) names.set(d.id, d.full_name);
  }

  return list.map((s) => ({
    id: s.id,
    batchId: s.batch_id,
    fileName: s.file_name,
    status: s.status,
    failure: s.failure_code ? (PAPER_STACK_FAILURES[s.failure_code as PaperStackFailure] ?? s.failure_code) : null,
    pageCount: s.page_count,
    coverSheetCount: s.cover_sheet_count,
    blankPageCount: s.blank_page_count,
    createdAt: s.created_at,
    parts: partRows
      .filter((p) => p.stack_id === s.id)
      .map((p) => ({
        partIndex: p.part_index,
        driverId: p.driver_id,
        driverName: p.driver_id ? (names.get(p.driver_id) ?? null) : null,
        basis: p.basis,
        stackPages: p.stack_pages,
      })),
  }));
}
