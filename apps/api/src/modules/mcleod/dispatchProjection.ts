import type { SupabaseClient } from "@supabase/supabase-js";
import { projectMcleodMovement, type RawDispatchMovement, type RawDispatchStop } from "@silvicom/shared";
import { applyMirroredLoads, readMirroredLinks, type MirroredLoad, type MirrorWriteResult } from "../loads/index.js";
import { loadEntityResolvers } from "./tmsLoadIngest.js";
import { fetchAllPaged } from "../../lib/paging.js";

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
  "trailer_type, commodity, customer_id, customer_name, weight, weight_um, pieces, consignee_refno, move_distance, closed_at";
const STOP_COLUMNS =
  "movement_id, stop_id, movement_sequence, stop_type, status, location_id, location_name, address, city_name, state, " +
  "zip_code, latitude, longitude, sched_arrive_early, sched_arrive_late, actual_arrival, actual_departure, eta, " +
  "contact_name, phone, ponum";
/** ≤ 12 stops per movement measured, so 50 movements keep a stop read under PostgREST's 1,000 rows. */
const CHUNK = 50;

export interface DispatchProjectionResult extends MirrorWriteResult {
  projected: number;
  /**
   * Movements with no core load — no order, a McLeod status nobody has ruled on, or stops without a usable
   * sequence. Kept in raw and returned here; the connector logs each one by id (since 2026-09-28).
   */
  refused: { movement_id: string; reason: string }[];
  /** McLeod codes with no Silvicom match — the load is kept, the field left empty, the code reported. */
  unmatched: string[];
  notes: string[];
}

type Resolvers = Awaited<ReturnType<typeof loadEntityResolvers>>;

export async function projectDispatchMovements(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  companyId: string,
  movementIds: string[],
  known?: Resolvers,
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

  const resolvers = known ?? (await loadEntityResolvers(admin, orgId));
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
    const { driver_code, co_driver_code, vehicle_unit, trailer_unit, ...rest } = out.load;
    loads.push({
      ...rest,
      driver_id: resolve(driver_code, resolvers.drivers),
      co_driver_id: resolve(co_driver_code, resolvers.drivers),
      vehicle_id: resolve(vehicle_unit, resolvers.vehicles),
      trailer_id: resolve(trailer_unit, resolvers.trailers),
    });
  }

  const written = await applyMirroredLoads(admin, orgId, provider, loads);
  return { ...written, projected: loads.length, refused, unmatched: [...unmatched], notes };
}

/**
 * ── A LINK THAT RESOLVES LATER IS RE-MADE (LOADS-ACTIVITY-PLAN D-LA3) ────────────────────────────
 * A movement is projected when McLeod sends it, so a code the roster did not hold YET resolved to null
 * and stayed null: McLeod stops resending a movement once it closes. On 2026-10-19 that was 17 delivered
 * loads with no driver whose McLeod code then matched an active driver, so their deliveries were
 * missing from those drivers' histories. A driver merge leaves the same gap on `co_driver_id`, which
 * has no foreign key (0493) to clear it.
 *
 * This re-projects every recent movement whose stored driver, co-driver, truck or trailer differs from
 * what its codes resolve to NOW, but only where the code now resolves. A code the roster never carries
 * (JFERGUSO on 10/19) would otherwise be re-projected every pass to the same null. It goes through the
 * one projection, so there is no second write path to drift. "Recent" means open, or closed inside
 * `sinceIso`: the activity view looks back weeks, and the raw table only grows.
 *
 * ── A SCHEDULED PASS, NOT PART OF EVERY SYNC (PLATFORM-RELIABILITY-PLAN D-RLY12) ─────────────────
 * Until 2026-10-21 this ran inside `POST /api/tms/dispatch-movements`, after every batch. Measured in
 * production that day: the agent posts ~1.1 movements per call (2,143 load UPDATEs over ~1,930 calls),
 * so each call re-read 60 days of codes (~1,000 movements, two pages), the roster, and the links of all
 * of them in 200-id chunks one after another, to relink nothing almost every time — the bulk of the
 * route's median 1.6 s. A stale link only appears when the ROSTER changes (or a merge), not when a
 * movement arrives, and the arriving movement is already projected against the roster of that moment.
 * So the pass is `relinkScheduler.ts`'s, every few minutes, over every company the org's raw rows hold.
 */
export async function relinkDispatchMovements(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  sinceIso: string,
): Promise<{ relinked: number }> {
  type Codes = Pick<RawDispatchMovement, "company_id" | "movement_id" | "driver_codes" | "tractor_id" | "trailer_id">;
  const raw = await fetchAllPaged<Codes>((from, to) =>
    admin.from("mcleod_dispatch_movements").select("company_id, movement_id, driver_codes, tractor_id, trailer_id")
      .eq("org_id", orgId)
      .or(`closed_at.is.null,closed_at.gte.${sinceIso}`)
      .order("company_id").order("movement_id").range(from, to)
      .then(({ data, error }) => ({ data: data as unknown as Codes[] | null, error })),
  );
  if (raw.length === 0) return { relinked: 0 };

  const key = (m: Codes) => `${m.company_id}:${m.movement_id}`;
  const resolvers = await loadEntityResolvers(admin, orgId);
  const links = await readMirroredLinks(admin, orgId, provider, raw.map(key));
  // Stale = a code that resolves now to an id the load does not hold. A code that resolves to nothing
  // is never stale: projecting it again would write the same null.
  const stale = (code: string | null | undefined, by: { get(k: string): string | undefined }, held: string | null) => {
    const now = code ? by.get(code) : undefined;
    return now !== undefined && now !== held;
  };
  const byCompany = new Map<string, string[]>();
  for (const m of raw) {
    const l = links.get(key(m));
    if (l === undefined) continue;
    if (
      stale(m.driver_codes?.[0], resolvers.drivers, l.driver_id) ||
      stale(m.driver_codes?.[1], resolvers.drivers, l.co_driver_id) ||
      stale(m.tractor_id, resolvers.vehicles, l.vehicle_id) ||
      stale(m.trailer_id, resolvers.trailers, l.trailer_id)
    ) byCompany.set(m.company_id, [...(byCompany.get(m.company_id) ?? []), m.movement_id]);
  }
  let relinked = 0;
  for (const [companyId, ids] of byCompany) {
    relinked += (await projectDispatchMovements(admin, orgId, provider, companyId, ids, resolvers)).projected;
  }
  return { relinked };
}
