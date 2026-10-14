import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceKind, EvidenceTemporalClass } from "@silvicom/shared";
import type { SamsaraRawAnswer } from "../../samsara/index.js";

/**
 * Freezes one Samsara answer around a roadside inspection (INSPECTION-CHALLENGE-PLAN D-IC4; 0473).
 *
 * ── THE BYTES, HASHED AS RECEIVED ──────────────────────────────────────────────────────────────
 * One page (every answer measured so far) is stored exactly as Samsara sent it. Several pages are
 * stored as `[page1,page2,…]` — each page a JSON object, so the result is a valid JSON array whose
 * every byte inside the brackets is a byte Samsara sent. The sha256 is over that, BEFORE gzip; the
 * object is gzipped in the private `inspection-evidence` bucket under the org's own prefix.
 *
 * The object's name carries the hash, so freezing the same answer twice writes one object (Storage's
 * "already exists" is success here) and two rows that agree.
 *
 * ── WHAT IS IN A DVIR ANSWER ───────────────────────────────────────────────────────────────────
 * Samsara's DVIRs carry walk-around photo links that are signed for 24 hours. They are kept as
 * received — the bytes are the evidence — but they will not open after a day: freezing the photos
 * themselves is a later step's, not this one's.
 */
export const EVIDENCE_BUCKET = "inspection-evidence";

export interface FreezeInput {
  orgId: string;
  inspectionId: string;
  kind: EvidenceKind;
  temporalClass: EvidenceTemporalClass;
  path: string;
  params: Record<string, string>;
  window: { startMs: number; endMs: number };
  answer: SamsaraRawAnswer;
  retrievedAt: string;
  itemCount: number;
  summary: Record<string, unknown>;
}

/** The stored object's bytes for an answer: the page itself, or the pages as one JSON array. */
export const answerBytes = (a: SamsaraRawAnswer): string => (a.pages.length === 1 ? a.pages[0]! : `[${a.pages.join(",")}]`);

export async function freezeAnswer(admin: SupabaseClient, f: FreezeInput): Promise<{ id: string; sha256: string }> {
  const bytes = Buffer.from(answerBytes(f.answer), "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storagePath = `${f.orgId}/${f.inspectionId}/${f.kind}-${sha256}.json.gz`;
  const up = await admin.storage
    .from(EVIDENCE_BUCKET)
    .upload(storagePath, gzipSync(bytes), { contentType: "application/gzip", upsert: false });
  if (up.error && !/exists|duplicate/i.test(up.error.message)) throw new Error(`evidence upload failed: ${up.error.message}`);

  const row = await admin
    .from("inspection_evidence_snapshots")
    .insert({
      org_id: f.orgId,
      inspection_id: f.inspectionId,
      kind: f.kind,
      temporal_class: f.temporalClass,
      source_endpoint: f.path,
      request: f.params,
      window_start: new Date(f.window.startMs).toISOString(),
      window_end: new Date(f.window.endMs).toISOString(),
      retrieved_at: f.retrievedAt,
      http_status: f.answer.status,
      sha256,
      byte_size: bytes.length,
      storage_path: storagePath,
      item_count: f.itemCount,
      summary: { ...f.summary, pages: f.answer.pages.length, complete: f.answer.complete },
    })
    .select("id")
    .single();
  if (row.error) throw new Error(`evidence row failed: ${row.error.message}`);
  return { id: (row.data as { id: string }).id, sha256 };
}

/** Every `data` item across an answer's pages; none when a page is not JSON or Samsara refused. */
export function dataOf(a: SamsaraRawAnswer): Record<string, unknown>[] {
  if (a.status < 200 || a.status >= 300) return [];
  return a.pages.flatMap((p) => {
    try {
      const d = (JSON.parse(p) as { data?: unknown }).data;
      return Array.isArray(d) ? (d as Record<string, unknown>[]) : [];
    } catch {
      return [];
    }
  });
}
