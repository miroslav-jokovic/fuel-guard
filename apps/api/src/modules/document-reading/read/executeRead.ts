import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENT_PROFILES, withinBudget, type DocumentProfileId, type ReadFailureCode } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { readModels } from "../model/models.js";
import { readPages, SEND_RULE_VERSION, type ModelClient, type PageImage } from "../model/readPages.js";
import { combinedSchemaHash, readSections, sectionWireSchemas } from "../model/readSections.js";
import { sendLimitsFor } from "../model/visionTier.js";
import { schemaHash, wireSchemaFor } from "../model/wireSchema.js";
import { sentCopyOf } from "../pages/canonical.js";
import { ACCEPTANCE_RULE_VERSION, readCacheKey } from "./cacheKey.js";
import { READ_PROMPTS } from "./prompts.js";
import { DOCUMENT_BUCKET } from "../storage.js";

/**
 * One document read, end to end (Step 1.6): the body of the `document_read` queue job.
 *
 *   gate → pages → integrity → cache → budget → model → one terminal transition
 *
 * Every outcome is written by `document_read_transition` (0448/0451) and nothing else, so a read ends
 * `done` with its document or `failed` with a READ_FAILURES code — never a silently empty form (§4 item
 * 7). The two exceptions are THROWN, for the queue: a `TransientModelError` (429, 5xx, timeout), which
 * the queue retries with backoff and the handler turns into `model_unavailable` on the last attempt;
 * and a configuration error (a bad key, a retired model id, a schema the API refuses), which no retry
 * mends and which must reach the job's error column rather than pass for a reading failure.
 *
 * What it does NOT do yet, each its own step: pass B and the field ledger (Phase 2 — the read records
 * `evidence: []` and only pass A's model, because nothing would read pass B's answer until key
 * alignment, 2.2, lands); the usability gate (`unusable_image`, which needs the shared capture metrics
 * on the page row); and the page classifier (1.5). Until 1.5 a page with NO class is read: an unknown
 * page is not a known non-BOL, and refusing it would make every read before the classifier a
 * `no_readable_page`. A page someone has classed outside the profile's classes is never read.
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
  env: Pick<Env, "DOC_READ_MODEL_A" | "DOC_READ_MODEL_B" | "HAZMAT_MODEL_A" | "HAZMAT_MODEL_B">;
  /** The month the budget is counted in — injectable so a test does not depend on the clock. */
  now?: () => Date;
}

export type ExecuteReadOutcome =
  | { outcome: "skipped"; reason: "not_found" | "already_terminal" }
  | { outcome: "done"; cacheHit: boolean; inputTokens: number; outputTokens: number; pages: number }
  | { outcome: "failed"; code: ReadFailureCode; inputTokens: number; outputTokens: number };

interface ReadRow {
  id: string;
  source_id: string;
  profile: DocumentProfileId;
  profile_version: string;
  status: string;
}
interface PageRow {
  id: string;
  page_number: number;
  original_path: string;
  original_sha256: string;
  normaliser_version: string;
}

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

/** The pages this profile reads, in page order (see the header for the unclassified rule). */
async function readablePages(admin: SupabaseClient, orgId: string, sourceId: string, profile: DocumentProfileId): Promise<PageRow[]> {
  const { data, error } = await admin
    .from("document_pages")
    .select("id, page_number, original_path, original_sha256, normaliser_version")
    .eq("org_id", orgId)
    .eq("source_id", sourceId)
    .order("page_number", { ascending: true });
  if (error) throw new Error(`document_pages: ${error.message}`);
  const pages = (data ?? []) as PageRow[];
  if (pages.length === 0) return [];
  const { data: classes, error: cErr } = await admin.rpc("document_page_current_class", { p_org: orgId, p_pages: pages.map((p) => p.id) });
  if (cErr) throw new Error(`document_page_current_class: ${cErr.message}`);
  const classOf = new Map(((classes ?? []) as { page_id: string; page_class: string }[]).map((c) => [c.page_id, c.page_class]));
  const reads: readonly string[] = DOCUMENT_PROFILES[profile].readsPageClasses;
  return pages.filter((p) => {
    const c = classOf.get(p.id);
    return c === undefined || reads.includes(c);
  });
}

/**
 * Download each page's original, verify it, and derive the copy the model reads — sized once, from the
 * original, to the model's resolution tier (D-DR16), so the API never resizes it again.
 */
async function loadImages(admin: SupabaseClient, pages: readonly PageRow[], model: string): Promise<PageImage[] | "integrity_mismatch"> {
  const limits = sendLimitsFor(model, pages.length);
  const images: PageImage[] = [];
  for (const p of pages) {
    const { data: blob, error } = await admin.storage.from(DOCUMENT_BUCKET).download(p.original_path);
    // A missing object is a stored page that no longer matches what was received — the same failure.
    if (error || !blob) return "integrity_mismatch";
    const png = Buffer.from(await blob.arrayBuffer());
    if (createHash("sha256").update(png).digest("hex") !== p.original_sha256) return "integrity_mismatch";
    const sent = await sentCopyOf(png, limits);
    images.push({ base64: sent.bytes.toString("base64"), mediaType: sent.mediaType });
  }
  return images;
}

/** How many reviews the source's reads hold — the cache key's review epoch (cacheKey.ts). */
async function reviewEpoch(admin: SupabaseClient, orgId: string, sourceId: string): Promise<number> {
  const { data: reads, error } = await admin.from("document_reads").select("id").eq("org_id", orgId).eq("source_id", sourceId);
  if (error) throw new Error(`document_reads: ${error.message}`);
  const ids = ((reads ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return 0;
  const { count, error: rErr } = await admin
    .from("document_read_reviews")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .in("read_id", ids);
  if (rErr) throw new Error(`document_read_reviews: ${rErr.message}`);
  return count ?? 0;
}

async function cachedResult(admin: SupabaseClient, orgId: string, readId: string, cacheKey: string): Promise<unknown | undefined> {
  const { data, error } = await admin
    .from("document_reads")
    .select("id, result")
    .eq("org_id", orgId)
    .eq("cache_key", cacheKey)
    .eq("status", "done")
    .neq("id", readId)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`document_reads cache: ${error.message}`);
  return (data as { result: unknown } | null)?.result ?? undefined;
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
    .select("id, source_id, profile, profile_version, status")
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

  const prompt = READ_PROMPTS[read.profile];
  const models = [readModels(deps.env).A];
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
    });
    return { outcome: "failed", code, inputTokens: input, outputTokens: output };
  };
  const done = async (result: unknown, cacheHit: boolean, input: number, output: number, pages: number): Promise<ExecuteReadOutcome> => {
    await transition(admin, orgId, readId, "done", {
      p_result: result,
      p_evidence: [],
      p_models: versions.models,
      p_prompt_version: versions.promptVersion,
      p_schema_hash: versions.schemaHash,
      p_acceptance_rule_version: ACCEPTANCE_RULE_VERSION,
      p_cache_key: versions.cacheKey,
      p_input_tokens: input,
      p_output_tokens: output,
    });
    return { outcome: "done", cacheHit, inputTokens: input, outputTokens: output, pages };
  };

  // Re-checked here, not only when the read was requested: no model spend once the org is switched off.
  const gate = await deps.gateFor(admin, orgId, read.profile);
  if (!gate.open) return fail("reading_disabled");

  const pages = await readablePages(admin, orgId, read.source_id, read.profile);
  if (pages.length === 0) return fail("no_readable_page");
  const images = await loadImages(admin, pages, models[0]!);
  if (images === "integrity_mismatch") return fail("integrity_mismatch");

  versions.cacheKey = readCacheKey({
    profileVersion: profile.version,
    models,
    promptVersion: prompt.version,
    schemaHash: versions.schemaHash,
    acceptanceRule: ACCEPTANCE_RULE_VERSION,
    pages: pages.map((p) => ({ sha256: p.original_sha256, normaliserVersion: p.normaliser_version })),
    sendRule: SEND_RULE_VERSION,
    reviewEpoch: await reviewEpoch(admin, orgId, read.source_id),
  });
  const cached = await cachedResult(admin, orgId, readId, versions.cacheKey);
  // D17's order: a cache hit spends nothing, so it needs no budget to authorise it.
  if (cached !== undefined) return done(cached, true, 0, 0, pages.length);

  const used = await tokensUsedThisMonth(admin, orgId, deps.now?.() ?? new Date());
  if (!withinBudget(used, gate.monthlyTokenBudget)) return fail("budget_exhausted");

  const input = { profile: read.profile, pages: images, model: models[0]!, prompt };
  const res = "sections" in profile && profile.sections?.length ? await readSections(input, deps.client) : await readPages(input, deps.client);
  if (res.kind === "ok") return done(res.document, false, res.usage.input, res.usage.output, pages.length);
  return fail(res.kind, res.usage.input, res.usage.output);
}

/** The read the queue gave up on: its last attempt ended on a transient model error (0451). */
export async function failUnavailableRead(admin: SupabaseClient, orgId: string, readId: string): Promise<void> {
  const { data } = await admin.from("document_reads").select("status").eq("org_id", orgId).eq("id", readId).maybeSingle();
  if ((data as { status: string } | null)?.status !== "reading") return;
  await transition(admin, orgId, readId, "failed", { p_failure_code: "model_unavailable" });
}
