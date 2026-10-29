import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENT_PROFILES, withinBudget, type DocumentProfileId, type PageRotation, type ReadFailureCode, type ReadStageTiming, type ReadStageTimings } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { readModels } from "../model/models.js";
import { readPages, SEND_RULE_VERSION, type ModelClient, type PageImage } from "../model/readPages.js";
import { combinedSchemaHash, readSections, sectionWireSchemas } from "../model/readSections.js";
import { sendLimitsFor } from "../model/visionTier.js";
import { schemaHash, wireSchemaFor } from "../model/wireSchema.js";
import { sentCopyOf, type TextLayer } from "../pages/canonical.js";
import { ACCEPTANCE_RULE_VERSION, readCacheKey } from "./cacheKey.js";
import { EVIDENCE_FOR } from "../evidence/index.js";
import { ocrPages, type PageForOcr, type RecognisePage } from "../ocr/pageOcr.js";
import { textLayerPages } from "../evidence/textLayerWitness.js";
import { READ_PROMPTS } from "./prompts.js";
import { classifyPages, currentVerdicts, type PageVerdict } from "./classifyPages.js";
import { reviewEpoch, targetOfRow, targetPages, type ReadTarget, type TargetPage } from "./readTarget.js";
import { DOCUMENT_BUCKET } from "../storage.js";

/**
 * One document read, end to end (Step 1.6): the body of the `document_read` queue job.
 *
 *   gate → pages → classify + orient (P2) → integrity → cache → budget → model → one terminal transition
 *
 * Every outcome is written by `document_read_transition` (0448/0451) and nothing else, so a read ends
 * `done` with its document or `failed` with a READ_FAILURES code — never a silently empty form (§4 item
 * 7). The two exceptions are THROWN, for the queue: a `TransientModelError` (429, 5xx, timeout), which
 * the queue retries with backoff and the handler turns into `model_unavailable` on the last attempt;
 * and a configuration error (a bad key, a retired model id, a schema the API refuses), which no retry
 * mends and which must reach the job's error column rather than pass for a reading failure.
 *
 * Since §7B A2 a finished read records evidence: the profile's witnesses over its document
 * (evidence/index.ts — for the shipping document, the Hazardous Materials Table's verdict on each line).
 * Since A3 a second model (pass B, Sonnet 5.5) reads the same pages and its values are recorded beside pass
 * A's, lines matched by key; the read's document is pass A's — unless the profile has ONE reader (`readers: 1`,
 * UNIT-FILES-PLAN UF7b2), which is read by its own pin alone and reviewed by a person. Since A5 the OCR engine reads the same pages and
 * says which reader's count, weight and quantity is printed on the line's own row; since A4 a born-digital
 * PDF's own text, stored at intake, says the same by the same row rules. What it does NOT do yet, each its own step: the usability gate (`unusable_image`, which needs the shared capture metrics
 * on the page row). Since P2 every page given is classified before the read (classifyPages.ts), and
 * read only when its class is one the profile reads; a page the classifier could not answer is still
 * read — an unknown page is not a known non-BOL. Each read page is sent turned upright by its verdict's
 * rotation (Q-DR19 (a)), and the turn is part of the cache key.
 *
 * Every query names the org: the service role bypasses RLS (apps/api/CLAUDE.md), and the RPCs match on
 * (id, org) so a wrong org finds nothing.
 */


/** The consumer's gate (entitlement + kill switch + monthly budget), injected by the composition root. */
export interface ReadGate {
  open: boolean;
  /** Null = no budget set (unlimited), `withinBudget`'s convention. */
  monthlyTokenBudget: number | null;
}
export type ReadGateFor = (admin: SupabaseClient, orgId: string, profile: DocumentProfileId) => Promise<ReadGate>;

export interface ReadDeps {
  client: ModelClient;
  gateFor: ReadGateFor;
  env: Pick<Env, "DOC_READ_MODEL_A" | "DOC_READ_MODEL_B" | "DOC_FILE_READ_MODEL" | "HAZMAT_MODEL_A" | "HAZMAT_MODEL_B" | "DOC_CLASSIFY_MODEL">;
  /** The OCR witness's engine (§7B A5), or absent for none — the composition root's choice (DOC_OCR_WITNESS). */
  ocr?: RecognisePage;
  /** The month the budget is counted in — injectable so a test does not depend on the clock. */
  now?: () => Date;
  /** A monotonic millisecond clock for the stage timings (TC0.2) — injectable for the same reason. */
  clock?: () => number;
}

export type ExecuteReadOutcome =
  | { outcome: "skipped"; reason: "not_found" | "already_terminal" }
  | { outcome: "done"; cacheHit: boolean; inputTokens: number; outputTokens: number; pages: number; stageTimings: ReadStageTimings }
  | { outcome: "failed"; code: ReadFailureCode; inputTokens: number; outputTokens: number; stageTimings: ReadStageTimings };

interface ReadRow {
  id: string;
  source_id: string | null;
  assembly_id: string | null;
  profile: DocumentProfileId;
  profile_version: string;
  status: string;
}
interface PageColumns {
  original_path: string;
  original_sha256: string;
  normaliser_version: string;
  text_layer: TextLayer | null;
}
type PageRow = TargetPage<PageColumns>;

interface Versions {
  models: string[];
  promptVersion: string;
  schemaHash: string;
  cacheKey: string | null;
}

async function transition(
  admin: SupabaseClient,
  orgId: string,
  readId: string,
  to: "reading" | "done" | "failed",
  fields: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.rpc("document_read_transition", { p_org: orgId, p_read: readId, p_to: to, ...fields });
  if (error) throw new Error(`document_read_transition → ${to}: ${error.message}`);
}

/** The profile's sent schema hash: combined over its sections, or the one schema's. */
function profileSchemaHash(profile: DocumentProfileId): string {
  const p = DOCUMENT_PROFILES[profile];
  if ("sections" in p && p.sections?.length) return combinedSchemaHash(sectionWireSchemas(profile).map((s) => [s.name, s.hash] as const));
  return schemaHash(wireSchemaFor(p.schema));
}

/** The pages this profile reads, in document order (see the header for the unclassified rule). */
function readablePages(pages: readonly PageRow[], verdicts: ReadonlyMap<string, PageVerdict>, profile: DocumentProfileId): PageRow[] {
  const reads: readonly string[] = DOCUMENT_PROFILES[profile].readsPageClasses;
  return pages.filter((p) => {
    const v = verdicts.get(p.id);
    return v === undefined || reads.includes(v.pageClass);
  });
}

/**
 * Download each page's original, verify it, and derive the copy the model reads — sized once, from the
 * original, to the model's resolution tier (D-DR16), so the API never resizes it again. The verified
 * original is kept for the OCR witness, which reads it at full resolution (ocr/pageOcr.ts).
 */
async function loadImages(
  admin: SupabaseClient,
  pages: readonly PageRow[],
  model: string,
  rotationOf: (pageId: string) => PageRotation,
): Promise<{ images: PageImage[]; originals: PageForOcr[] } | "integrity_mismatch"> {
  const limits = sendLimitsFor(model, pages.length);
  // Every page at once: a 13-page assembly fetched one by one waited on 13 round trips to Storage.
  const loaded = await Promise.all(pages.map(async (p) => {
    const { data: blob, error } = await admin.storage.from(DOCUMENT_BUCKET).download(p.original_path);
    // A missing object is a stored page that no longer matches what was received — the same failure.
    if (error || !blob) return null;
    const png = Buffer.from(await blob.arrayBuffer());
    if (createHash("sha256").update(png).digest("hex") !== p.original_sha256) return null;
    const sent = await sentCopyOf(png, limits, rotationOf(p.id));
    return { image: { base64: sent.bytes.toString("base64"), mediaType: sent.mediaType }, original: { originalPng: png, rotation: rotationOf(p.id) } };
  }));
  if (loaded.some((l) => l === null)) return "integrity_mismatch";
  const images: PageImage[] = loaded.map((l) => l!.image);
  const originals: PageForOcr[] = loaded.map((l) => l!.original);
  return { images, originals };
}

async function cachedResult(admin: SupabaseClient, orgId: string, readId: string, cacheKey: string): Promise<{ result: unknown; evidence: unknown } | undefined> {
  const { data, error } = await admin
    .from("document_reads")
    .select("id, result, evidence")
    .eq("org_id", orgId)
    .eq("cache_key", cacheKey)
    .eq("status", "done")
    .neq("id", readId)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`document_reads cache: ${error.message}`);
  const row = data as { result: unknown; evidence: unknown } | null;
  return row && row.result != null ? { result: row.result, evidence: row.evidence ?? [] } : undefined;
}

async function tokensUsedThisMonth(admin: SupabaseClient, orgId: string, now: Date): Promise<number> {
  const { data, error } = await admin
    .from("org_usage_month")
    .select("input_tokens, output_tokens")
    .eq("org_id", orgId)
    .eq("yyyymm", now.toISOString().slice(0, 7))
    .maybeSingle();
  if (error) throw new Error(`org_usage_month: ${error.message}`);
  const row = data as { input_tokens: number; output_tokens: number } | null;
  return row ? Number(row.input_tokens) + Number(row.output_tokens) : 0;
}

export async function executeRead(admin: SupabaseClient, orgId: string, readId: string, deps: ReadDeps): Promise<ExecuteReadOutcome> {
  const { data: row, error } = await admin
    .from("document_reads")
    .select("id, source_id, assembly_id, profile, profile_version, status")
    .eq("org_id", orgId)
    .eq("id", readId)
    .maybeSingle();
  if (error) throw new Error(`document_reads: ${error.message}`);
  const read = row as ReadRow | null;
  if (!read) return { outcome: "skipped", reason: "not_found" };
  if (read.status === "done" || read.status === "failed") return { outcome: "skipped", reason: "already_terminal" };

  const profile = DOCUMENT_PROFILES[read.profile];
  // A read is made under the profile it was queued with (0448 fixes profile_version at insert). A deploy
  // between the click and the worker that changed the profile is a configuration error, not a result.
  if (read.profile_version !== profile.version) {
    throw new Error(`read ${readId} was queued under ${read.profile} ${read.profile_version}; this build reads ${profile.version}`);
  }
  await transition(admin, orgId, readId, "reading");

  // TC0.2 (D-TC4, 0529): every stage's milliseconds, on the row and in the handler's `[metrics]` line, so a slow
  // read says where its time went (1f251e08's 88 s on 2026-10-29 could not). `mark` records the stages finished
  // so far while the read is still reading — the screen words the stage from them (`readStageOf`). It is best
  // effort: a timing that cannot be written is a missing number, never the read's outcome.
  const clock = deps.clock ?? (() => performance.now());
  const timings: ReadStageTimings = {};
  const timed = async <T>(stage: ReadStageTiming, work: Promise<T>): Promise<T> => {
    const t0 = clock();
    try {
      return await work;
    } finally {
      timings[stage] = Math.round(clock() - t0);
    }
  };
  const mark = (): Promise<void> => transition(admin, orgId, readId, "reading", { p_stage_timings: { ...timings } }).catch(() => undefined);

  const prompt = READ_PROMPTS[read.profile];
  const pins = readModels(deps.env, read.profile);
  const models = pins.B === null ? [pins.A] : [pins.A, pins.B];
  const versions: Versions = { models, promptVersion: prompt.version, schemaHash: profileSchemaHash(read.profile), cacheKey: null };
  const fail = async (code: ReadFailureCode, input = 0, output = 0): Promise<ExecuteReadOutcome> => {
    await transition(admin, orgId, readId, "failed", {
      p_failure_code: code,
      p_models: versions.models,
      p_prompt_version: versions.promptVersion,
      p_schema_hash: versions.schemaHash,
      p_acceptance_rule_version: ACCEPTANCE_RULE_VERSION,
      p_cache_key: versions.cacheKey,
      p_input_tokens: input,
      p_output_tokens: output,
      p_stage_timings: { ...timings },
    });
    return { outcome: "failed", code, inputTokens: input, outputTokens: output, stageTimings: { ...timings } };
  };
  // `replay` is what the witnesses were handed (RC2, 0487): pass B's whole document, the OCR words and the
  // text-layer words of the pages read, so the read can be judged again from its own row when the pairing,
  // the witnesses or the audit change. The text layer is kept as judged, not re-derived from
  // `document_pages`: which pages it covers and their turn depend on page verdicts a person may later change.
  // (0487's column comment names { passB, ocr }; `textLayer` was added before the writer first shipped.)
  // A cache hit judged nothing.
  const done = async (result: unknown, evidence: unknown, cacheHit: boolean, input: number, output: number, pages: number, replay: unknown = null): Promise<ExecuteReadOutcome> => {
    await transition(admin, orgId, readId, "done", {
      p_result: result,
      p_evidence: evidence,
      p_models: versions.models,
      p_prompt_version: versions.promptVersion,
      p_schema_hash: versions.schemaHash,
      p_acceptance_rule_version: ACCEPTANCE_RULE_VERSION,
      p_cache_key: versions.cacheKey,
      p_input_tokens: input,
      p_output_tokens: output,
      p_replay_inputs: replay,
      p_stage_timings: { ...timings },
    });
    return { outcome: "done", cacheHit, inputTokens: input, outputTokens: output, pages, stageTimings: { ...timings } };
  };

  // Re-checked here, not only when the read was requested: no model spend once the org is switched off.
  const gate = await deps.gateFor(admin, orgId, read.profile);
  if (!gate.open) return fail("reading_disabled");

  const target: ReadTarget = targetOfRow(read);
  const given = await targetPages<PageColumns>(admin, orgId, target, "original_path, original_sha256, normaliser_version, text_layer");

  // P2 (§7A.3): every page given gets a verdict before anything is read — a class, and which way is up.
  // Only pages with none are sent to the classifier, once ever; that is model spend, so the budget is
  // asked first. Its tokens are this read's, whatever the read's outcome.
  const verdicts = await currentVerdicts(admin, orgId, given.map((p) => p.id));
  const unclassified = given.filter((p) => !verdicts.has(p.id));
  const spent = { input: 0, output: 0 };
  const spend = (u: { input: number; output: number }) => ({ input: spent.input + u.input, output: spent.output + u.output });
  if (unclassified.length > 0) {
    const used = await tokensUsedThisMonth(admin, orgId, deps.now?.() ?? new Date());
    if (!withinBudget(used, gate.monthlyTokenBudget)) return fail("budget_exhausted");
    const c = await timed("classify", classifyPages(admin, orgId, unclassified, deps.env.DOC_CLASSIFY_MODEL, deps.client));
    for (const [id, v] of c.verdicts) verdicts.set(id, v);
    spent.input = c.inputTokens;
    spent.output = c.outputTokens;
  }
  const rotationOf = (id: string): PageRotation => verdicts.get(id)?.rotation ?? 0;

  const pages = readablePages(given, verdicts, read.profile);
  if (pages.length === 0) return fail("no_readable_page", spent.input, spent.output);
  const loaded = await timed("fetch", loadImages(admin, pages, models[0]!, rotationOf));
  if (loaded === "integrity_mismatch") return fail("integrity_mismatch", spent.input, spent.output);
  const { images, originals } = loaded;

  versions.cacheKey = readCacheKey({
    profileVersion: profile.version,
    models,
    promptVersion: prompt.version,
    schemaHash: versions.schemaHash,
    acceptanceRule: ACCEPTANCE_RULE_VERSION,
    pages: pages.map((p) => ({ sha256: p.original_sha256, normaliserVersion: p.normaliser_version, rotation: rotationOf(p.id) })),
    sendRule: SEND_RULE_VERSION,
    reviewEpoch: await reviewEpoch(admin, orgId, given),
  });
  const cached = await cachedResult(admin, orgId, readId, versions.cacheKey);
  // D17's order: a cache hit spends nothing, so it needs no budget to authorise it.
  // The cached read's evidence is replayed with its result: the rule version is in the key, so it was
  // judged by today's rule, and pass B's values cannot be recomputed without pass B's document.
  if (cached !== undefined) return done(cached.result, cached.evidence, true, spent.input, spent.output, pages.length);

  const used = await tokensUsedThisMonth(admin, orgId, deps.now?.() ?? new Date());
  if (!withinBudget(used + spent.input + spent.output, gate.monthlyTokenBudget)) return fail("budget_exhausted", spent.input, spent.output);

  const read1 = (model: string) => {
    const input = { profile: read.profile, pages: images, model, prompt };
    return "sections" in profile && profile.sections?.length ? readSections(input, deps.client) : readPages(input, deps.client);
  };
  // The OCR witness (§7B A5) runs on its own thread while the models read; it costs no tokens, and its
  // failure is its absence, never the read's.
  // Not awaited: a mark is a round trip, and the readers do not wait on the screen's stage text. Each is
  // settled before the next write, so the row's writes stay in order and the terminal move is the last.
  const marked = mark();
  const ocrRun = deps.ocr ? timed("ocr", ocrPages(originals, deps.ocr).catch(() => null)) : Promise.resolve(null);
  // Pass A is the document; pass B is a second, independent witness to it (§7B A3). They are asked AT ONCE.
  // Until 2026-10-15 they ran in turn so that a refusal of A ended the read before B was paid for; that
  // saving is a rare refusal's tokens, and its price was every read's wait doubled — a 13-page BOL spent
  // ~195 s of its 4 min 44 s on the two readers back to back (read 795bf4bc), past the screen's patience.
  // The owner asked for fast (2026-10-15), so a failed A now costs B's tokens too, and they are counted.
  // A one-reader profile (`readers: 1`) asks pass A alone; its second witness is the person who files it.
  const [a, b] = await Promise.all([timed("passA", read1(pins.A)), pins.B === null ? null : timed("passB", read1(pins.B))]);
  const total = { input: spend(a.usage).input + (b?.usage.input ?? 0), output: spend(a.usage).output + (b?.usage.output ?? 0) };
  if (a.kind !== "ok") return marked.then(() => fail(a.kind, total.input, total.output));
  // Pass B failing (refusal, truncation, off-schema) does not fail the read: its fields are one reader's.
  const text = textLayerPages(pages.map((p) => ({ textLayer: p.text_layer, rotation: rotationOf(p.id) })));
  const passB = b?.kind === "ok" ? b.document : null;
  const checking = marked.then(mark);
  const ocr = await ocrRun;
  const e0 = clock();
  const evidence = EVIDENCE_FOR[read.profile](a.document, passB, ACCEPTANCE_RULE_VERSION, ocr, text);
  timings.evidence = Math.round(clock() - e0);
  await checking;
  return done(a.document, evidence, false, total.input, total.output, pages.length, { passB, ocr, textLayer: text });
}

/**
 * The read whose job will never finish it — the queue's last attempt failed, or a failure no retry mends
 * (a bad key, an empty credit balance) — ended `failed: model_unavailable`, an OPERATIONAL failure that is
 * never counted against the reader (READ_FAILURE_KIND). A read still `queued` (its job died before the
 * first transition) passes through `reading`, the only road the state machine (0448) has to `failed`.
 * Answers whether it ended the read; a read already terminal is left as it is.
 */
export async function failUnavailableRead(admin: SupabaseClient, orgId: string, readId: string): Promise<boolean> {
  const { data, error } = await admin.from("document_reads").select("status").eq("org_id", orgId).eq("id", readId).maybeSingle();
  if (error) throw new Error(`document_reads: ${error.message}`);
  const status = (data as { status: string } | null)?.status;
  if (status !== "reading" && status !== "queued") return false;
  if (status === "queued") await transition(admin, orgId, readId, "reading");
  await transition(admin, orgId, readId, "failed", { p_failure_code: "model_unavailable" });
  return true;
}
