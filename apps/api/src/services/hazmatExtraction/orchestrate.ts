import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDatasetIndex, loadDataset } from "@hazmat/data";
import { evaluateLoad, type Verdict } from "@hazmat/engine";
import { withinBudget } from "@fuelguard/shared";
import type { Env } from "../../env.js";
import { transitionLoad } from "../hazmatLoads.js";
import { buildManualLoadInput, insertHazmatRun, type CargoTankProfileRow, type ManualLoadRow } from "../hazmatAnalysis.js";
import { normalizeImage, IMAGE_NORMALIZER_VERSION } from "./image.js";
import { usabilityGate } from "./image.js";
import { anthropicVisionExtractor, HAZMAT_EXTRACTION_PROMPT_VERSION, type ImageInput } from "./vision.js";
import { runExtraction } from "./extract.js";
import { computeExtractionFlags, isGreen } from "./outcome.js";
import type { DeclaredLineRef } from "./mapBolLines.js";

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

const monthStartIso = (nowIso: string): string => `${nowIso.slice(0, 7)}-01T00:00:00.000Z`;

async function tokensUsedThisMonth(admin: SupabaseClient, orgId: string, nowIso: string): Promise<number> {
  const { data } = await admin
    .from("hazmat_runs").select("models, created_at")
    .eq("org_id", orgId).gte("created_at", monthStartIso(nowIso));
  let total = 0;
  for (const row of (data ?? []) as Array<{ models: unknown }>) {
    const usage = (row.models as { usage?: { input?: number; output?: number } } | null)?.usage;
    if (usage) total += (usage.input ?? 0) + (usage.output ?? 0);
  }
  return total;
}

/** The async body — records exactly one run + transitions the load. Never throws out (fail-closed). */
async function run(admin: SupabaseClient, orgId: string, loadId: string, env: Env, runId: string): Promise<void> {
  await acquire();
  const dataset = loadDataset();
  const now = new Date().toISOString();
  const finish = async (verdict: Verdict | null, flags: string[], models: unknown) => {
    const outcome = isGreen(flags) ? "green" : "flagged";
    const hash = "sha256:extraction:" + runId; // recomputed below for the real path; placeholder on abort
    await insertHazmatRun(admin, runId, orgId, loadId, verdict?.engineVersion ?? "n/a", dataset.version, verdict ?? { extraction: "no_verdict" }, outcome, flags, hash, models);
    await transitionLoad(admin, orgId, loadId, outcome === "green" ? "analysis_green" : "analysis_flagged", { datasetProvisional: dataset.provisional });
  };

  try {
    // Entitlement re-check at execution start (no model spend if revoked).
    const { data: enabled } = await admin.rpc("org_module_enabled", { p_org: orgId, p_module: "hazmatguard" });
    if (enabled !== true) return finish(null, ["entitlement_revoked"], null);

    // Policy: kill-switch + budget.
    const { data: policyRow } = await admin.from("hazmat_policies").select("policy").eq("org_id", orgId).maybeSingle();
    const policy = ((policyRow as { policy?: PolicyShape } | null)?.policy ?? {}) as PolicyShape;
    if (policy.extractionEnabled === false) return finish(null, ["extraction_disabled"], null);
    const budget = policy.extractionMonthlyTokenBudget ?? null;
    if (!withinBudget(await tokensUsedThisMonth(admin, orgId, now), budget)) {
      return finish(null, ["budget_exhausted"], null);
    }

    // Load + its BOL documents.
    const { data: loadRow } = await admin
      .from("hazmat_loads")
      .select("declared_lines, tank_state, carrier_relationship, claimed_no_placards, special_permit_numbers, vehicle_id, trailer_id")
      .eq("org_id", orgId).eq("id", loadId).maybeSingle();
    if (!loadRow) return; // load vanished — nothing to record
    const load = loadRow as unknown as ManualLoadRow;

    const { data: docs } = await admin
      .from("hazmat_documents").select("storage_path, content_type, page")
      .eq("org_id", orgId).eq("load_id", loadId).eq("kind", "bol").order("page", { ascending: true });
    const docRows = (docs ?? []) as Array<{ storage_path: string; content_type: string | null; page: number }>;
    if (docRows.length === 0) return finish(null, ["no_documents"], null);

    // Download → normalize → base64. The normalized bytes also key the content-hash cache.
    const images: ImageInput[] = [];
    const gateBuffers: Buffer[] = [];
    const hash = createHash("sha256");
    hash.update(`${env.HAZMAT_MODEL_A}|${env.HAZMAT_MODEL_B}|${HAZMAT_EXTRACTION_PROMPT_VERSION}|${IMAGE_NORMALIZER_VERSION}`);
    for (const d of docRows) {
      const { data: blob, error } = await admin.storage.from("hazmat").download(d.storage_path);
      if (error || !blob) return finish(null, ["document_unreadable"], null);
      const raw = Buffer.from(await blob.arrayBuffer());
      const norm = await normalizeImage(raw);
      hash.update(norm.normalized);
      gateBuffers.push(norm.normalized);
      images.push({ base64: norm.normalized.toString("base64"), mediaType: "image/png" });
    }
    const inputHash = "sha256:" + hash.digest("hex");

    // Content-hash cache: an identical prior run short-circuits the model.
    const { data: cached } = await admin
      .from("hazmat_runs").select("verdict, outcome, flags, engine_version, models")
      .eq("org_id", orgId).eq("input_hash", inputHash).limit(1).maybeSingle();
    if (cached) {
      const c = cached as { verdict: unknown; outcome: "green" | "flagged"; flags: string[]; engine_version: string; models: unknown };
      await insertHazmatRun(admin, runId, orgId, loadId, c.engine_version, dataset.version, c.verdict, c.outcome, c.flags, inputHash, c.models);
      await transitionLoad(admin, orgId, loadId, c.outcome === "green" ? "analysis_green" : "analysis_flagged", { datasetProvisional: dataset.provisional });
      return;
    }

    // Declared lines (dispatcher path) drive reclass-confirm + declared-vs-extracted reconciliation.
    const declaredLines: DeclaredLineRef[] = (load.declared_lines as Array<{ hmtRef?: string; reclassedCombustible?: boolean; quantity?: { value?: number | null } }>)
      .filter((l) => typeof l.hmtRef === "string")
      .map((l) => ({ hmtRef: l.hmtRef!, reclassedCombustible: l.reclassedCombustible, quantityValue: l.quantity?.value ?? null }));

    const extract = await runExtraction(
      { images, gateBuffers, index: buildDatasetIndex(dataset), models: { A: env.HAZMAT_MODEL_A, B: env.HAZMAT_MODEL_B }, vehicleKind: "cargo_tank", declaredLines },
      { extractor: anthropicVisionExtractor(env), runUsability: (buf) => usabilityGate(buf) },
    );

    let verdict: Verdict | null = null;
    if (extract.usable && extract.engineLines.length > 0) {
      let profile: CargoTankProfileRow | null = null;
      if (load.trailer_id || load.vehicle_id) {
        const q = admin.from("hazmat_cargo_tank_profiles").select("cargo_capacity_gal, compartments").eq("org_id", orgId);
        const { data: p } = await (load.trailer_id ? q.eq("trailer_id", load.trailer_id) : q.eq("vehicle_id", load.vehicle_id)).maybeSingle();
        profile = (p as CargoTankProfileRow | null) ?? null;
      }
      verdict = evaluateLoad(buildManualLoadInput(load, profile, dataset, now, extract.engineLines));
    }

    const flags = computeExtractionFlags(extract, verdict, dataset.provisional);
    const models = { A: env.HAZMAT_MODEL_A, B: env.HAZMAT_MODEL_B, usage: extract.usage, promptVersion: HAZMAT_EXTRACTION_PROMPT_VERSION, normalizerVersion: IMAGE_NORMALIZER_VERSION };
    const outcome = isGreen(flags) ? "green" : "flagged";
    await insertHazmatRun(admin, runId, orgId, loadId, verdict?.engineVersion ?? "n/a", dataset.version, verdict ?? { extraction: extract.usabilityReasons.length ? "unusable" : "no_lines" }, outcome, flags, inputHash, models);
    await transitionLoad(admin, orgId, loadId, outcome === "green" ? "analysis_green" : "analysis_flagged", { datasetProvisional: dataset.provisional });
  } catch (e) {
    // Model down / retries exhausted / decode error → extraction_failed (reviewer gets a manual-entry action).
    console.error(`[hazmat] extraction crashed for load ${loadId}: ${e instanceof Error ? e.message : e}`);
    await finish(null, ["extraction_failed"], null);
  } finally {
    release();
  }
}

/** Kick off an extraction analysis. Returns the runId immediately; the work runs async in-process. */
export function startExtractionAnalysis(admin: SupabaseClient, orgId: string, loadId: string, env: Env): { runId: string } {
  const runId = randomUUID();
  void run(admin, orgId, loadId, env, runId);
  return { runId };
}
