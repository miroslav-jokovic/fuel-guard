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
import { createCoalescingCache } from "../../lib/coalescingCache.js";

/** A truck not in service — retired, or ordered and not yet delivered — is no work anybody can dispatch. */
const inService = (status: string | null): boolean => status != null && (IN_SERVICE_VEHICLE_STATUSES as readonly string[]).includes(status);
const IN_SHOP_VEHICLE_STATUS = "maintenance";

/** Who is reading the board: what they may see of the driver depends on it (DBV4). */
export type BoardReader = Pick<AuthContext, "userId" | "role" | "sections">;

/**
 * How long one org's board rows may be served after they were built (PLATFORM-RELIABILITY-PLAN D-RLY4).
 *
 * Measured 2026-10-20 on production's per-minute `[metrics]`: this route was the busiest slow one —
 * 193 of 244 minutes, median 2.1 s, max 22.7 s — because every viewer's 60-second poll made ~28 reads
 * one after another. The rows are the SAME for every reader (only the warnings and the scope are
 * the reader's), so a dispatch office looking at it together pays for one composition, not one each.
 *
 * 20 s: a third of the 60 s poll, and under the cadence of what it shows — HOS clocks every 5 min
 * (DB3), loads on the McLeod connector's push, shop status hourly. Positions move faster, but the
 * board shows a position's AGE beside it, computed at build time, so a cached row is never wrong
 * about how old it is — `generatedAt` is the build instant, not the serving one (D-LM10's one clock).
 */
export const BOARD_ROWS_TTL_MS = 20_000;
/** The reader-specific warnings inputs are org-wide too, and change by the day, not the minute. */
const WARNINGS_TTL_MS = 60_000;

type BoardRows = Awaited<ReturnType<typeof readBoardRows>> & { builtAt: Date };
const rowsCache = createCoalescingCache<BoardRows>(BOARD_ROWS_TTL_MS);
const credentialsCache = createCoalescingCache<Map<string, ReturnType<typeof credentialWarnings>>>(WARNINGS_TTL_MS);
const drawnCache = createCoalescingCache<Set<string>>(WARNINGS_TTL_MS);

export async function readDispatchBoard(
  admin: SupabaseClient,
  orgId: string,
  reader: BoardReader,
  now: Date = new Date(),
): Promise<DispatchBoardResponse> {
  // The org IS the key: these reads bypass RLS, so the key is the tenancy boundary (coalescingCache.ts).
  const [board, links] = await Promise.all([
    rowsCache.get(orgId, async () => ({ ...(await readBoardRows(admin, orgId, now)), builtAt: now }), now.getTime()),
    readDispatchLinks(admin, orgId, reader.userId),
  ]);
  return {
    generatedAt: board.builtAt.toISOString(),
    rows: await withDriverWarnings(admin, orgId, board.rows, links.scope, reader, board.builtAt),
    scope: links.scope,
    fleets: links.fleets,
    dispatchers: links.dispatchers.map(({ id, name, isSystem }) => ({ id, name, isSystem })),
    uncoveredCount: board.uncoveredCount,
    hosAsOf: board.hosAsOf,
  };
}

/** Tests only: the caches are module state. */
export function __resetDispatchBoardCaches(): void {
  rowsCache.invalidate();
  credentialsCache.invalidate();
  drawnCache.invalidate();
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
  // Two waves, not ~28 reads in a row (D-RLY4). These used to be awaited one by one "on purpose, as
  // on the live map", which cost the median 2.1 s; the four owners' reads do not depend on each other,
  // and the second wave needs only the first's odometers and trailers. The pool is undici's per-origin
  // one, which holds far more than four concurrent requests.
  const [identities, positions, clocks, plans] = await Promise.all([
    readFleetIdentities(admin, orgId),
    readVehiclePositions(admin, orgId),
    readHosClocks(admin, orgId),
    readTruckLoadPlans(admin, orgId),
  ]);
  // What is due on each truck and its trailer (D-DBV5): FleetPal's 6-month, oil and repair orders,
  // judged on the roster's odometer; the annuals from our own record (Q-DBV2).
  const odometers = new Map([...identities.byVehicleId.values()].map((i) => [i.vehicleId, i.odometerMiles]));
  const trailerIds = [...plans.byVehicleId.values()].map((p) => p.currentTrailerId).filter((id): id is string => !!id);
  const [shop, trailerAnnuals] = await Promise.all([
    readUnitMaintenance(admin, orgId, odometers, now),
    readTrailerAnnualInspections(admin, orgId, trailerIds),
  ]);
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
  // Both inputs are org-wide facts (the gate is WHETHER this reader gets them, decided here per
  // reader); cached per org and day, and read in parallel. Keyed `${orgId}:${today}` — the org first,
  // as everywhere a service-role read is cached.
  const key = `${orgId}:${today}`;
  const [credentials, drawn] = await Promise.all([
    callerCanView(reader.role, "roster", reader.sections)
      ? credentialsCache.get(key, async () => {
          const byDriver = new Map<string, ReturnType<typeof credentialWarnings>>();
          for (const d of (await getComplianceOverview(admin, orgId, today)).drivers) byDriver.set(d.driver_id, credentialWarnings(d.requirements));
          return byDriver;
        })
      : Promise.resolve(new Map<string, ReturnType<typeof credentialWarnings>>()),
    // A reader who is neither a testing-record reader nor anybody's dispatcher can be shown no draw.
    canReadTestingRecords(reader.role) || scope.linked
      ? drawnCache.get(key, () => readDriversDueForRandomTest(admin, orgId, today))
      : Promise.resolve(new Set<string>()),
  ]);

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
