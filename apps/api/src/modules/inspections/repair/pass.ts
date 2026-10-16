import type { SupabaseClient } from "@supabase/supabase-js";
import {
  REPAIR_ENGINE_VERSION,
  REPAIR_FOLLOW_DAYS,
  REPAIR_LOOKBACK_DAYS,
  REPAIR_VIOLATION_PARTS,
  dayRangeInstants,
  repairDueOn,
  shiftDay,
  wallClockInZone,
  type RepairEngineOutcome,
} from "@silvicom/shared";
import { readWorkOrdersOnUnits } from "../../fleetpal/index.js";
import { proposeRepair } from "./propose.js";

/**
 * The repair record's engine pass (IC11, D-IC14), on the FMCSA hourly tick after the report checks.
 *
 * ── WHICH UNITS ──────────────────────────────────────────────────────────────────────────────────
 * Every current inspected unit with a current Part 393/396 violation, on an inspection of the last
 * `REPAIR_LOOKBACK_DAYS` (396.9(d)(3)(ii) keeps the report 12 months). A unit a person has decided is
 * done: the engine never writes after a person (0482). The rest are read again every tick while they
 * are inside the due date + `REPAIR_FOLLOW_DAYS`, and once more at a new engine version; a row is
 * written only when the reading's hash differs from the unit's last engine row at this version — so a
 * work order opening on day 6 is a new row on day 6, and a quiet day writes nothing.
 *
 * ── ONE FLEETPAL READ PER TICK ───────────────────────────────────────────────────────────────────
 * The work orders are read once for every due unit, from the earliest inspection day to the latest
 * due day, and each unit takes its own window out of them (`proposeRepair`). ~150 units a year
 * (measured 2026-10-16), so one tick covers them all; there is no batch limit to hold a backlog behind.
 */

type Tally = Partial<Record<RepairEngineOutcome, number>>;

/** Every row of a select, paged: PostgREST answers at most 1,000. */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(`${what}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const today = (nowMs: number, zone: string): string => {
  const w = wallClockInZone(new Date(nowMs), zone);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
};

export async function proposeRepairs(admin: SupabaseClient, orgId: string, zone: string, nowMs: number): Promise<Tally> {
  const day = today(nowMs, zone);
  const inspections = await all<{ id: string; inspection_date: string }>(
    (f, t) =>
      admin.from("roadside_inspections").select("id, inspection_date").eq("org_id", orgId).is("vanished_at", null)
        .gte("inspection_date", shiftDay(day, -REPAIR_LOOKBACK_DAYS)).order("id").range(f, t),
    "roadside_inspections",
  );
  if (inspections.length === 0) return {};
  const dateOf = new Map(inspections.map((i) => [i.id, i.inspection_date]));

  const violations = await all<{ inspection_id: string; unit_id: string; defect_verification_id: string | null }>(
    (f, t) =>
      admin.from("roadside_violations").select("inspection_id, unit_id, defect_verification_id").eq("org_id", orgId).is("vanished_at", null)
        .in("part_no", [...REPAIR_VIOLATION_PARTS]).not("unit_id", "is", null).order("id").range(f, t),
    "roadside_violations",
  );
  const byUnit = new Map<string, { inspectionId: string; verifications: (string | null)[] }>();
  for (const v of violations) {
    if (!dateOf.has(v.inspection_id)) continue;
    const u = byUnit.get(v.unit_id) ?? { inspectionId: v.inspection_id, verifications: [] };
    u.verifications.push(v.defect_verification_id);
    byUnit.set(v.unit_id, u);
  }
  if (byUnit.size === 0) return {};

  const units = await all<{ id: string; vehicle_id: string | null; trailer_id: string | null }>(
    (f, t) => admin.from("roadside_inspection_units").select("id, vehicle_id, trailer_id").eq("org_id", orgId).is("vanished_at", null).order("id").range(f, t),
    "roadside_inspection_units",
  );
  const unitOf = new Map(units.filter((u) => byUnit.has(u.id)).map((u) => [u.id, u]));

  const rows = await all<{ inspection_unit_id: string; source: string; engine_version: string; candidates_sha256: string | null }>(
    (f, t) =>
      admin.from("inspection_repairs").select("inspection_unit_id, source, engine_version, candidates_sha256").eq("org_id", orgId)
        .order("created_at", { ascending: false }).order("id").range(f, t),
    "inspection_repairs",
  );
  const decided = new Set(rows.filter((r) => r.source === "person").map((r) => r.inspection_unit_id));
  const lastHash = new Map<string, string | null>();
  for (const r of rows) if (r.source === "engine" && r.engine_version === REPAIR_ENGINE_VERSION && !lastHash.has(r.inspection_unit_id)) lastHash.set(r.inspection_unit_id, r.candidates_sha256);

  const due = [...unitOf.values()].filter((u) => {
    if (decided.has(u.id)) return false;
    if (!lastHash.has(u.id)) return true;
    return day <= shiftDay(repairDueOn(dateOf.get(byUnit.get(u.id)!.inspectionId)!), REPAIR_FOLLOW_DAYS);
  });
  if (due.length === 0) return {};

  const days = due.map((u) => dateOf.get(byUnit.get(u.id)!.inspectionId)!.slice(0, 10)).sort();
  const window = dayRangeInstants(days[0]!, repairDueOn(days[days.length - 1]!), zone);
  const fleetpal = await readWorkOrdersOnUnits(
    admin,
    orgId,
    { vehicleIds: due.flatMap((u) => (u.vehicle_id ? [u.vehicle_id] : [])), trailerIds: due.flatMap((u) => (u.trailer_id ? [u.trailer_id] : [])) },
    window.start,
    window.endExclusive,
  );

  const tally: Tally = {};
  const inserts = [];
  for (const u of due) {
    const { inspectionId, verifications } = byUnit.get(u.id)!;
    const p = proposeRepair({ inspectionDate: dateOf.get(inspectionId)!, vehicleId: u.vehicle_id, trailerId: u.trailer_id, defectVerifications: verifications }, fleetpal, zone);
    if (lastHash.get(u.id) === p.sha256) continue;
    tally[p.outcome] = (tally[p.outcome] ?? 0) + 1;
    inserts.push({
      org_id: orgId,
      inspection_id: inspectionId,
      inspection_unit_id: u.id,
      source: "engine",
      engine_version: REPAIR_ENGINE_VERSION,
      outcome: p.outcome,
      due_on: p.dueOn,
      candidates: p.candidates,
      candidates_sha256: p.sha256,
    });
  }
  if (inserts.length > 0) {
    const { error } = await admin.from("inspection_repairs").insert(inserts);
    if (error) throw new Error(`inspection_repairs: ${error.message}`);
  }
  return tally;
}
