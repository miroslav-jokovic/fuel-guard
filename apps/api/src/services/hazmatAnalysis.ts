import { randomUUID, createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateLoad, type LoadInput, type Verdict } from "@hazmat/engine";
import { loadDataset, type Dataset } from "@hazmat/data";
import { transitionLoad } from "./hazmatLoads.js";

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
}
export interface CargoTankProfileRow {
  cargo_capacity_gal: number | null;
  compartments: unknown;
}

export function buildManualLoadInput(
  load: ManualLoadRow, profile: CargoTankProfileRow | null, dataset: Dataset, evaluatedAt: string,
  linesOverride?: unknown[],
): LoadInput {
  return {
    evaluatedAt,
    vehicle: {
      kind: "cargo_tank", // fuel-fleet default; refined by the cargo-tank profile when present
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
  "declared_lines, tank_state, carrier_relationship, claimed_no_placards, special_permit_numbers, vehicle_id, trailer_id";

/** Insert a run row. `models` carries per-pass model+token usage for extraction runs (null for manual). */
export async function insertHazmatRun(
  admin: SupabaseClient, runId: string, orgId: string, loadId: string,
  engineVersion: string, datasetVersion: string, verdict: unknown, outcome: "green" | "flagged",
  flags: string[], inputHash: string, models: unknown = null,
): Promise<void> {
  const { error } = await admin.from("hazmat_runs").insert({
    id: runId, org_id: orgId, load_id: loadId,
    engine_version: engineVersion, dataset_version: datasetVersion,
    verdict, outcome, flags, models, input_hash: inputHash,
  });
  if (error) console.error(`[hazmat] run insert failed for ${runId}: ${error.message}`);
}
const insertRun = insertHazmatRun;

/** The async body — runs under the semaphore, records a run + transitions the load. Never throws out. */
async function runManualAnalysis(
  admin: SupabaseClient, orgId: string, loadId: string, runId: string,
): Promise<void> {
  await acquire();
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

    let profile: CargoTankProfileRow | null = null;
    if (l.trailer_id || l.vehicle_id) {
      const q = admin.from("hazmat_cargo_tank_profiles").select("cargo_capacity_gal, compartments").eq("org_id", orgId);
      const { data: p } = await (l.trailer_id ? q.eq("trailer_id", l.trailer_id) : q.eq("vehicle_id", l.vehicle_id)).maybeSingle();
      profile = (p as CargoTankProfileRow | null) ?? null;
    }

    let verdict: Verdict | { error: string };
    let outcome: "green" | "flagged";
    let flags: string[];
    let engineVersion = "unknown";
    try {
      const v = evaluateLoad(buildManualLoadInput(l, profile, dataset, new Date().toISOString()));
      verdict = v; engineVersion = v.engineVersion;
      flags = computeManualFlags(v, dataset.provisional);
      outcome = flags.length ? "flagged" : "green";
    } catch (e) {
      verdict = { error: e instanceof Error ? e.message : "analysis failed" };
      flags = ["analysis_failed"]; outcome = "flagged";
    }

    await insertRun(admin, runId, orgId, loadId, engineVersion, dataset.version, verdict, outcome, flags, manualInputHash(l, engineVersion, dataset.version));
    await transitionLoad(admin, orgId, loadId, outcome === "green" ? "analysis_green" : "analysis_flagged", { datasetProvisional: dataset.provisional });
  } catch (e) {
    console.error(`[hazmat] manual analysis crashed for load ${loadId}: ${e instanceof Error ? e.message : e}`);
  } finally {
    release();
  }
}

/** Kick off a manual analysis. Returns the runId immediately; the work runs async in-process. */
export function startManualAnalysis(
  admin: SupabaseClient, orgId: string, loadId: string,
): { runId: string } {
  const runId = randomUUID();
  void runManualAnalysis(admin, orgId, loadId, runId);
  return { runId };
}
