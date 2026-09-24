import type { SupabaseClient } from "@supabase/supabase-js";
import { projectMcleodMovement, type RawDispatchMovement, type RawDispatchStop } from "@silvicom/shared";
import { applyMirroredLoads, type MirroredLoad, type MirrorWriteResult } from "../loads/index.js";
import { loadEntityResolvers } from "./tmsLoadIngest.js";

/**
 * Raw → core for the movements a sync just stored (LOADS-MIRROR-PLAN.md LR4, D-LMR4).
 *
 * Reads BACK from `mcleod_dispatch_*` rather than projecting the payload it was handed: core must be
 * rebuildable from raw, and a projection that only ever saw payloads would be a second path nobody
 * could re-run. The same function given every movement id re-projects the whole mirror.
 *
 * The collector's half only: read raw (which only `mcleod` may), run the pure projection, resolve
 * McLeod's codes to Silvicom ids, hand the result to `loads`, which writes it.
 */

const MOVEMENT_COLUMNS =
  "company_id, movement_id, order_id, movement_status, loaded, dispatcher_user_id, driver_codes, tractor_id, trailer_id, " +
  "trailer_type, commodity, customer_id, weight, weight_um, pieces, consignee_refno, move_distance, closed_at";
const STOP_COLUMNS =
  "movement_id, stop_id, movement_sequence, stop_type, status, location_id, location_name, address, city_name, state, " +
  "zip_code, latitude, longitude, sched_arrive_early, sched_arrive_late, actual_arrival, actual_departure, eta, " +
  "contact_name, phone, ponum";
/** ≤ 12 stops per movement measured, so 50 movements keep a stop read under PostgREST's 1,000 rows. */
const CHUNK = 50;

export interface DispatchProjectionResult extends MirrorWriteResult {
  projected: number;
  /** Movements with no core load — no order, or a McLeod status nobody has ruled on. Said, never dropped. */
  refused: { movement_id: string; reason: string }[];
  /** McLeod codes with no Silvicom match — the load is kept, the field left empty, the code reported. */
  unmatched: string[];
  notes: string[];
}

export async function projectDispatchMovements(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  companyId: string,
  movementIds: string[],
): Promise<DispatchProjectionResult> {
  const movements: RawDispatchMovement[] = [];
  const stopsBy = new Map<string, RawDispatchStop[]>();
  for (let i = 0; i < movementIds.length; i += CHUNK) {
    const part = movementIds.slice(i, i + CHUNK);
    const [m, s] = await Promise.all([
      admin.from("mcleod_dispatch_movements").select(MOVEMENT_COLUMNS)
        .eq("org_id", orgId).eq("company_id", companyId).in("movement_id", part),
      admin.from("mcleod_dispatch_stops").select(STOP_COLUMNS)
        .eq("org_id", orgId).eq("company_id", companyId).in("movement_id", part),
    ]);
    if (m.error || s.error) throw new Error(`[mcleod-mirror] could not read raw rows: ${(m.error ?? s.error)!.message}`);
    movements.push(...((m.data ?? []) as unknown as RawDispatchMovement[]));
    for (const row of (s.data ?? []) as unknown as (RawDispatchStop & { movement_id: string })[]) {
      const list = stopsBy.get(row.movement_id) ?? [];
      list.push(row);
      stopsBy.set(row.movement_id, list);
    }
  }

  const resolvers = await loadEntityResolvers(admin, orgId);
  const unmatched = new Set<string>();
  const resolve = (code: string | null, by: { get(k: string): string | undefined }): string | null => {
    if (!code) return null;
    const hit = by.get(code);
    if (!hit) unmatched.add(code);
    return hit ?? null;
  };

  const refused: DispatchProjectionResult["refused"] = [];
  const notes: string[] = [];
  const loads: MirroredLoad[] = [];
  for (const m of movements) {
    const out = projectMcleodMovement(m, stopsBy.get(m.movement_id) ?? []);
    if (!out.ok) {
      refused.push({ movement_id: out.movement_id, reason: out.reason });
      continue;
    }
    notes.push(...out.notes);
    const { driver_code, vehicle_unit, trailer_unit, ...rest } = out.load;
    loads.push({
      ...rest,
      driver_id: resolve(driver_code, resolvers.drivers),
      vehicle_id: resolve(vehicle_unit, resolvers.vehicles),
      trailer_id: resolve(trailer_unit, resolvers.trailers),
    });
  }

  const written = await applyMirroredLoads(admin, orgId, provider, loads);
  return { ...written, projected: loads.length, refused, unmatched: [...unmatched], notes };
}
