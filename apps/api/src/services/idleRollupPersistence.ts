import type { SupabaseClient } from "@supabase/supabase-js";
import type { IdleRollupDay } from "@fuelguard/shared";
import { readAll } from "./idleRollupInputs.js";

const UPSERT_CHUNK = 500;

interface RawRollupRow {
  vehicle_id: string;
  day: string;
  drive_sec: number;
  idle_sec: number;
  off_sec: number;
  coverage_sec: number;
  managed_idle_sec: number;
  continuous_idle_sec: number;
  rest_idle_sec: number;
  work_idle_sec: number;
  other_idle_sec: number;
  optimized_envelope_inside_sec?: number;
  optimized_envelope_outside_sec?: number;
  optimized_envelope_unknown_sec?: number;
  optimized_envelope_ambiguous_sec?: number;
  optimized_envelope_status?: string;
  optimized_envelope_source?: string;
  hos_rest_sec?: number;
  hos_work_sec?: number;
  hos_unknown_sec?: number;
  hos_ambiguous_sec?: number;
  hos_grace_sec?: number;
  hos_evidence_status?: string;
  attributed_driver_id: string | null;
}

function rollupUnchanged(ex: RawRollupRow | undefined, r: IdleRollupDay): boolean {
  if (!ex) return false;
  return (
    Number(ex.drive_sec) === r.driveSec &&
    Number(ex.idle_sec) === r.idleSec &&
    Number(ex.off_sec) === r.offSec &&
    Number(ex.coverage_sec) === r.coverageSec &&
    Number(ex.managed_idle_sec) === r.managedIdleSec &&
    Number(ex.continuous_idle_sec) === r.continuousIdleSec &&
    Number(ex.rest_idle_sec) === r.restIdleSec &&
    Number(ex.work_idle_sec) === r.workIdleSec &&
    Number(ex.other_idle_sec) === r.otherIdleSec &&
    Number(ex.optimized_envelope_inside_sec ?? 0) === r.optimizedEnvelopeInsideSec &&
    Number(ex.optimized_envelope_outside_sec ?? 0) === r.optimizedEnvelopeOutsideSec &&
    Number(ex.optimized_envelope_unknown_sec ?? 0) === r.optimizedEnvelopeUnknownSec &&
    Number(ex.optimized_envelope_ambiguous_sec ?? 0) === r.optimizedEnvelopeAmbiguousSec &&
    (ex.optimized_envelope_status ?? "not_applicable") === r.optimizedEnvelopeStatus &&
    (ex.optimized_envelope_source ?? "none") === r.optimizedEnvelopeSource &&
    Number(ex.hos_rest_sec ?? 0) === r.hosRestSec &&
    Number(ex.hos_work_sec ?? 0) === r.hosWorkSec &&
    Number(ex.hos_unknown_sec ?? 0) === r.hosUnknownSec &&
    Number(ex.hos_ambiguous_sec ?? 0) === r.hosAmbiguousSec &&
    Number(ex.hos_grace_sec ?? 0) === r.hosGraceSec &&
    (ex.hos_evidence_status ?? "not_applicable") === r.hosEvidenceStatus &&
    (ex.attributed_driver_id ?? null) === r.attributedDriverId
  );
}

interface RawRollupWrite {
  org_id: string;
  vehicle_id: string;
  day: string;
  drive_sec: number;
  idle_sec: number;
  off_sec: number;
  coverage_sec: number;
  managed_idle_sec: number;
  continuous_idle_sec: number;
  rest_idle_sec: number;
  work_idle_sec: number;
  other_idle_sec: number;
  optimized_envelope_inside_sec: number;
  optimized_envelope_outside_sec: number;
  optimized_envelope_unknown_sec: number;
  optimized_envelope_ambiguous_sec: number;
  optimized_envelope_status: string;
  optimized_envelope_source: string;
  hos_rest_sec: number;
  hos_work_sec: number;
  hos_unknown_sec: number;
  hos_ambiguous_sec: number;
  hos_grace_sec: number;
  hos_evidence_status: string;
  attributed_driver_id: string | null;
  updated_at: string;
}

export async function persistIdleRollup(
  admin: SupabaseClient,
  orgId: string,
  rows: IdleRollupDay[],
  fromDate: string,
  toDate: string,
): Promise<{ written: number; deleted: number }> {
  const existing = await readAll<RawRollupRow>("idle_rollup_days", (a, b) =>
    admin
      .from("idle_rollup_days")
      .select(
        "vehicle_id, day, drive_sec, idle_sec, off_sec, coverage_sec, managed_idle_sec, continuous_idle_sec, rest_idle_sec, work_idle_sec, other_idle_sec, optimized_envelope_inside_sec, optimized_envelope_outside_sec, optimized_envelope_unknown_sec, optimized_envelope_ambiguous_sec, optimized_envelope_status, optimized_envelope_source, hos_rest_sec, hos_work_sec, hos_unknown_sec, hos_ambiguous_sec, hos_grace_sec, hos_evidence_status, attributed_driver_id",
      )
      .eq("org_id", orgId)
      .gte("day", fromDate)
      .lte("day", toDate)
      .order("day", { ascending: true })
      .order("vehicle_id", { ascending: true })
      .range(a, b),
  );
  const byKey = new Map(existing.map((r) => [`${r.vehicle_id}|${r.day}`, r]));

  const now = new Date().toISOString();
  const writes: RawRollupWrite[] = [];
  for (const r of rows) {
    if (rollupUnchanged(byKey.get(`${r.vehicleId}|${r.day}`), r)) continue;
    writes.push({
      org_id: orgId,
      vehicle_id: r.vehicleId,
      day: r.day,
      drive_sec: r.driveSec,
      idle_sec: r.idleSec,
      off_sec: r.offSec,
      coverage_sec: r.coverageSec,
      managed_idle_sec: r.managedIdleSec,
      continuous_idle_sec: r.continuousIdleSec,
      rest_idle_sec: r.restIdleSec,
      work_idle_sec: r.workIdleSec,
      other_idle_sec: r.otherIdleSec,
      optimized_envelope_inside_sec: r.optimizedEnvelopeInsideSec,
      optimized_envelope_outside_sec: r.optimizedEnvelopeOutsideSec,
      optimized_envelope_unknown_sec: r.optimizedEnvelopeUnknownSec,
      optimized_envelope_ambiguous_sec: r.optimizedEnvelopeAmbiguousSec,
      optimized_envelope_status: r.optimizedEnvelopeStatus,
      optimized_envelope_source: r.optimizedEnvelopeSource,
      hos_rest_sec: r.hosRestSec,
      hos_work_sec: r.hosWorkSec,
      hos_unknown_sec: r.hosUnknownSec,
      hos_ambiguous_sec: r.hosAmbiguousSec,
      hos_grace_sec: r.hosGraceSec,
      hos_evidence_status: r.hosEvidenceStatus,
      attributed_driver_id: r.attributedDriverId,
      updated_at: now,
    });
  }
  for (let i = 0; i < writes.length; i += UPSERT_CHUNK) {
    const { error } = await admin
      .from("idle_rollup_days")
      .upsert(writes.slice(i, i + UPSERT_CHUNK), { onConflict: "org_id,vehicle_id,day" });
    if (error) throw new Error(error.message);
  }

  // WHY (idle precision incident 2026-08-12): source reconciliation can remove a truck-day after a
  // previous rollup wrote it. Delete only keys absent from this fresh, org-scoped derivation; the RPC
  // keeps this set-based and prevents a service-role cleanup from crossing tenants.
  const freshKeys = new Set(rows.map((row) => `${row.vehicleId}|${row.day}`));
  const staleKeys = existing
    .filter((row) => !freshKeys.has(`${row.vehicle_id}|${row.day}`))
    .map((row) => ({ vehicle_id: row.vehicle_id, day: row.day }));
  let deleted = 0;
  for (let i = 0; i < staleKeys.length; i += UPSERT_CHUNK) {
    const { data, error } = await admin.rpc("delete_idle_rollup_rows", {
      p_org: orgId,
      p_rows: staleKeys.slice(i, i + UPSERT_CHUNK),
    });
    if (error) throw new Error(`idle rollup stale-row delete failed: ${error.message}`);
    deleted += typeof data === "number" ? data : 0;
  }
  return { written: writes.length, deleted };
}
