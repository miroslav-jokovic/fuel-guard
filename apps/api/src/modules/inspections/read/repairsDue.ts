import type { SupabaseClient } from "@supabase/supabase-js";
import { REPAIR_LOOKBACK_DAYS, REPAIR_VIOLATION_PARTS, shiftDay, type CalendarDay, type RoadsideRepairDueDto } from "@silvicom/shared";
import { readRoadsideInspections, type DbError } from "./inspectionsList.js";
import {
  REPAIR_COLS,
  REPAIR_UNIT_COLS,
  REPAIR_VIOLATION_COLS,
  buildRepairs,
  deciderLabels,
  type RepairRow,
  type RepairUnitRow,
  type RepairViolationRow,
} from "./inspectionRepairs.js";

/**
 * Every violated unit of the last year, each with its inspection — the Shop's "Roadside repairs due"
 * (Q-IC16 (a), owner 2026-10-19). The same rows and the same builder as the inspection page's Repair
 * card (`buildRepairs`), read for many inspections at once; settled and open alike, because the Shop page
 * has an "Open" and a "Recorded" tab and the alert (`repair/dueAlert.ts`) asks of each one in turn.
 *
 * Bounded by the engine's own horizon (`REPAIR_LOOKBACK_DAYS`, 396.9(d)(3)(ii)'s 12 months): measured
 * 2026-10-19, 150 units on 127 inspections. The ids go to `.in()` a hundred at a time — a long id list
 * overflows Node 22's request headers and comes back as a bare "fetch failed".
 */
const IN_CHUNK = 100;
const PAGE = 1000;

/**
 * The repair rows of some inspections, paged: they are append-only (a re-read that moved is a new row), so
 * a chunk's count grows with time and PostgREST would stop at 1,000 without saying so. Units and
 * violations do not grow and are read in one go.
 */
async function repairRows(admin: SupabaseClient, orgId: string, ids: readonly string[]): Promise<{ data: RepairRow[]; error: DbError | null }> {
  const data: RepairRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await admin
      .from("inspection_repairs")
      .select(REPAIR_COLS)
      .eq("org_id", orgId)
      .in("inspection_id", [...ids])
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return { data, error };
    data.push(...((page ?? []) as RepairRow[]));
    if ((page ?? []).length < PAGE) return { data, error: null };
  }
}

export async function readRepairsDue(
  admin: SupabaseClient,
  orgId: string,
  today: CalendarDay,
): Promise<RoadsideRepairDueDto[] | { error: DbError }> {
  const inspections = await readRoadsideInspections(admin, orgId, { from: shiftDay(today, -REPAIR_LOOKBACK_DAYS) });
  if ("error" in inspections) return inspections;
  const ids = inspections.map((i) => i.id);
  const rows: RepairRow[] = [];
  const units: RepairUnitRow[] = [];
  const violations: RepairViolationRow[] = [];
  const inspectionOf = new Map<string, string>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const [r, u, v] = await Promise.all([
      repairRows(admin, orgId, chunk),
      admin.from("roadside_inspection_units").select(`${REPAIR_UNIT_COLS}, inspection_id`).eq("org_id", orgId).in("inspection_id", chunk),
      admin
        .from("roadside_violations")
        .select(REPAIR_VIOLATION_COLS)
        .eq("org_id", orgId)
        .in("inspection_id", chunk)
        .is("vanished_at", null)
        .in("part_no", [...REPAIR_VIOLATION_PARTS]),
    ]);
    for (const res of [r, u, v]) if (res.error) return { error: res.error };
    rows.push(...(r.data as RepairRow[]));
    for (const unit of (u.data ?? []) as (RepairUnitRow & { inspection_id: string })[]) {
      units.push(unit);
      inspectionOf.set(unit.id, unit.inspection_id);
    }
    violations.push(...((v.data ?? []) as RepairViolationRow[]));
  }
  if (rows.length === 0) return [];

  const head = new Map(inspections.map((i) => [i.id, i]));
  const out: RoadsideRepairDueDto[] = [];
  for (const repair of buildRepairs(rows, units, violations, await deciderLabels(admin, orgId, rows))) {
    const i = head.get(inspectionOf.get(repair.unitId) ?? "");
    if (!i?.inspectionDate) continue;
    out.push({
      ...repair,
      inspection: { id: i.id, reportNumber: i.reportNumber, reportState: i.reportState, inspectionDate: i.inspectionDate, locationDesc: i.locationDesc },
    });
  }
  // Soonest due first; the page and the Shop home's preview cut from the top.
  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || (a.unit.seq ?? 99) - (b.unit.seq ?? 99));
}
