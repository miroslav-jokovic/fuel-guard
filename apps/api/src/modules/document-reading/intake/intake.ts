import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreateSourceRequest,
  CreateSourceResponse,
  DocumentProfileId,
  IntakeRefusalCode,
  SourceStatusResponse,
} from "@silvicom/shared";
import { normaliseSource, NORMALISER_VERSION, type CanonicalPage, type NormaliseOutcome } from "../pages/index.js";
import { FORMAT_MIMES } from "../pages/sniff.js";
import { requestRead, type DispatchRead, type ReaderError } from "../read/requests.js";
import { DOCUMENT_BUCKET, pageObjectPaths, sourceObjectPath } from "../storage.js";

/**
 * INTAKE for office uploads (DOCUMENT-READER-PLAN Step 1.6b; §2's first box). Three steps, because
 * `document_sources` is append-only with a NOT NULL `page_count`, and a page count exists only once the
 * file has been rendered:
 *
 *   1. `registerUpload` — no row. An id, and a signed PUT URL for `<org>/<id>/source-<sha256>`; or,
 *      when the org already holds these exact bytes (`unique (org_id, sha256)`, D-DR12), that source.
 *   2. the browser PUTs the bytes to Storage directly; they never pass through the API (the reason
 *      `inventory/photos.ts` gives — no multipart body on a process that also runs the schedulers).
 *   3. `runIntake`, on the worker as the `document_intake` job: download, check the bytes against the
 *      SHA-256 in the key, render them (`normaliseSource`, the PDF on pdf.js — CPU the request path must
 *      not spend), store each page's original and working copy, insert the source and its pages, and,
 *      when the caller named a profile, queue the read.
 *
 * Nothing is half-written in a way a retry cannot finish: page objects are written with `upsert` (the
 * same bytes, deterministically rendered, under the same key), the source row is inserted once and found
 * by id on a retry, and pages are inserted only for page numbers not yet stored.
 */

type IntakeError = Pick<ReaderError, "error"> & { code: "sign_failed" | "query_failed" };
const fail = (code: IntakeError["code"], error: string): IntakeError => ({ code, error });

async function sourceBySha(admin: SupabaseClient, orgId: string, sha256: string): Promise<{ id: string; page_count: number } | null> {
  const { data, error } = await admin
    .from("document_sources").select("id, page_count").eq("org_id", orgId).eq("sha256", sha256).maybeSingle();
  if (error) throw new Error(`document_sources: ${error.message}`);
  return (data as { id: string; page_count: number } | null) ?? null;
}

export async function registerUpload(
  admin: SupabaseClient,
  orgId: string,
  req: CreateSourceRequest,
  newId: () => string = randomUUID,
): Promise<CreateSourceResponse | IntakeError> {
  let existing: { id: string } | null;
  try {
    existing = await sourceBySha(admin, orgId, req.sha256);
  } catch (e) {
    return fail("query_failed", (e as Error).message);
  }
  if (existing) return { sourceId: existing.id, uploadUrl: null, duplicate: true };
  const sourceId = newId();
  const { data, error } = await admin.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(sourceObjectPath(orgId, sourceId, req.sha256));
  if (error || !data) return fail("sign_failed", error?.message ?? "The upload could not be started.");
  return { sourceId, uploadUrl: data.signedUrl, duplicate: false };
}

export interface IntakeJob {
  sourceId: string;
  sha256: string;
  profile: DocumentProfileId | null;
  requestedBy: string | null;
}

/** The `document_intake` job's stats — what `sourceStatus` reads back while no source row exists. */
export type IntakeOutcome =
  | { outcome: "refused"; refusal: IntakeRefusalCode }
  | { outcome: "ready"; sourceId: string; pageCount: number; readId: string | null };

export interface IntakeDeps {
  dispatchRead: DispatchRead;
  normalise?: (bytes: Buffer, mime: string) => Promise<NormaliseOutcome>;
}

async function storedPageNumbers(admin: SupabaseClient, orgId: string, sourceId: string): Promise<Set<number>> {
  const { data, error } = await admin.from("document_pages").select("page_number").eq("org_id", orgId).eq("source_id", sourceId);
  if (error) throw new Error(`document_pages: ${error.message}`);
  return new Set(((data ?? []) as { page_number: number }[]).map((p) => p.page_number));
}

async function storePages(admin: SupabaseClient, orgId: string, sourceId: string, pages: readonly CanonicalPage[], have: Set<number>): Promise<void> {
  const rows = [];
  for (const p of pages) {
    if (have.has(p.page)) continue;
    const paths = pageObjectPaths(orgId, sourceId, p.page);
    for (const [path, bytes, contentType] of [[paths.original, p.original.png, "image/png"], [paths.working, p.working.bytes, p.working.mediaType]] as const) {
      // upsert: a retry re-renders the same bytes (the stage is deterministic) under the same key.
      const { error } = await admin.storage.from(DOCUMENT_BUCKET).upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`storage ${path}: ${error.message}`);
    }
    rows.push({
      org_id: orgId,
      source_id: sourceId,
      page_number: p.page,
      original_path: paths.original,
      original_sha256: p.original.sha256,
      working_path: paths.working,
      width: p.original.width,
      height: p.original.height,
      normaliser_version: NORMALISER_VERSION,
      text_layer: p.textLayer,
      // The DPI a PDF page was rendered at (pdf.ts caps it for oversized pages); null for a photo.
      capture_metrics: p.dpi === null ? null : { renderDpi: p.dpi },
    });
  }
  if (rows.length === 0) return;
  const { error } = await admin.from("document_pages").insert(rows);
  if (error) throw new Error(`document_pages: ${error.message}`);
}

/**
 * Render a registered upload into a source and its pages. Throws on an infrastructure failure (the
 * queue retries); RETURNS a refusal when the file itself is the problem, so the job ends `done` with
 * the refusal in its stats and is never retried — re-rendering bytes that cannot be read reads nothing.
 */
export async function runIntake(admin: SupabaseClient, orgId: string, job: IntakeJob, deps: IntakeDeps): Promise<IntakeOutcome> {
  const normalise = deps.normalise ?? normaliseSource;
  const { data: own, error } = await admin
    .from("document_sources").select("id, page_count").eq("org_id", orgId).eq("id", job.sourceId).maybeSingle();
  if (error) throw new Error(`document_sources: ${error.message}`);
  // By id: this intake's own earlier attempt. By hash: the same bytes registered twice before either
  // finished — the second becomes the first, as registration would have answered had it come later.
  const existing = (own as { id: string; page_count: number } | null) ?? (await sourceBySha(admin, orgId, job.sha256));
  const sourceId = existing?.id ?? job.sourceId;
  const have = existing ? await storedPageNumbers(admin, orgId, sourceId) : new Set<number>();
  let pageCount = existing?.page_count ?? 0;

  if (!existing || have.size < existing.page_count) {
    const key = sourceObjectPath(orgId, job.sourceId, job.sha256);
    const { data: blob, error: dErr } = await admin.storage.from(DOCUMENT_BUCKET).download(key);
    if (dErr || !blob) {
      // Only "the object is not there" is the sender's; any other Storage error is ours, and retried.
      if (dErr && !/not.?found|does not exist|404/i.test(dErr.message)) throw new Error(`storage ${key}: ${dErr.message}`);
      return { outcome: "refused", refusal: "upload_missing" };
    }
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== job.sha256) return { outcome: "refused", refusal: "hash_mismatch" };
    // The declared mime is not stored with the object; the sniff decides the format either way.
    const out = await normalise(bytes, "application/octet-stream");
    if (!out.ok) return { outcome: "refused", refusal: out.code };
    if (!existing) {
      const { error: iErr } = await admin.from("document_sources").insert({
        id: sourceId,
        org_id: orgId,
        origin: "upload",
        storage_path: key,
        sha256: job.sha256,
        // The sniffed format's canonical mime: the bytes, not the sender's label (D-DR13).
        mime: FORMAT_MIMES[out.format][0],
        byte_size: bytes.length,
        page_count: out.pages.length,
        uploaded_by: job.requestedBy,
      });
      if (iErr) throw new Error(`document_sources: ${iErr.message}`);
      pageCount = out.pages.length;
    }
    await storePages(admin, orgId, sourceId, out.pages, have);
  }

  if (!job.profile) return { outcome: "ready", sourceId, pageCount, readId: null };
  const read = await requestRead(admin, orgId, job.requestedBy, { kind: "source", id: sourceId }, job.profile, deps.dispatchRead, { reuseDone: true });
  if ("code" in read) throw new Error(`document read: ${read.error}`);
  return { outcome: "ready", sourceId, pageCount, readId: read.readId };
}

export const intakeDedupKey = (sourceId: string): string => `document_intake:${sourceId}`;

/**
 * Where an upload stands. A source row means `ready`. Before one exists the answer is the latest
 * `document_intake` job for this id: none → still `uploading` (complete not pressed yet); queued or
 * running → `normalising`; done → its stats (a refusal, or the source it resolved to — a duplicate's
 * is another id); failed → `failed`, ours to own, and pressing complete again starts a new job.
 */
export async function sourceStatus(admin: SupabaseClient, orgId: string, sourceId: string): Promise<SourceStatusResponse | IntakeError> {
  const { data: job, error } = await admin
    .from("jobs").select("status, stats")
    .eq("org_id", orgId).eq("kind", "document_intake").eq("dedup_key", intakeDedupKey(sourceId))
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return fail("query_failed", error.message);
  const j = job as { status: string; stats: Partial<IntakeOutcome> | null } | null;
  const stats = j?.status === "done" ? (j.stats as IntakeOutcome | null) : null;
  const readId = stats?.outcome === "ready" ? stats.readId : null;
  const resolvedId = stats?.outcome === "ready" ? stats.sourceId : sourceId;

  const { data: source, error: sErr } = await admin
    .from("document_sources").select("id, page_count").eq("org_id", orgId).eq("id", resolvedId).maybeSingle();
  if (sErr) return fail("query_failed", sErr.message);
  const base = { sourceId: resolvedId, refusal: null, pageCount: null, readId };
  if (source) return { ...base, status: "ready", pageCount: (source as { page_count: number }).page_count };
  if (stats?.outcome === "refused") return { ...base, status: "refused", refusal: stats.refusal };
  if (!j) return { ...base, status: "uploading" };
  if (j.status === "failed") return { ...base, status: "failed" };
  return { ...base, status: "normalising" };
}
