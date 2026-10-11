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

/** Classify `todo` — pages with no verdict yet — one model call each, writing each answer to the ledger. */
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
  for (const p of todo) {
    const { data: blob, error } = await admin.storage.from(DOCUMENT_BUCKET).download(p.original_path);
    if (error || !blob) continue;
    const png = Buffer.from(await blob.arrayBuffer());
    if (createHash("sha256").update(png).digest("hex") !== p.original_sha256) continue;
    const sent = await sentCopyOf(png, limits);
    const res = await classifyPage({ base64: sent.bytes.toString("base64"), mediaType: sent.mediaType }, model, client);
    inputTokens += res.usage.input;
    outputTokens += res.usage.output;
    if (res.kind !== "ok") continue;
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
  return { verdicts, inputTokens, outputTokens };
}
