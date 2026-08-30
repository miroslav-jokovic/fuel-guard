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
 *  - And modulo the engine's NON-DECISION output, which is a third distinct statement: see
 *    `NON_DECISION_FIELDS` and `decisionIdentical`.
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

/**
 * Fields that cannot change what goes on the truck or whether the load may run.
 *
 * ⚠ Adding a name here is a CLAIM, and the claim is load-bearing: it says a difference in this field
 * may be reported as "the decision reproduced". Keep the list short and justify each entry.
 *
 *  · `engineVersion` / `datasetVersion` — stamps, already handled by `identicalModuloVersions`.
 *  · `notices` — non-blocking findings (engine 0.13.0). They EXPLAIN the decision; `eligibility.blocks`
 *    is what constitutes it. An engine release that improves an explanation must not read as a
 *    changed verdict on a load whose placards and eligibility are untouched.
 *  · `trace` — the rule trace. Evidence of how the answer was reached, not the answer.
 *
 * The comparison is SUBTRACTIVE on purpose: everything not named here counts as a difference. A
 * future decision-bearing field is therefore included automatically, which is the opposite posture
 * from `diffVerdicts` — that one enumerates what to compare and is consequently blind to anything it
 * was never taught, `placards.marks` included. A MARINE POLLUTANT mark appearing or vanishing is
 * absolutely a change to what goes on the truck, and it must never be able to hide behind
 * `decisionIdentical`.
 */
const NON_DECISION_FIELDS = ["engineVersion", "datasetVersion", "notices", "trace"] as const;

/** Verdict minus the fields above, for the decision-level comparison. */
export function stripNonDecision(v: Verdict): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...(v as unknown as Record<string, unknown>) };
  for (const key of NON_DECISION_FIELDS) delete rest[key];
  return rest;
}

/**
 * Did the DECISION reproduce — same placards, marks, ID displays, eligibility and findings — even
 * where the recorded bytes differ because the engine's explanatory output changed?
 *
 * NEVER a substitute for `identical`, which stays strictly byte-exact because it is the audit
 * primitive. This only ever adds information: a run that is `identical` is necessarily
 * `decisionIdentical`, and one that is not `decisionIdentical` is a real alarm.
 */
export function decisionsMatch(a: Verdict, b: Verdict): boolean {
  return canonical(stripNonDecision(a)) === canonical(stripNonDecision(b));
}

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
  /**
   * The DECISION reproduced — placards, marks, ID displays, eligibility and findings all match —
   * even if the recorded bytes differ because the engine's explanatory output (`notices`, `trace`)
   * changed. Implied by `identical`; never weakens it.
   */
  decisionIdentical: boolean;
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

  const base: Omit<ReproduceResult, "identical" | "identicalModuloVersions" | "decisionIdentical" | "reason" | "source" | "currentDataset"> = {
    runId: run.id,
    recordedEngineVersion: run.engine_version,
    currentEngineVersion: ENGINE_VERSION,
    recordedDatasetVersion: run.dataset_version,
    datasetAvailable: listDatasetVersions().includes(run.dataset_version),
  };
  if (!base.datasetAvailable) {
    return { ...base, source: "not_reproducible", identical: false, identicalModuloVersions: false, decisionIdentical: false, currentDataset: null, reason: `Dataset ${run.dataset_version} is not shipped in this build — reproduction requires the recorded dataset.` };
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
    return { ...base, source: "not_reproducible", identical: false, identicalModuloVersions: false, decisionIdentical: false, currentDataset: null, reason: "Extraction run predates engine-line recording — the exact extracted lines were not stored, so byte-identical reproduction is not claimed. Runs from prompt 1.1.0 onward store them." };
  } else {
    source = "declared_lines"; linesOverride = undefined;
  }

  const dataset = loadDataset(run.dataset_version);
  const reproduced = evaluateLoad(buildManualLoadInput(load, profile, dataset, new Date().toISOString(), linesOverride, equipment.kind));

  const identical = canonical(reproduced) === canonical(stored);
  const identicalModuloVersions = identical || canonical(stripVersions(reproduced)) === canonical(stripVersions(stored));
  const decisionIdentical = identicalModuloVersions || decisionsMatch(reproduced, stored);

  const current = evaluateLoad(buildManualLoadInput(load, profile, loadDataset(LATEST_DATASET_VERSION), new Date().toISOString(), linesOverride, equipment.kind));

  return {
    ...base,
    source,
    identical,
    identicalModuloVersions,
    decisionIdentical,
    reason: identical ? null
      : identicalModuloVersions ? `Identical except the version stamps (recorded under engine ${run.engine_version}, reproduced under ${ENGINE_VERSION}).`
      // The decision matched and only the engine's explanatory output moved. Reporting that as "a
      // different verdict" — which this branch used to do — is a false alarm on an audit surface,
      // and a false alarm here is worse than none: it is what teaches a reviewer to skip the check.
      : decisionIdentical ? `The decision is unchanged — same placards, marks, ID displays, eligibility and findings. Only the engine's explanatory output differs (engine ${run.engine_version} → ${ENGINE_VERSION}).`
      : run.engine_version !== ENGINE_VERSION ? `The engine changed (${run.engine_version} → ${ENGINE_VERSION}) and its rules now produce a different verdict — see the diff.`
      : "Verdict differs under the same engine and dataset — investigate immediately (this should never happen).",
    currentDataset: { version: LATEST_DATASET_VERSION, diff: diffVerdicts(stored, current) },
  };
}
