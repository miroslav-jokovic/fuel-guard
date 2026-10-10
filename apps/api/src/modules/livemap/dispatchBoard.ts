/**
 * The dispatch board — one row per active truck: who drives it, their clocks, where it is, what it is
 * hauling, when it empties, what it hauls next, and what is wrong (DISPATCH-BOARD-PLAN DB4, D-DB2).
 *
 * ── IT OWNS NO TABLE, AND READS ALL OF THEM THROUGH THEIR OWNERS ─────────────────────────────────
 * The live map's rule (`liveMapBoard.ts`), applied to five owners instead of three: positions and HOS
 * clocks from samsara, identity and fleet code from roster, loads and stops from loads, the fleet and
 * dispatcher links from mcleod. Five owner reads and a few `Map` lookups, bounded by fleet size.
 *
 * ── EVERY VERDICT IS THE SHARED RULE'S ───────────────────────────────────────────────────────────
 * ETA, on-time, empties, flags and "mine" come from `@silvicom/shared`'s `dispatchBoard.ts` and are
 * computed here against ONE clock, so a slow read cannot rank two trucks by when each row happened to
 * be processed. The browser filters and sorts; it decides nothing.
 *
 * ── ALL TRUCKS, AND THE SCOPE BESIDE THEM ────────────────────────────────────────────────────────
 * The rows are the whole fleet and `scope` says which are the caller's: My fleet / All is a filter, not
 * a permission (plan §4 #2) — anyone with `dispatch: view` may already see every truck on the live map.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  boardEta,
  boardFlags,
  emptiesAt,
  freshHos,
  onTimeVerdict,
  secondsSince,
  type DispatchBoardResponse,
  type DispatchBoardRow,
} from "@silvicom/shared";
import { readHosClocks, readVehiclePositions } from "../samsara/index.js";
import { readFleetIdentities } from "../roster/index.js";
import { readTruckLoadPlans } from "../loads/index.js";
import { readDispatchLinks } from "../mcleod/index.js";

/** The live map's Q-LM8a ruling, for the same reason: a retired truck is no work anybody can dispatch. */
const HIDDEN_VEHICLE_STATUS = "retired";
const IN_SHOP_VEHICLE_STATUS = "maintenance";

export async function readDispatchBoard(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  now: Date = new Date(),
): Promise<DispatchBoardResponse> {
  // Sequential on purpose, as on the live map: small reads against one pool this process shares.
  const identities = await readFleetIdentities(admin, orgId);
  const positions = await readVehiclePositions(admin, orgId);
  const clocks = await readHosClocks(admin, orgId);
  const plans = await readTruckLoadPlans(admin, orgId);
  const links = await readDispatchLinks(admin, orgId, userId);

  const positionOf = new Map(positions.rows.map((p) => [p.vehicle_id, p]));
  const rows: DispatchBoardRow[] = [];
  for (const id of identities.byVehicleId.values()) {
    if (id.status === HIDDEN_VEHICLE_STATUS) continue;
    const p = positionOf.get(id.vehicleId);
    const plan = plans.byVehicleId.get(id.vehicleId) ?? { current: null, next: null };
    // The roster's assigned driver — the map's pairing (Q-DB6), so the board and the map name one person.
    const driver = id.driver;
    const hos = freshHos(driver ? (clocks.byDriverId.get(driver.id) ?? null) : null, now);
    const position = p
      ? {
          place: p.formatted_location,
          lat: p.lat,
          lng: p.lng,
          speedMph: p.speed_mph,
          sampledAt: p.sampled_at,
          ageSeconds: secondsSince(p.sampled_at, now),
        }
      : null;
    const from = position ? { lat: position.lat, lng: position.lng } : null;
    const nextStop = plan.current?.nextStop ?? null;
    const eta = nextStop && !nextStop.arrivedAt ? boardEta(from, nextStop, hos, now) : null;
    const onTime = plan.current ? onTimeVerdict(nextStop, eta) : "unknown";
    // The last stop's ETA is the next stop's when they are the same stop — one leg, one estimate.
    const last = plan.current?.lastStop ?? null;
    const lastEta = last && last === nextStop ? eta : last && !last.arrivedAt ? boardEta(from, last, hos, now) : null;
    const inShop = id.status === IN_SHOP_VEHICLE_STATUS;
    rows.push({
      vehicleId: id.vehicleId,
      unitNumber: id.unitNumber,
      inShop,
      fleetCode: id.fleetCode,
      driver,
      hos,
      position,
      fuelPercent: id.fuel?.percent ?? null,
      current: plan.current,
      next: plan.next,
      eta,
      onTime,
      empties: emptiesAt(plan.current, lastEta, position, now),
      flags: boardFlags({ inShop, current: plan.current, next: plan.next, onTime, hos, gpsAgeSeconds: position?.ageSeconds ?? null }),
    });
  }
  // A stable order for a first paint; the page sorts as the dispatcher asks.
  rows.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));

  return {
    generatedAt: now.toISOString(),
    rows,
    scope: links.scope,
    fleets: links.fleets,
    dispatchers: links.dispatchers.map(({ id, name, isSystem }) => ({ id, name, isSystem })),
    uncoveredCount: plans.uncoveredCount,
    hosAsOf: clocks.newestAt,
  };
}
