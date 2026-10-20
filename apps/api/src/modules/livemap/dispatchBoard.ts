/**
 * The dispatch board — one row per active truck: who drives it, their clocks, where it is, what it is
 * hauling, when it empties, what it hauls next, and what is wrong (DISPATCH-BOARD-PLAN DB4, D-DB2).
 *
 * ── IT OWNS NO TABLE, AND READS ALL OF THEM THROUGH THEIR OWNERS ─────────────────────────────────
 * The live map's rule (`liveMapBoard.ts`), applied to six owners instead of three: positions and HOS
 * clocks from samsara, identity, fleet code and the annuals from roster, loads and stops from loads,
 * what is due in the shop from fleetpal, the fleet and dispatcher links from mcleod. Owner reads and a
 * few `Map` lookups, bounded by fleet size.
 *
 * ── EVERY VERDICT IS THE SHARED RULE'S ───────────────────────────────────────────────────────────
 * ETA, on-time, availability, miles left, flags and "mine" come from `@silvicom/shared`'s `dispatchBoard.ts` and are
 * computed here against ONE clock, so a slow read cannot rank two trucks by when each row happened to
 * be processed. The browser filters and sorts; it decides nothing.
 *
 * ── EVERY TRUCK THAT CAN BE DISPATCHED ───────────────────────────────────────────────────────────
 * Two kinds of truck are left out. One not in service — retired (the live map's Q-LM8a) or ORDERED
 * and not yet delivered: on 2026-10-20 the board carried 42 ordered trucks with no driver, no fleet
 * and no GPS fix, which made 42 of its 100 "empty" rows and 42 of its 63 "No GPS" rows, so two
 * fifths of "Needs attention" was trucks still at the factory (DISPATCH-LOADS-COUNTS-PLAN §1, the
 * owner's ruling). The set is `IN_SERVICE_VEHICLE_STATUSES`, derived, never a status spelled here.
 * And one the TMS is winding down — sold and awaiting pickup, or retiring — unless it holds a load
 * (D-DB11, 2026-10-12): 506 and 26 others sat on the board as if running while McLeod already had
 * them as `tractor_status = 'I'`. A load is work, and hiding work is worse than showing a sold truck,
 * so a winding-down truck that still has a current or next load stays. All stay on the Vehicles page;
 * this is the board's rule.
 *
 * ── ALL TRUCKS, AND THE SCOPE BESIDE THEM ────────────────────────────────────────────────────────
 * The rows are the whole fleet and `scope` says which are the caller's: My fleet / All is a filter, not
 * a permission (plan §4 #2) — anyone with `dispatch: view` may already see every truck on the live map.
 *
 * ── EXCEPT THE DRIVER'S WARNINGS, WHICH ARE THE READER'S (DBV4) ──────────────────────────────────
 * The truck's rows are the same for every caller (`readBoardRows`, which the ETA recorder shares). The
 * driver's warnings are added per reader, after: the medical card and the CDL only for a reader the
 * org's `roster: view` admits — the DQ file's own gate — and "Random test: send to collection" only on
 * the reader's own trucks, or on every truck for a testing-record reader (Q-DBV3, `randomTestVisible`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  annualWarning,
  availableAt,
  callerCanView,
  canReadTestingRecords,
  credentialWarnings,
  inMyScope,
  randomTestVisible,
  RANDOM_TEST_WARNING,
  warningIsUrgent,
  boardEta,
  boardEtaAlong,
  boardFlags,
  freshHos,
  onTimeVerdict,
  secondsSince,
  sortWarnings,
  type AuthContext,
  type DispatchBoardResponse,
  type DispatchBoardRow,
  type DispatchScope,
  IN_SERVICE_VEHICLE_STATUSES,
} from "@silvicom/shared";
import { readHosClocks, readVehiclePositions } from "../samsara/index.js";
import { readFleetIdentities, readTrailerAnnualInspections } from "../roster/index.js";
import { readUnitMaintenance } from "../fleetpal/index.js";
import { readTruckLoadPlans } from "../loads/index.js";
import { readDispatchLinks } from "../mcleod/index.js";
import { getComplianceOverview } from "../evidence/index.js";
import { readDriversDueForRandomTest } from "../medstop/index.js";

/** A truck not in service — retired, or ordered and not yet delivered — is no work anybody can dispatch. */
const inService = (status: string | null): boolean => status != null && (IN_SERVICE_VEHICLE_STATUSES as readonly string[]).includes(status);
const IN_SHOP_VEHICLE_STATUS = "maintenance";

/** Who is reading the board: what they may see of the driver depends on it (DBV4). */
export type BoardReader = Pick<AuthContext, "userId" | "role" | "sections">;

export async function readDispatchBoard(
  admin: SupabaseClient,
  orgId: string,
  reader: BoardReader,
  now: Date = new Date(),
): Promise<DispatchBoardResponse> {
  const board = await readBoardRows(admin, orgId, now);
  const links = await readDispatchLinks(admin, orgId, reader.userId);
  return {
    generatedAt: now.toISOString(),
    rows: await withDriverWarnings(admin, orgId, board.rows, links.scope, reader, now),
    scope: links.scope,
    fleets: links.fleets,
    dispatchers: links.dispatchers.map(({ id, name, isSystem }) => ({ id, name, isSystem })),
    uncoveredCount: board.uncoveredCount,
    hosAsOf: board.hosAsOf,
  };
}

/**
 * The rows alone — the same for every caller, so the ETA recorder (`boardEtaRecorder.ts`, DB7) records
 * exactly the estimate a dispatcher saw, from this one composition rather than a second copy of it.
 */
export async function readBoardRows(
  admin: SupabaseClient,
  orgId: string,
  now: Date,
): Promise<{ rows: DispatchBoardRow[]; uncoveredCount: number; hosAsOf: string | null }> {
  // Sequential on purpose, as on the live map: small reads against one pool this process shares.
  const identities = await readFleetIdentities(admin, orgId);
  const positions = await readVehiclePositions(admin, orgId);
  const clocks = await readHosClocks(admin, orgId);
  const plans = await readTruckLoadPlans(admin, orgId);
  // What is due on each truck and its trailer (D-DBV5): FleetPal's 6-month, oil and repair orders,
  // judged on the roster's odometer; the annuals from our own record (Q-DBV2).
  const odometers = new Map([...identities.byVehicleId.values()].map((i) => [i.vehicleId, i.odometerMiles]));
  const shop = await readUnitMaintenance(admin, orgId, odometers, now);
  const trailerIds = [...plans.byVehicleId.values()].map((p) => p.currentTrailerId).filter((id): id is string => !!id);
  const trailerAnnuals = await readTrailerAnnualInspections(admin, orgId, trailerIds);
  // The record's dates are calendar days; the board's clock's UTC day is within a few hours of the
  // carrier's, and a 30-day warning window does not turn on those hours.
  const today = now.toISOString().slice(0, 10);

  const positionOf = new Map(positions.rows.map((p) => [p.vehicle_id, p]));
  const rows: DispatchBoardRow[] = [];
  for (const id of identities.byVehicleId.values()) {
    if (!inService(id.status)) continue;
    const p = positionOf.get(id.vehicleId);
    const plan = plans.byVehicleId.get(id.vehicleId) ?? { current: null, next: null, currentAhead: [], currentTrailerId: null };
    if (id.windingDown && !plan.current && !plan.next) continue;
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
    // The last stop's ETA runs through every stop still ahead (D-DBV4), so a drop on the way is driven to,
    // not cut across. Its miles are the row's miles left: one path, one estimate, two readings of it.
    const last = plan.current?.lastStop ?? null;
    // A stop after the last delivery (a trailer drop McLeod lists as "other") is past where it is free.
    const path = last ? plan.currentAhead.filter((s) => s.seq != null && last.seq != null && s.seq <= last.seq) : [];
    const lastEta = last && !last.arrivedAt ? boardEtaAlong(from, path, hos, now) : null;
    const inShop = id.status === IN_SHOP_VEHICLE_STATUS;
    const trailerId = plan.currentTrailerId;
    const warnings = sortWarnings([
      annualWarning("truck", id.annualInspectionExpiresOn, today),
      ...(shop.byVehicleId.get(id.vehicleId) ?? []),
      trailerId ? annualWarning("trailer", trailerAnnuals.get(trailerId) ?? null, today) : null,
      ...(trailerId ? (shop.byTrailerId.get(trailerId) ?? []) : []),
    ].filter((w): w is NonNullable<typeof w> => w != null));
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
      available: availableAt(plan.current, lastEta, position, now),
      milesLeft: lastEta?.miles ?? null,
      warnings,
      flags: boardFlags({ inShop, current: plan.current, next: plan.next, onTime, hos, gpsAgeSeconds: position?.ageSeconds ?? null, warnings }),
    });
  }
  // A stable order for a first paint; the page sorts as the dispatcher asks.
  rows.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));

  return { rows, uncoveredCount: plans.uncoveredCount, hosAsOf: clocks.newestAt };
}

/**
 * The driver's warnings for THIS reader, merged into each row's list and its urgent flag. A read the
 * reader may not see is not made at all, so nothing withheld is ever in memory beside the response.
 */
async function withDriverWarnings(
  admin: SupabaseClient,
  orgId: string,
  rows: DispatchBoardRow[],
  scope: DispatchScope,
  reader: BoardReader,
  now: Date,
): Promise<DispatchBoardRow[]> {
  const today = now.toISOString().slice(0, 10);
  const credentials = new Map<string, ReturnType<typeof credentialWarnings>>();
  if (callerCanView(reader.role, "roster", reader.sections)) {
    for (const d of (await getComplianceOverview(admin, orgId, today)).drivers) credentials.set(d.driver_id, credentialWarnings(d.requirements));
  }
  // A reader who is neither a testing-record reader nor anybody's dispatcher can be shown no draw.
  const drawn = canReadTestingRecords(reader.role) || scope.linked ? await readDriversDueForRandomTest(admin, orgId, today) : new Set<string>();

  return rows.map((r) => {
    const driverId = r.driver?.id;
    if (!driverId) return r;
    const extra = [
      ...(randomTestVisible(drawn.has(driverId), reader.role, inMyScope(r, scope)) ? [RANDOM_TEST_WARNING] : []),
      ...(credentials.get(driverId) ?? []),
    ];
    if (extra.length === 0) return r;
    return {
      ...r,
      warnings: sortWarnings([...extra, ...r.warnings]),
      flags: { ...r.flags, warningUrgent: r.flags.warningUrgent || extra.some(warningIsUrgent) },
    };
  });
}
