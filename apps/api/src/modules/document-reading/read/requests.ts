import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DOCUMENT_PROFILES,
  fieldEvidenceSchema,
  valueAtPath,
  type DocumentProfileId,
  type ReadResponse,
  type ReviewBatchRequest,
} from "@silvicom/shared";
import { workingSizeOf } from "../pages/canonical.js";
import { DOCUMENT_BUCKET, PAGE_URL_TTL_SEC } from "../storage.js";
import { targetColumn, targetIds, targetOfRow, targetPages, type ReadTarget } from "./readTarget.js";

/**
 * The read-side requests behind `/api/documents/reads` (DOCUMENT-READER-PLAN Step 1.6b): queue a read,
 * show one, and record the dispatcher's verdicts on its fields. The queue job that EXECUTES a read is
 * `executeRead.ts`; this file only inserts the `queued` row, enqueues it, and reads rows back.
 *
 * Every query names the org (the service role bypasses RLS, apps/api/CLAUDE.md); a read or source id
 * from another org is "not found", never "forbidden", so an id says nothing about who owns it.
 */

export interface ReaderError {
  code:
    | "not_found" | "not_reviewable" | "invalid_review" | "invalid_assembly" | "edited_elsewhere"
    | "sign_failed" | "query_failed" | "insert_failed";
  error: string;
}
export const isReaderError = (v: unknown): v is ReaderError =>
  typeof v === "object" && v !== null && "code" in v && "error" in v;

export const fail = (code: ReaderError["code"], error: string): ReaderError => ({ code, error });

/** Enqueue the `document_read` job for a read id — `dispatchJob` in the app, a recorder in tests. */
export type DispatchRead = (readId: string) => Promise<unknown>;
/** §2 Queue: "idempotent on read id, dedupe key `document_read:{id}`". */
export const readDedupKey = (readId: string): string => `document_read:${readId}`;

/** A read that is still going: asking again returns it instead of spending a second model call. */
const IN_FLIGHT = ["queued", "reading"] as const;

/**
 * Queue a read of `target` (a source, or since 0455 an assembly) under `profile`, or return the one
 * already queued or reading OF THE SAME TARGET — a read of an assembly is not a read of its first file. A finished
 * read is NOT reused here: a dispatcher asking again after reviewing fields gets a new read, and the
 * cache key's review epoch (§4.6) decides whether that costs anything. `reuseDone` is the intake's
 * variant — a retried intake job must not start a second read of a document it already read.
 */
export async function requestRead(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null,
  target: ReadTarget,
  profile: DocumentProfileId,
  dispatch: DispatchRead,
  opts: { reuseDone?: boolean } = {},
): Promise<{ readId: string; reused: boolean } | ReaderError> {
  const column = targetColumn(target);
  // Two literal tables, not `.from(variable)`: the table gates (lint:boundaries' table-access) read names.
  const parent = target.kind === "source" ? admin.from("document_sources") : admin.from("document_assemblies");
  const { data: found, error: sErr } = await parent.select("id").eq("org_id", orgId).eq("id", target.id).maybeSingle();
  if (sErr) return fail("query_failed", sErr.message);
  if (!found) return fail("not_found", "That document is not in this organization.");

  const reusable: string[] = opts.reuseDone ? [...IN_FLIGHT, "done"] : [...IN_FLIGHT];
  const { data: prior, error: pErr } = await admin
    .from("document_reads").select("id")
    .eq("org_id", orgId).eq(column, target.id).eq("profile", profile).in("status", reusable)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (pErr) return fail("query_failed", pErr.message);
  if (prior) return { readId: (prior as { id: string }).id, reused: true };

  const { data: inserted, error: iErr } = await admin
    .from("document_reads")
    .insert({ org_id: orgId, [column]: target.id, profile, profile_version: DOCUMENT_PROFILES[profile].version, requested_by: userId })
    .select("id").single();
  if (iErr || !inserted) return fail("insert_failed", iErr?.message ?? "The read was not recorded.");
  const readId = (inserted as { id: string }).id;
  // A dispatch that throws leaves a `queued` row with no job. It is not lost: asking again finds it
  // in flight and dispatches nothing, so the fix is the dedupe below, not a compensating delete
  // (`document_reads` has no delete path at all).
  await dispatch(readId);
  return { readId, reused: false };
}

interface ReadRow {
  id: string;
  source_id: string | null;
  assembly_id: string | null;
  profile: DocumentProfileId;
  profile_version: string;
  status: ReadResponse["status"];
  failure_code: ReadResponse["failureCode"];
  result: ReadResponse["result"];
  evidence: unknown;
}
interface PageColumns {
  working_path: string;
  width: number;
  height: number;
}

/**
 * One read as the review screen needs it: status, the document once `done`, its evidence, and every
 * page it was given (its source's, or its assembly's in the assembly's order) with a 5-minute signed URL of its working copy. Every page, not only the ones the
 * profile read: a reviewer who sees "no readable page" must be able to see what WAS sent. Sizes are
 * the working copy's (bboxes are fractions of it); `document_pages` records the original's, and
 * `workingSizeOf` is the resize rule itself, not an estimate of it.
 */
export async function getRead(admin: SupabaseClient, orgId: string, readId: string): Promise<ReadResponse | ReaderError> {
  const { data, error } = await admin
    .from("document_reads")
    .select("id, source_id, assembly_id, profile, profile_version, status, failure_code, result, evidence")
    .eq("org_id", orgId).eq("id", readId).maybeSingle();
  if (error) return fail("query_failed", error.message);
  if (!data) return fail("not_found", "That read is not in this organization.");
  const read = data as ReadRow;

  const target = targetOfRow(read);
  let pages;
  try {
    pages = await targetPages<PageColumns>(admin, orgId, target, "working_path, width, height");
  } catch (e) {
    return fail("query_failed", e instanceof Error ? e.message : String(e));
  }

  const classOf = new Map<string, ReadResponse["pages"][number]["pageClass"]>();
  const urlOf = new Map<string, string>();
  if (pages.length > 0) {
    const { data: classes, error: cErr } = await admin.rpc("document_page_current_class", { p_org: orgId, p_pages: pages.map((p) => p.id) });
    if (cErr) return fail("query_failed", cErr.message);
    for (const c of (classes ?? []) as { page_id: string; page_class: ReadResponse["pages"][number]["pageClass"] }[]) classOf.set(c.page_id, c.page_class);
    // One Storage call for every page (hazmatLoads' D20), not a round trip per page.
    const { data: signed, error: uErr } = await admin.storage.from(DOCUMENT_BUCKET).createSignedUrls(pages.map((p) => p.working_path), PAGE_URL_TTL_SEC);
    if (uErr) return fail("sign_failed", uErr.message);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urlOf.set(s.path, s.signedUrl);
  }
  const missing = pages.find((p) => !urlOf.has(p.working_path));
  // A review screen with a page silently absent is a review of a different document.
  if (missing) return fail("sign_failed", `Page ${missing.position} could not be shown.`);

  return {
    id: read.id,
    ...targetIds(target),
    profile: read.profile,
    profileVersion: read.profile_version,
    status: read.status,
    failureCode: read.failure_code,
    result: read.result,
    evidence: fieldEvidenceSchema.array().parse(read.evidence ?? []),
    pages: pages.map((p) => ({
      page: p.position,
      pageClass: classOf.get(p.id) ?? null,
      url: urlOf.get(p.working_path)!,
      ...workingSizeOf(p.width, p.height),
    })),
  };
}

/**
 * Pure: why a review entry cannot be recorded against `result`, or null when it can. A review is
 * evidence (`document_read_reviews` is append-only and RETENTION_FORBIDDEN, and graduation counts it,
 * D-DR5), so its `oldValue` must be what the read actually said — a client cannot record a correction
 * of a value the reader never gave. A path beyond the document (a line the reader missed, typed in by
 * the reviewer) has no old value: it must say null.
 */
export function reviewEntryProblem(result: unknown, entry: ReviewBatchRequest["reviews"][number]): string | null {
  const read = valueAtPath(result, entry.path);
  if (read !== undefined && read !== null && typeof read === "object" && !Array.isArray(read)) {
    return `${entry.path} is a group of fields, not one field`;
  }
  if (!isDeepStrictEqual(read ?? null, entry.oldValue)) return `${entry.path}: the old value is not what this read gave`;
  if (entry.action === "confirmed" && !isDeepStrictEqual(entry.newValue, entry.oldValue)) return `${entry.path}: a confirmation keeps the value`;
  if (entry.action === "corrected" && isDeepStrictEqual(entry.newValue, entry.oldValue)) return `${entry.path}: a correction changes the value`;
  if (entry.action === "unreadable" && entry.newValue !== null) return `${entry.path}: an unreadable field has no new value`;
  return null;
}

/** Record one review batch (one Calculate press, plan §6) against a finished read. All or nothing. */
export async function recordReviews(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  readId: string,
  batch: ReviewBatchRequest,
): Promise<{ recorded: number } | ReaderError> {
  const { data, error } = await admin
    .from("document_reads").select("id, status, result").eq("org_id", orgId).eq("id", readId).maybeSingle();
  if (error) return fail("query_failed", error.message);
  if (!data) return fail("not_found", "That read is not in this organization.");
  const read = data as { status: string; result: unknown };
  if (read.status !== "done") return fail("not_reviewable", "Only a finished read can be reviewed.");

  const problems = batch.reviews.map((r) => reviewEntryProblem(read.result, r)).filter((p): p is string => p !== null);
  if (problems.length) return fail("invalid_review", problems.slice(0, 5).join("; "));

  const rows = batch.reviews.map((r) => ({
    org_id: orgId,
    read_id: readId,
    field_path: r.path,
    action: r.action,
    old_value: r.oldValue,
    new_value: r.newValue,
    actor: userId,
    consumer: batch.consumer,
  }));
  const { error: iErr } = await admin.from("document_read_reviews").insert(rows);
  if (iErr) return fail("insert_failed", iErr.message);
  return { recorded: rows.length };
}
