import { randomUUID, createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateLoad, type LoadInput, type Verdict } from "@hazmat/engine";
import type { HaulVehicleKind } from "@silvicom/shared";
import { equipmentAssumptionAdvisory, readEquipmentKind } from "./hazmatEquipment.js";
import { loadDataset, type Dataset } from "@hazmat/data";
import { transitionLoad } from "./hazmatLoads.js";
import { notifyReviewersOfFlag } from "./hazmatNotify.js";
import type { Env } from "../../env.js";
import { enqueueJob } from "../../queue/enqueue.js";
import { evaluateQualification } from "./qualification.js";
import { QUALIFICATION_EVAL_AT_NOW_FLAG } from "@silvicom/shared";

/**
 * HazmatGuard analysis orchestrator (plan H4-4) — the MANUAL path. The `jobs` ledger (0027) is a
 * single-active-per-kind scheduler, NOT a queue, so analysis runs IN-PROCESS: `POST /analyze` returns
 * 202 {runId} immediately and this executes asynchronously in the same process under a concurrency
 * semaphore. It re-checks entitlement at execution start (aborts with an `entitlement_revoked` flag),
 * writes results ONLY to `hazmat_runs` + the load status (never to `jobs` — that RLS would leak run
 * errors org-wide), and transitions the load through the state machine (hazmatLifecycle).
 *
 * Extraction (the photo path) plugs in at H6; here the input is the load's `declared_lines` (manual).
 * The pure decision helpers (`computeManualFlags`, `buildManualLoadInput`) are exported + unit-tested.
 *
 * FAIL-CLOSED interim rule (D2): eligibility auto-clear is an H8 concern and the H6 green-outcome table
 * is not built, so any verdict whose eligibility is not a definitive "eligible" is flagged → needs_review.
 * With today's engine (eligibility always "not_checked") that means the manual path never auto-clears —
 * exactly the safe default until H6/H8 land.
 */

// ── pure decision helpers ─────────────────────────────────────────────────────
export interface ManualLoadRow {
  declared_lines: unknown[];
  tank_state: string;
  carrier_relationship: string;
  claimed_no_placards: boolean;
  special_permit_numbers: string[] | null;
  vehicle_id: string | null;
  trailer_id: string | null;
  driver_id: string | null;
  planned_pickup_at: string | null;
}
/** The equipment row's cargo-tank data (H-C2 — lives on `trailers`/`vehicles`, read via
 *  `readEquipmentKind`; the `hazmat_cargo_tank_profiles` table is gone). */
export interface CargoTankProfileRow {
  cargo_capacity_gal: number | null;
  compartments: unknown;
}

export function buildManualLoadInput(
  load: ManualLoadRow, profile: CargoTankProfileRow | null, dataset: Dataset, evaluatedAt: string,
  linesOverride?: unknown[],
  /** Resolved from the load's own equipment (F-P2). Defaults to the conservative reading. */
  vehicleKind: HaulVehicleKind = "cargo_tank",
): LoadInput {
  return {
    evaluatedAt,
    vehicle: {
      kind: vehicleKind,
      cargoTankCapacityGal: profile?.cargo_capacity_gal ?? null,
      compartments: (profile?.compartments as LoadInput["vehicle"]["compartments"]) ?? null,
    },
    tankState: load.tank_state,
    lines: linesOverride ?? load.declared_lines,
    claimedExceptions: {
      shipperClaimsNoPlacards: load.claimed_no_placards,
      claimedSpecialPermits: load.special_permit_numbers ?? [],
    },
    portContext: { vesselConnected: null, imdgPapers: null },
    tripContext: { previousOrCurrentBusinessDayIds: null, carrierRelationship: load.carrier_relationship },
    policy: null,
    dataset,
  } as unknown as LoadInput;
}

/** The blocking flags that route a load to needs_review. Empty ⇒ green (auto-clear-eligible). */
export function computeManualFlags(verdict: Verdict, datasetProvisional: boolean): string[] {
  const flags: string[] = [];
  if (datasetProvisional) flags.push("provisional_dataset");
  if (verdict.eligibility.status === "blocked") flags.push("eligibility_blocked");
  // H8 eligibility engine not built: a non-definitive verdict must never auto-clear (fail-closed, D2).
  if (verdict.eligibility.status === "not_checked") flags.push("eligibility_not_checked");
  for (const f of verdict.eligibility.blocks) if (f.tier === "violation") flags.push(`violation:${f.ruleId}`);
  for (const s of verdict.segregation) if (s.tier === "violation") flags.push(`segregation:${s.ruleId}`);
  return [...new Set(flags)];
}

function canonicalJson(v: unknown): string {
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

/** Manual-run cache key (H4 schema comment): sha256(canonical declared_lines+context ‖ engine ver ‖ dataset ver). */
export function manualInputHash(load: ManualLoadRow, engineVersion: string, datasetVersion: string): string {
  const ctx = {
    declared_lines: load.declared_lines,
    tank_state: load.tank_state,
    carrier_relationship: load.carrier_relationship,
    claimed_no_placards: load.claimed_no_placards,
    special_permit_numbers: load.special_permit_numbers ?? [],
  };
  return "sha256:" + createHash("sha256").update(`${canonicalJson(ctx)}|${engineVersion}|${datasetVersion}`).digest("hex");
}

// ── in-process concurrency semaphore ──────────────────────────────────────────
const MAX_CONCURRENT = 4;
let active = 0;
const waiters: Array<() => void> = [];
function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) { active++; return Promise.resolve(); }
  return new Promise<void>((resolve) => waiters.push(resolve));
}
function release(): void {
  const next = waiters.shift();
  if (next) next();
  else active = Math.max(0, active - 1);
}

// ── orchestration ─────────────────────────────────────────────────────────────
const LOAD_COLUMNS_FOR_ANALYSIS =
  "declared_lines, tank_state, carrier_relationship, claimed_no_placards, special_permit_numbers, vehicle_id, trailer_id, driver_id, planned_pickup_at";

/** Non-violation findings from a verdict — D3's `advisories` column content. Violations become
 *  flags (blocking); everything else (conditional/warning/info) is context a reviewer should see
 *  but is not blocked on. Kept as full Finding objects so citations survive into the run record. */
export function computeAdvisories(verdict: Verdict | null): unknown[] {
  if (!verdict) return [];
  const all = [...verdict.eligibility.blocks, ...verdict.segregation];
  return all.filter((f) => f.tier !== "violation");
}

/** Record a run + increment the org's monthly usage counter, atomically (RPC `record_hazmat_run`,
 *  migration 0130 — D17). THROWS on failure (M0.5 triage finding N2): the run row is the audit
 *  evidence that a verdict happened; silently losing it and then transitioning the load would
 *  detach the load's status from any recorded run. Callers' outer catch handles the failure
 *  fail-closed (no run => no transition => load stays where it was). `models` carries per-pass
 *  model+token usage for extraction runs (null for manual). */
export async function insertHazmatRun(
  admin: SupabaseClient, runId: string, orgId: string, loadId: string,
  engineVersion: string, datasetVersion: string, verdict: unknown, outcome: "green" | "flagged",
  flags: string[], inputHash: string, models: unknown = null,
  opts: { advisories?: unknown[]; extraction?: unknown; inputTokens?: number; outputTokens?: number; qualification?: unknown } = {},
): Promise<void> {
  const { error } = await admin.rpc("record_hazmat_run", {
    p_id: runId, p_org_id: orgId, p_load_id: loadId,
    p_engine_version: engineVersion, p_dataset_version: datasetVersion,
    p_verdict: verdict, p_outcome: outcome, p_flags: flags,
    p_advisories: opts.advisories ?? [], p_extraction: opts.extraction ?? null,
    p_models: models, p_input_hash: inputHash,
    p_input_tokens: opts.inputTokens ?? 0, p_output_tokens: opts.outputTokens ?? 0,
    p_qualification: opts.qualification ?? null,
  });
  if (error) throw new Error(`[hazmat] run record failed for ${runId}: ${error.message}`);
}
const insertRun = insertHazmatRun;

/** The async body — runs under the semaphore, records a run + transitions the load. Never throws out. */
export async function executeManualAnalysis(
  admin: SupabaseClient, orgId: string, loadId: string, runId: string,
): Promise<void> {
  try {
    // Re-check entitlement at execution start (no token spend on the manual path anyway).
    const { data: enabled } = await admin.rpc("org_module_enabled", { p_org: orgId, p_module: "hazmatguard" });
    const dataset = loadDataset();
    if (enabled !== true) {
      await insertRun(admin, runId, orgId, loadId, "n/a", dataset.version, { aborted: "entitlement_revoked" }, "flagged", ["entitlement_revoked"], "sha256:entitlement_revoked");
      await transitionLoad(admin, orgId, loadId, "analysis_flagged", { datasetProvisional: dataset.provisional });
      return;
    }

    const { data: load } = await admin.from("hazmat_loads").select(LOAD_COLUMNS_FOR_ANALYSIS).eq("org_id", orgId).eq("id", loadId).maybeSingle();
    if (!load) return;
    const l = load as unknown as ManualLoadRow;

    // F-P2/H-C2: kind AND tank data come from the equipment the load is actually on, in one read.
    const equipment = await readEquipmentKind(admin, orgId, l);
    const profile: CargoTankProfileRow | null = equipment.tank;

    // §5/§5.1 (M3): the qualification gate runs on EVERY analysis; its failures are UNCLEARABLE
    // (§10.2) — an unqualified driver / lapsed org registration can see a verdict but never a
    // `cleared` load. Independent of the engine verdict; unioned into the flags below.
    const qual = await evaluateQualification(admin, orgId, { driver_id: l.driver_id, planned_pickup_at: l.planned_pickup_at, declared_lines: l.declared_lines }, equipment.kind, new Date().toISOString());

    let verdict: Verdict | { error: string };
    let advisories: unknown[] = [];
    let outcome: "green" | "flagged";
    let flags: string[];
    let engineVersion = "unknown";
    try {
      const v = evaluateLoad(buildManualLoadInput(l, profile, dataset, new Date().toISOString(), undefined, equipment.kind));
      verdict = v; engineVersion = v.engineVersion;
      flags = computeManualFlags(v, dataset.provisional);
      advisories = computeAdvisories(v);
      outcome = flags.length ? "flagged" : "green";
    } catch (e) {
      verdict = { error: e instanceof Error ? e.message : "analysis failed" };
      flags = ["analysis_failed"]; outcome = "flagged";
    }

    flags = [...new Set([...flags, ...qual.flags])];
    outcome = flags.length ? "flagged" : "green";
    const equipmentNote = equipmentAssumptionAdvisory(equipment);
    if (equipmentNote) advisories = [...advisories, equipmentNote];
    if (qual.usedFallback) {
      // §10.3: tier-info, so it is an ADVISORY, not a flag — flags are blocking by definition here
      // (isGreen = zero flags) and "we evaluated at request time" must not block anything.
      advisories = [...advisories, { ruleId: QUALIFICATION_EVAL_AT_NOW_FLAG, tier: "info", message: "planned_pickup_at was null — qualification evaluated at analysis time (§10.3).", citations: [] }];
    }
    await insertRun(admin, runId, orgId, loadId, engineVersion, dataset.version, verdict, outcome, flags, manualInputHash(l, engineVersion, dataset.version), null, { advisories, qualification: qual.record });
    await transitionLoad(admin, orgId, loadId, outcome === "green" ? "analysis_green" : "analysis_flagged", { datasetProvisional: dataset.provisional });
    if (outcome === "flagged") await notifyReviewersOfFlag(admin, orgId, loadId);
  } catch (e) {
    console.error(`[hazmat] manual analysis crashed for load ${loadId}: ${e instanceof Error ? e.message : e}`);
  }
}

/** In-process execution (inprocess mode) behind the module semaphore; queue mode runs
 *  executeManualAnalysis on the worker under the per-kind cap instead. */
async function run(admin: SupabaseClient, orgId: string, loadId: string, runId: string): Promise<void> {
  await acquire();
  try {
    await executeManualAnalysis(admin, orgId, loadId, runId);
  } finally {
    release();
  }
}

/** Kick off a manual analysis. Returns the runId immediately. Queue mode enqueues a `hazmat_analyze`
 *  job (worker per-kind cap, retiring the semaphore); inprocess mode runs it now. */
export function startManualAnalysis(
  admin: SupabaseClient, orgId: string, loadId: string, env: Env,
): { runId: string } {
  const runId = randomUUID();
  if (env.JOB_EXECUTION_MODE === "queue") {
    void enqueueJob(admin, "hazmat_analyze", { orgId, payload: { loadId, runId }, dedupKey: `hazmat:${runId}` }).catch(
      (e) => console.error(`[hazmat] enqueue analyze failed for load ${loadId}: ${e instanceof Error ? e.message : e}`),
    );
  } else {
    void run(admin, orgId, loadId, runId);
  }
  return { runId };
}
