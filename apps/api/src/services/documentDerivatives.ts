import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DERIVATIVE_CONTENT_TYPE,
  DERIVATIVE_VERSION,
  derivativeStoragePath,
  derivativesFor,
  DOCUMENTS_BUCKET,
  type DerivativeSpec,
  type DocumentContentType,
} from "@fuelguard/shared";

/**
 * Generate and register derivatives for one compliance document (DQF execution plan B2).
 *
 * The numbers live in `packages/shared/src/documentDerivatives.ts` (B1) — this file only applies
 * them. Three properties carry the §390.32(d) weight:
 *
 *   1. A derivative is a NEW `documents` row (0146 has no UPDATE policy), linked by `derived_from`
 *      (0206), with its OWN sha256 (G4) — never the original's, which hashes different bytes.
 *   2. The original is never touched. Not resized, not re-encoded, not deleted (D-DQ10).
 *   3. Idempotent per (original, variant): a retry after a crash re-derives only what is missing,
 *      and a second call on a fully-derived document is a no-op.
 *
 * Failures RETURN rather than throw — the queue handler decides what a failed derivation means for
 * the job; a thrown decode error must never take the worker loop down with it.
 */

export interface DeriveResult {
  created: number;
  skipped: string | null;
}
export interface DeriveError {
  code: "not_found" | "download_failed" | "derive_failed" | "store_failed";
  error: string;
}

interface OriginalRow {
  id: string;
  org_id: string;
  subject_type: string;
  subject_id: string;
  kind: string;
  storage_path: string;
  content_type: string;
  variant: string;
  page: number;
}

/** Pure-ish core: original bytes → derivative bytes per one spec. Split from the I/O so the 200-line
 *  function budget holds and the transform is testable against a real buffer without a bucket. */
export async function deriveBytes(original: Buffer, spec: DerivativeSpec): Promise<Buffer> {
  // `.rotate()` with no args applies EXIF orientation — the one transform B1 allows besides the
  // bounded resize and the encode. `withoutEnlargement` because enlarging invents no information.
  return sharp(original)
    .rotate()
    .resize(spec.longEdgePx, spec.longEdgePx, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: spec.quality })
    .toBuffer();
}

export async function deriveDocument(
  admin: SupabaseClient,
  orgId: string,
  documentId: string,
): Promise<DeriveResult | DeriveError> {
  const { data: rowData, error: rowErr } = await admin
    .from("documents")
    .select("id, org_id, subject_type, subject_id, kind, storage_path, content_type, variant, page")
    .eq("org_id", orgId)
    .eq("id", documentId)
    .maybeSingle();
  if (rowErr) return { code: "not_found", error: rowErr.message };
  const row = rowData as OriginalRow | null;
  if (!row) return { code: "not_found", error: `document ${documentId} not found in this org` };
  // Only originals are derived from — deriving a derivative would compound generation loss.
  if (row.variant !== "original") return { created: 0, skipped: "not an original" };

  const specs = derivativesFor(row.content_type as DocumentContentType);
  if (specs.length === 0) return { created: 0, skipped: "content type not derivable" };

  const { data: existing } = await admin
    .from("documents")
    .select("variant")
    .eq("org_id", orgId)
    .eq("derived_from", documentId);
  const have = new Set(((existing ?? []) as { variant: string }[]).map((d) => d.variant));
  const toRun = specs.filter((s) => !have.has(s.variant));
  if (toRun.length === 0) return { created: 0, skipped: "already derived" };

  const { data: blob, error: dlErr } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .download(row.storage_path);
  if (dlErr || !blob) {
    return { code: "download_failed", error: dlErr?.message ?? "original bytes are missing" };
  }
  const original = Buffer.from(await blob.arrayBuffer());

  let created = 0;
  for (const spec of toRun) {
    let bytes: Buffer;
    try {
      bytes = await deriveBytes(original, spec);
    } catch (e) {
      // The loud failure B1 demands for e.g. a sharp build without HEIC (plan A3) — never a silent
      // skip that would let DERIVABLE_CONTENT_TYPES quietly lie about intent.
      return { code: "derive_failed", error: e instanceof Error ? e.message : "decode failed" };
    }

    const derivativeId = randomUUID();
    const path = derivativeStoragePath(orgId, row.subject_type, row.subject_id, derivativeId, spec.variant);
    const { error: upErr } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      // upsert: a retry of a crash between upload and insert overwrites its own object rather than
      // failing on 409 — the row insert below is what makes the derivative exist.
      .upload(path, bytes, { contentType: DERIVATIVE_CONTENT_TYPE, upsert: true });
    if (upErr) return { code: "store_failed", error: upErr.message };

    const { error: insErr } = await admin.from("documents").insert({
      id: derivativeId,
      org_id: orgId,
      subject_type: row.subject_type,
      subject_id: row.subject_id,
      kind: row.kind,
      storage_path: path,
      content_type: DERIVATIVE_CONTENT_TYPE,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      page: row.page,
      variant: spec.variant,
      captured_at: null,
      uploaded_by: null,
      derived_from: row.id,
    });
    if (insErr) return { code: "store_failed", error: insErr.message };
    created++;
  }

  return { created, skipped: null };
}

/** Stamped into job results so a regenerate pass can tell which ruleset produced what. */
export const DERIVER_VERSION = DERIVATIVE_VERSION;
