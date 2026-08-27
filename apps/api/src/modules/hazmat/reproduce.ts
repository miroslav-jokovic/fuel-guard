import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDataset, LATEST_DATASET_VERSION, listDatasetVersions } from "@hazmat/data";
import { ENGINE_VERSION, evaluateLoad, type Verdict } from "@hazmat/engine";
import { buildManualLoadInput, type CargoTankProfileRow, type ManualLoadRow } from "./hazmatAnalysis.js";
import { readEquipmentKind } from "./hazmatEquipment.js";

/**
 * M12.2 — the reproducible verdict. A recorded run is a deterministic function of
 * (load context, engine version, dataset version). This service re-evaluates a historical run
 * under the SAME dataset version it recorded and compares canonically — the proof behind the
 * packet's provenance line — then evaluates under the CURRENT dataset and reports what changed.
 *
 * Honesty rules:
 *  - Extraction runs re-use the ENGINE LINES recorded on the run (stored since prompt 1.1.0's
 *    session); an older extraction run without stored lines is reported not-reproducible-from-
 *    record rather than approximated from declared lines.
 *  - An engine-version change is reported, and the comparison is ALSO done modulo the version
 *    fields — "identical except the engine stamp" is a different statement from "different".
 */

export type ServiceError = { error: string; code: string };
const err = (code: string, error: string): ServiceError => ({ error, code });

function canonical(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x as Record<string, unknown>).sort()) o[k] = norm((x as Record<string, unknown>)[k]);
      return o;
    }
    return x;
  };
  return JSON.stringify(norm(v));
}

const stripVersions = (v: Verdict): Omit<Verdict, "engineVersion" | "datasetVersion"> => {
  const { engineVersion: _e, datasetVersion: _d, ...rest } = v;
  return rest;
};

export interface VerdictDiff {
  placardsAdded: string[];
  placardsRemoved: string[];
  eligibilityBefore: string;
  eligibilityAfter: string;
  findingsAdded: string[];
  findingsRemoved: string[];
}

/** Pure diff of two verdicts — what a dataset (or engine) change means in operational terms. */
export function diffVerdicts(before: Verdict, after: Verdict): VerdictDiff {
  const req = (v: Verdict) => v.placards.required.map((r) => r.placard as string);
  const findings = (v: Verdict) => [...v.eligibility.blocks, ...v.segregation].map((f) => f.ruleId);
  const b = new Set(req(before)); const a = new Set(req(after));
  const fb = new Set(findings(before)); const fa = new Set(findings(after));
  return {
    placardsAdded: [...a].filter((p) => !b.has(p)),
    placardsRemoved: [...b].filter((p) => !a.has(p)),
    eligibilityBefore: before.eligibility.status,
    eligibilityAfter: after.eligibility.status,
    findingsAdded: [...fa].filter((f) => !fb.has(f)),
    findingsRemoved: [...fb].filter((f) => !fa.has(f)),
  };
}

export interface ReproduceResult {
  runId: string;
  recordedEngineVersion: string;
  currentEngineVersion: string;
  recordedDatasetVersion: string;
  datasetAvailable: boolean;
  source: "declared_lines" | "recorded_engine_lines" | "not_reproducible";
  /** Byte-identical (canonical JSON) to the stored verdict, versions included. */
  identical: boolean;
  /** Identical once the engine/dataset version stamps are excluded — the engine-upgrade case. */
  identicalModuloVersions: boolean;
  reason: string | null;
  /** What the CURRENT dataset (and engine) would say about the same load. */
  currentDataset: { version: string; diff: VerdictDiff } | null;
}

export async function reproduceRun(
  admin: SupabaseClient, orgId: string, loadId: string, runId: string,
): Promise<ReproduceResult | ServiceError> {
  const { data: runRow } = await admin.from("hazmat_runs")
    .select("id, verdict, engine_version, dataset_version, extraction")
    .eq("org_id", orgId).eq("load_id", loadId).eq("id", runId).maybeSingle();
  if (!runRow) return err("not_found", "Run not found for this load.");
  const run = runRow as unknown as { id: string; verdict: unknown; engine_version: string; dataset_version: string; extraction: { engineLines?: unknown[] } | null };

  const stored = run.verdict && typeof run.verdict === "object" && "placards" in (run.verdict as object)
    ? (run.verdict as Verdict) : null;
  if (!stored) return err("not_reproducible", "This run recorded no engine verdict (analysis failed or was aborted) — there is nothing to reproduce.");

  const base: Omit<ReproduceResult, "identical" | "identicalModuloVersions" | "reason" | "source" | "currentDataset"> = {
    runId: run.id,
    recordedEngineVersion: run.engine_version,
    currentEngineVersion: ENGINE_VERSION,
    recordedDatasetVersion: run.dataset_version,
    datasetAvailable: listDatasetVersions().includes(run.dataset_version),
  };
  if (!base.datasetAvailable) {
    return { ...base, source: "not_reproducible", identical: false, identicalModuloVersions: false, currentDataset: null, reason: `Dataset ${run.dataset_version} is not shipped in this build — reproduction requires the recorded dataset.` };
  }

  const { data: loadRow } = await admin.from("hazmat_loads")
    .select("declared_lines, tank_state, carrier_relationship, claimed_no_placards, special_permit_numbers, vehicle_id, trailer_id, driver_id, planned_pickup_at")
    .eq("org_id", orgId).eq("id", loadId).maybeSingle();
  if (!loadRow) return err("not_found", "Load not found.");
  const load = loadRow as unknown as ManualLoadRow;

  // H-C2: the tank data lives on the equipment row. Reproduction also passes the resolved KIND now —
  // the original run evaluated under `equipment.kind`, and the old code here silently defaulted to
  // `cargo_tank`, so any van/flatbed run could reproduce differently for no real reason (F-P5).
  const equipment = await readEquipmentKind(admin, orgId, load);
  const profile: CargoTankProfileRow | null = equipment.tank;

  // Which lines fed the recorded verdict?
  const recordedLines = run.extraction?.engineLines;
  let source: ReproduceResult["source"];
  let linesOverride: unknown[] | undefined;
  if (run.extraction && Array.isArray(recordedLines) && recordedLines.length > 0) {
    source = "recorded_engine_lines"; linesOverride = recordedLines;
  } else if (run.extraction) {
    return { ...base, source: "not_reproducible", identical: false, identicalModuloVersions: false, currentDataset: null, reason: "Extraction run predates engine-line recording — the exact extracted lines were not stored, so byte-identical reproduction is not claimed. Runs from prompt 1.1.0 onward store them." };
  } else {
    source = "declared_lines"; linesOverride = undefined;
  }

  const dataset = loadDataset(run.dataset_version);
  const reproduced = evaluateLoad(buildManualLoadInput(load, profile, dataset, new Date().toISOString(), linesOverride, equipment.kind));

  const identical = canonical(reproduced) === canonical(stored);
  const identicalModuloVersions = identical || canonical(stripVersions(reproduced)) === canonical(stripVersions(stored));

  const current = evaluateLoad(buildManualLoadInput(load, profile, loadDataset(LATEST_DATASET_VERSION), new Date().toISOString(), linesOverride, equipment.kind));

  return {
    ...base,
    source,
    identical,
    identicalModuloVersions,
    reason: identical ? null
      : identicalModuloVersions ? `Identical except the version stamps (recorded under engine ${run.engine_version}, reproduced under ${ENGINE_VERSION}).`
      : run.engine_version !== ENGINE_VERSION ? `The engine changed (${run.engine_version} → ${ENGINE_VERSION}) and its rules now produce a different verdict — see the diff.`
      : "Verdict differs under the same engine and dataset — investigate immediately (this should never happen).",
    currentDataset: { version: LATEST_DATASET_VERSION, diff: diffVerdicts(stored, current) },
  };
}
