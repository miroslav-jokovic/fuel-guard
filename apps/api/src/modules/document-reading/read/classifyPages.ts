import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PageClass, PageRotation } from "@silvicom/shared";
import { classifyPage, CLASSIFY_PROMPT } from "../model/classifyPage.js";
import type { ModelClient } from "../model/readPages.js";
import { sendLimitsFor } from "../model/visionTier.js";
import { sentCopyOf } from "../pages/canonical.js";
import { DOCUMENT_BUCKET } from "../storage.js";

/**
 * P2 inside a read (§7A.3): the current verdict of every page the read was given, classifying — once, ever
 * — each page that has none. A verdict is a `document_page_classes` row, so a page classified for one read
 * is classified for every later read and for the review screen, and a dispatcher's override (a newer row)
 * wins over it. This runs in the read and not at intake on purpose: a page is classified when somebody
 * wants it read, and its tokens are the read's, counted once by the read's terminal transition (0451) —
 * no second usage path. When Layer 1 proposes assemblies itself (P7), classification moves to intake.
 *
 * A page whose original fails its hash is NOT classified here: the read's own integrity check fails it
 * with `integrity_mismatch`, and a verdict about bytes nobody can vouch for would outlive that failure.
 */

export interface PageVerdict {
  pageClass: PageClass;
  /** Null when the verdict did not answer it (a person's class-only override, a verdict before 0456). */
  rotation: PageRotation | null;
}

interface PageRef {
  id: string;
  original_path: string;
  original_sha256: string;
}

export async function currentVerdicts(admin: SupabaseClient, orgId: string, pageIds: readonly string[]): Promise<Map<string, PageVerdict>> {
  if (pageIds.length === 0) return new Map();
  const { data, error } = await admin.rpc("document_page_current_class", { p_org: orgId, p_pages: pageIds });
  if (error) throw new Error(`document_page_current_class: ${error.message}`);
  return new Map(((data ?? []) as { page_id: string; page_class: PageClass; rotation?: PageRotation | null }[])
    .map((c) => [c.page_id, { pageClass: c.page_class, rotation: c.rotation ?? null }]));
}

export interface ClassifyOutcome {
  /** The verdicts written now, by page — a page the classifier could not answer is absent. */
  verdicts: Map<string, PageVerdict>;
  inputTokens: number;
  outputTokens: number;
}

/**
 * How many pages are classified at once. One at a time cost a 13-page BOL 89 s of its 4 min 44 s (read
 * 795bf4bc, 2026-10-15: ~7 s a page, back to back); eight at once is one round for any single file
 * (INTAKE_LIMITS.maxPages is 10) and keeps a long assembly's burst well inside the classifier's rate limit.
 */
export const CLASSIFY_AT_ONCE = 8;

type SentImage = Awaited<ReturnType<typeof sentCopyOf>>;

/** The copy the classifier sees of a page, or null when its original is gone or no longer hashes (see above). */
async function classifyCopyOf(admin: SupabaseClient, p: PageRef, limits: ReturnType<typeof sendLimitsFor>): Promise<SentImage | null> {
  const { data: blob, error } = await admin.storage.from(DOCUMENT_BUCKET).download(p.original_path);
  if (error || !blob) return null;
  const png = Buffer.from(await blob.arrayBuffer());
  if (createHash("sha256").update(png).digest("hex") !== p.original_sha256) return null;
  return sentCopyOf(png, limits);
}

/**
 * Classify `todo` — pages with no verdict yet — one model call each, `CLASSIFY_AT_ONCE` at a time, writing
 * each answer to the ledger in page order. A transient failure of one call (429, 5xx) is rethrown for the
 * queue's retry only after its siblings' answers are written: they were paid for, and the retry then asks
 * only about the pages still without a verdict.
 */
export async function classifyPages(
  admin: SupabaseClient,
  orgId: string,
  todo: readonly PageRef[],
  model: string,
  client: ModelClient,
): Promise<ClassifyOutcome> {
  const verdicts = new Map<string, PageVerdict>();
  let inputTokens = 0;
  let outputTokens = 0;
  // One page per request: the classifier judges each photo on its own, and a page is one image whatever
  // the assembly's length, so the standard limits for a single image apply.
  const limits = sendLimitsFor(model, 1);
  for (let i = 0; i < todo.length; i += CLASSIFY_AT_ONCE) {
    const batch = todo.slice(i, i + CLASSIFY_AT_ONCE);
    const copies = await Promise.all(batch.map((p) => classifyCopyOf(admin, p, limits)));
    const answers = await Promise.allSettled(copies.map((c) =>
      c ? classifyPage({ base64: c.bytes.toString("base64"), mediaType: c.mediaType }, model, client) : Promise.resolve(null)));
    let transient: unknown = null;
    for (const [k, settled] of answers.entries()) {
      if (settled.status === "rejected") { transient ??= settled.reason; continue; }
      const res = settled.value;
      if (!res) continue;
      inputTokens += res.usage.input;
      outputTokens += res.usage.output;
      if (res.kind !== "ok") continue;
      const p = batch[k]!;
      const { error: iErr } = await admin.from("document_page_classes").insert({
        org_id: orgId,
        page_id: p.id,
        page_class: res.pageClass,
        set_by: "classifier",
        model: res.model,
        prompt_version: CLASSIFY_PROMPT.version,
        rotation: res.rotation,
      });
      if (iErr) throw new Error(`document_page_classes: ${iErr.message}`);
      verdicts.set(p.id, { pageClass: res.pageClass, rotation: res.rotation });
    }
    if (transient !== null) throw transient;
  }
  return { verdicts, inputTokens, outputTokens };
}
