import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDatasetIndex, loadDataset } from "@hazmat/data";
import { evaluateLoad, ENGINE_VERSION, type Verdict } from "@hazmat/engine";
import { withinBudget } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { transitionLoad } from "../hazmatLoads.js";
import { buildManualLoadInput, computeAdvisories, insertHazmatRun, type CargoTankProfileRow, type ManualLoadRow } from "../hazmatAnalysis.js";
import { normalizeImage, IMAGE_NORMALIZER_VERSION } from "./image.js";
import { usabilityGate } from "./image.js";
import { anthropicVisionExtractor, HAZMAT_EXTRACTION_PROMPT_VERSION, type ImageInput } from "./vision.js";
import { runExtraction } from "./extract.js";
import { computeExtractionFlags, isGreen } from "./outcome.js";
import { notifyReviewersOfFlag } from "../hazmatNotify.js";
import { enqueueJob } from "../../../queue/enqueue.js";
import type { DeclaredLineRef } from "./mapBolLines.js";
import { evaluateQualification } from "../qualification.js";
import { QUALIFICATION_EVAL_AT_NOW_FLAG } from "@silvicom/shared";
import { readEquipmentKind } from "../hazmatEquipment.js";

/**
 * Extraction analysis path (plan H6-orchestrator). Mirrors the manual path (startManualAnalysis) but the
 * input is BOL PHOTOS: usability gate → normalize → dual-pass vision → deterministic cross-validation →
 * engine → the shared outcome table. In-process + async under its own (smaller) concurrency slot because
 * vision calls are heavier. Kill-switch (policy `extractionEnabled`), per-org token budget, and a
 * content-hash cache all gate the model exactly as the 07 layer does. Writes ONLY to `hazmat_runs` + the
 * load status; never throws out.
 */
const MAX_CONCURRENT = 2;
let active = 0;
const waiters: Array<() => void> = [];
const acquire = (): Promise<void> =>
  active < MAX_CONCURRENT ? ((active++), Promise.resolve()) : new Promise((r) => waiters.push(r));
const release = (): void => {
  const next = waiters.shift();
  if (next) next();
  else active = Math.max(0, active - 1);
};

interface PolicyShape {
  extractionEnabled?: boolean;
  extractionMonthlyTokenBudget?: number | null;
}

/** D17: one indexed row read against the materialised counter (0130) — never a hazmat_runs scan.
 *  The counter is incremented atomically with every run insert by `record_hazmat_run`. */
async function tokensUsedThisMonth(admin: SupabaseClient, orgId: string, nowIso: string): Promise<number> {
  const yyyymm = nowIso.slice(0, 7);
  const { data } = await admin
    .from("org_usage_month").select("input_tokens, output_tokens")
    .eq("org_id", orgId).eq("yyyymm", yyyymm).maybeSingle();
  const row = data as { input_tokens: number; output_tokens: number } | null;
  return row ? Number(row.input_tokens) + Number(row.output_tokens) : 0;
}

/** The async body — records exactly one run + transitions the load. Never throws out (fail-closed). */
export async function executeExtraction(admin: SupabaseClient, orgId: string, loadId: string, env: Env, runId: string): Promise<void> {
  const dataset = loadDataset();
  const now = new Date().toISOString();
  const finish = async (verdict: Verdict | null, flags: string[], models: unknown) => {
    const outcome = isGreen(flags) ? "green" : "flagged";
    const hash = "sha256:extraction:" + runId; // recomputed below for the real path; placeholder on abort
    await insertHazmatRun(admin, runId, orgId, loadId, verdict?.engineVersion ?? "n/a", dataset.version, verdict ?? { extraction: "no_verdict" }, outcome, flags, hash, models, { advisories: computeAdvisories(verdict) });
    await transitionLoad(admin, orgId, loadId, outcome === "green" ? "analysis_green" : "analysis_flagged", { datasetProvisional: dataset.provisional });
    if (outcome === "flagged") await notifyReviewersOfFlag(admin, orgId, loadId);
  };

  try {
    // Entitlement re-check at execution start (no model spend if revoked).
    const { data: enabled } = await admin.rpc("org_module_enabled", { p_org: orgId, p_module: "hazmatguard" });
    if (enabled !== true) return finish(null, ["entitlement_revoked"], null);

    // Policy: kill-switch. (BUDGET moved below the cache lookup — D17/§14.1: a cache hit spends no
    // tokens and should cost nothing to authorise.)
    const { data: policyRow } = await admin.from("hazmat_policies").select("policy").eq("org_id", orgId).maybeSingle();
    const policy = ((policyRow as { policy?: PolicyShape } | null)?.policy ?? {}) as PolicyShape;
    if (policy.extractionEnabled === false) return finish(null, ["extraction_disabled"], null);

    // Load + its BOL documents.
    const { data: loadRow } = await admin
      .from("hazmat_loads")
      .select("declared_lines, tank_state, carrier_relationship, claimed_no_placards, special_permit_numbers, vehicle_id, trailer_id, driver_id, planned_pickup_at")
      .eq("org_id", orgId).eq("id", loadId).maybeSingle();
    if (!loadRow) return; // load vanished — nothing to record
    const load = loadRow as unknown as ManualLoadRow;

    // F-P2: read the carrier context from the equipment before anything that depends on it. The
    // qualification digest below is a cache-key term, and the kind is one of its inputs — so this has
    // to happen first or a trailer type change would replay a stale verdict.
    const equipment = await readEquipmentKind(admin, orgId, load); // kind + tank data in one read (H-C2)

    // §5/§5.1 (M3): qualification gate — evaluated BEFORE hashing because its inputs are a cache-key
    // term (§10.10): renew a medical card and the same photo MUST re-evaluate, not replay a stale pass.
    const qual = await evaluateQualification(admin, orgId, { driver_id: load.driver_id, planned_pickup_at: load.planned_pickup_at }, equipment.kind, now);

    const { data: docs } = await admin
      .from("hazmat_documents").select("storage_path, content_type, page")
      .eq("org_id", orgId).eq("load_id", loadId).eq("kind", "bol").order("page", { ascending: true });
    const docRows = (docs ?? []) as Array<{ storage_path: string; content_type: string | null; page: number }>;
    if (docRows.length === 0) return finish(null, ["no_documents"], null);

    // Download → normalize → base64. The normalized bytes also key the content-hash cache.
    const images: ImageInput[] = [];
    const gateBuffers: Buffer[] = [];
    const hash = createHash("sha256");
    hash.update(`${env.HAZMAT_MODEL_A}|${env.HAZMAT_MODEL_B}|${HAZMAT_EXTRACTION_PROMPT_VERSION}|${IMAGE_NORMALIZER_VERSION}|${ENGINE_VERSION}|${dataset.version}|qual:${qual.inputsDigest}`); // §10.10: engine + dataset + qualification inputs MUST be in the hash, else a stale verdict replays from cache
    for (const d of docRows) {
      const { data: blob, error } = await admin.storage.from("hazmat").download(d.storage_path);
      if (error || !blob) return finish(null, ["document_unreadable"], null);
      const raw = Buffer.from(await blob.arrayBuffer());
      const norm = await normalizeImage(raw);
      hash.update(norm.normalized);
      gateBuffers.push(norm.normalized);
      images.push({ base64: norm.normalized.toString("base64"), mediaType: norm.mediaType }); // D11: real media type from sharp metadata, never assumed
    }
    const inputHash = "sha256:" + hash.digest("hex");

    // Content-hash cache: an identical prior run short-circuits the model — checked BEFORE the
    // budget gate (D17), because a hit spends nothing.
    const { data: cached } = await admin
      .from("hazmat_runs").select("verdict, outcome, flags, advisories, extraction, qualification, engine_version, models")
      .eq("org_id", orgId).eq("input_hash", inputHash).limit(1).maybeSingle();
    if (cached) {
      const c = cached as { verdict: unknown; outcome: "green" | "flagged"; flags: string[]; advisories: unknown[]; extraction: unknown; qualification: unknown; engine_version: string; models: unknown };
      await insertHazmatRun(admin, runId, orgId, loadId, c.engine_version, dataset.version, c.verdict, c.outcome, c.flags, inputHash, c.models, { advisories: c.advisories ?? [], extraction: c.extraction ?? null, qualification: c.qualification ?? qual.record });
      await transitionLoad(admin, orgId, loadId, c.outcome === "green" ? "analysis_green" : "analysis_flagged", { datasetProvisional: dataset.provisional });
      if (c.outcome === "flagged") await notifyReviewersOfFlag(admin, orgId, loadId);
      return;
    }

    // Budget gate — one indexed row read (D17). Only a cache MISS pays the model, so only a miss
    // needs authorising.
    const budget = policy.extractionMonthlyTokenBudget ?? null;
    if (!withinBudget(await tokensUsedThisMonth(admin, orgId, now), budget)) {
      return finish(null, ["budget_exhausted"], null);
    }

    // Declared lines (dispatcher path) drive reclass-confirm + declared-vs-extracted reconciliation.
    const declaredLines: DeclaredLineRef[] = (load.declared_lines as Array<{ hmtRef?: string; reclassedCombustible?: boolean; isLimitedQuantity?: boolean; quantity?: { value?: number | null } }>)
      .filter((l) => typeof l.hmtRef === "string")
      .map((l) => ({
        hmtRef: l.hmtRef!,
        reclassedCombustible: l.reclassedCombustible,
        // H-LQ: the dispatcher's LQ election rides into the paper-vs-declaration reconciliation.
        isLimitedQuantity: l.isLimitedQuantity ?? false,
        quantityValue: l.quantity?.value ?? null,
      }));

    const extract = await runExtraction(
      { images, gateBuffers, index: buildDatasetIndex(dataset), models: { A: env.HAZMAT_MODEL_A, B: env.HAZMAT_MODEL_B }, vehicleKind: equipment.kind, declaredLines },
      { extractor: anthropicVisionExtractor(env), runUsability: (buf) => usabilityGate(buf) },
    );

    let verdict: Verdict | null = null;
    if (extract.usable && extract.engineLines.length > 0) {
      const profile: CargoTankProfileRow | null = equipment.tank; // H-C2: from the equipment row
      verdict = evaluateLoad(buildManualLoadInput(load, profile, dataset, now, extract.engineLines, equipment.kind));
    }

    const flags = [...new Set([...computeExtractionFlags(extract, verdict, dataset.provisional), ...qual.flags])];
    const models = { A: env.HAZMAT_MODEL_A, B: env.HAZMAT_MODEL_B, usage: extract.usage, promptVersion: HAZMAT_EXTRACTION_PROMPT_VERSION, normalizerVersion: IMAGE_NORMALIZER_VERSION };
    const outcome = isGreen(flags) ? "green" : "flagged";
    // D3: persist the extraction evidence (what the model read, both passes, every cross-validation
    // flag) and the non-blocking advisories — the columns existed since 0092 and were never written.
    const extractionRecord = {
      usable: extract.usable, usabilityReasons: extract.usabilityReasons,
      passA: extract.passA ?? null, passB: extract.passB ?? null,
      engineLineCount: extract.engineLines.length, flags: extract.flags,
      // M12.2: the EXACT lines the engine evaluated — with these on record, an extraction run is
      // byte-identically reproducible without re-running the (non-deterministic, billable) vision
      // passes. Runs before this field report not-reproducible-from-record, honestly.
      engineLines: extract.engineLines,
    };
    const usage = extract.usage as { input?: number; output?: number } | undefined;
    const advisories = qual.usedFallback
      ? [...computeAdvisories(verdict), { ruleId: QUALIFICATION_EVAL_AT_NOW_FLAG, tier: "info", message: "planned_pickup_at was null — qualification evaluated at analysis time (§10.3).", citations: [] }]
      : computeAdvisories(verdict);
    await insertHazmatRun(
      admin, runId, orgId, loadId, verdict?.engineVersion ?? "n/a", dataset.version,
      verdict ?? { extraction: extract.usabilityReasons.length ? "unusable" : "no_lines" }, outcome, flags, inputHash, models,
      { advisories, extraction: extractionRecord, inputTokens: usage?.input ?? 0, outputTokens: usage?.output ?? 0, qualification: qual.record },
    );
    await transitionLoad(admin, orgId, loadId, outcome === "green" ? "analysis_green" : "analysis_flagged", { datasetProvisional: dataset.provisional });
    if (outcome === "flagged") await notifyReviewersOfFlag(admin, orgId, loadId);
  } catch (e) {
    // Model down / retries exhausted / decode error → extraction_failed (reviewer gets a manual-entry action).
    console.error(`[hazmat] extraction crashed for load ${loadId}: ${e instanceof Error ? e.message : e}`);
    // Fail-closed at the boundary (audit 2026-08-06): the abort record must never itself throw out of
    // the catch. A run may already be recorded (0132 makes the insert idempotent), so re-recording
    // returns cleanly and finish() retries the transition + notification; guard against a transient
    // failure here stranding the load with no review signal.
    try {
      await finish(null, ["extraction_failed"], null);
    } catch (e2) {
      console.error(`[hazmat] extraction abort-record failed for load ${loadId}: ${e2 instanceof Error ? e2.message : e2}`);
    }
  }
}

/** In-process execution (inprocess mode): the module semaphore (MAX_CONCURRENT) bounds concurrency
 *  here. Queue mode runs executeExtraction on the worker under the per-kind cap instead, so the
 *  semaphore is inprocess-only. */
async function run(admin: SupabaseClient, orgId: string, loadId: string, env: Env, runId: string): Promise<void> {
  await acquire();
  try {
    await executeExtraction(admin, orgId, loadId, env, runId);
  } finally {
    release();
  }
}

/** Kick off an extraction analysis. Returns the runId immediately. In queue mode the work is enqueued as
 *  a `hazmat_extract` job (worker per-kind cap, retiring the semaphore); in inprocess mode it runs now. */
export function startExtractionAnalysis(admin: SupabaseClient, orgId: string, loadId: string, env: Env): { runId: string } {
  const runId = randomUUID();
  if (env.JOB_EXECUTION_MODE === "queue") {
    // Unique per-run dedup_key: never collides + doesn't block other loads. (Per-load dedup is a later
    // improvement; this preserves today's "each analyze is a fresh run" behavior exactly.)
    void enqueueJob(admin, "hazmat_extract", { orgId, payload: { loadId, runId }, dedupKey: `hazmat:${runId}` }).catch(
      (e) => console.error(`[hazmat] enqueue extract failed for load ${loadId}: ${e instanceof Error ? e.message : e}`),
    );
  } else {
    void run(admin, orgId, loadId, env, runId);
  }
  return { runId };
}
