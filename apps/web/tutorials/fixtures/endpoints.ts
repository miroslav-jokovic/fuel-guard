import {
  deriveVehicleState,
  dispatchBoardResponseSchema,
  ENGINE_ON_BOUND_SECONDS,
  FUEL_FRESH_SECONDS,
  OFFLINE_BOUND_SECONDS,
  STOPPED_SPEED_MPH,
  type DispatchBoardLoad,
  type DispatchBoardResponse,
  type DispatchBoardRow,
  type DispatchBoardStop,
  type LiveMapBoard,
  type LiveMapLoadRoute,
  type LiveMapStop,
  type LiveMapVehicle,
} from "@silvicom/shared";
import type { DispatchLoad, DispatchStop, LoadDetail } from "@/features/dispatch/useDispatchLoads";
import {
  at, bearing, ROUTE_STEPS, routeLine, DELIVERED, DISPATCHER, DISPATCHERS, driverId, FLEETS, loadId, NOW, PLACES, truckPosition, TRUCKS,
  UNCOVERED, vehicleId, type LoadPlan, type Place, type Truck,
} from "./world";

/**
 * Every stubbed answer, PROJECTED from `world.ts` and shaped by the product's own contracts.
 *
 * Where a Zod schema exists the answer is parsed through it before it leaves (`dispatchBoardResponseSchema`),
 * so a contract change fails the tutorial run at the stub, loudly, rather than recording a page that
 * reads `undefined`. Where the product only has a TypeScript type, `pnpm typecheck` is that check.
 * Where the product has a RULE — which state a truck's marker is in — the rule is called, not restated:
 * `deriveVehicleState` and the bounds the API itself sends (`liveMapBoard.ts`).
 */

const H = 3_600_000;
const dispatcherOf = (t: Truck) => FLEETS.find((f) => f.code === t.fleet)?.dispatcherId ?? null;
const dayOffset = (days: number) => new Date(NOW + days * 24 * H).toISOString().slice(0, 10);
/** Only an empty truck asks, and every empty truck in `world.ts` is parked somewhere — this is the guard. */
const truckPlace = (t: Truck): Place => {
  throw new Error(`Truck ${t.unit} has no load and no parkedAt: give it one in world.ts.`);
};

function boardStop(p: Place, seq: number, kind: string, apptHours: number, arrived: boolean): DispatchBoardStop {
  return {
    seq, kind, name: p.name, city: p.city, state: p.state, postalCode: p.postalCode,
    appointmentStart: at(apptHours), appointmentEnd: at(apptHours + 2),
    arrivedAt: arrived ? at(apptHours + 0.25) : null, lat: p.lat, lng: p.lng,
  };
}

function boardLoad(t: Truck, l: LoadPlan, onTruck: boolean): DispatchBoardLoad {
  const pickup = boardStop(l.pickup, 1, "pickup", l.pickupAt, onTruck);
  const delivery = boardStop(l.delivery, 2, "dropoff", l.deliverAt, false);
  return {
    loadId: loadId(l.ref), ref: l.ref, status: onTruck ? "in_transit" : "approved", source: "tms",
    externalStatus: onTruck ? "P" : "A", customerName: l.customer, dispatcherId: dispatcherOf(t),
    driverName: t.driver, trailerUnit: l.trailer, nextStop: onTruck ? delivery : pickup, lastStop: delivery,
    stopsLeft: onTruck ? 1 : 2,
  };
}

/** How late the ETA runs against the appointment, by story — the server's verdict, stated as an outcome. */
const ETA_SLIP_HOURS: Record<Truck["story"], number> = { on_time: -0.6, at_risk: 0.3, late: 2.2, empty: 0, shop: 0, no_gps: 0 };

function boardRow(t: Truck): DispatchBoardRow {
  const pos = truckPosition(t);
  const hasGps = t.story !== "no_gps";
  const cur = t.current;
  const etaAt = cur ? cur.deliverAt + ETA_SLIP_HOURS[t.story] : null;
  const milesLeft = cur ? Math.round(cur.miles * (1 - t.progress)) : null;
  // Free where the last delivery is once it is done, or where an empty truck stands now.
  const where: Place = cur ? cur.delivery : (t.parkedAt ?? truckPlace(t));
  const avail = cur
    ? { ...where, place: where.name, at: at(Math.max(cur.deliverAt, etaAt ?? cur.deliverAt) + 1), basis: (t.story === "on_time" ? "appointment" : "eta") as "appointment" | "eta" }
    : { ...where, place: where.name, at: at(0), basis: "now" as const };
  const urgent = t.warnings.some((w) => w.verdict === "overdue" || w.kind === "random_test");
  return {
    vehicleId: vehicleId(t.unit), unitNumber: t.unit, inShop: t.story === "shop", fleetCode: t.fleet,
    driver: t.driver ? { id: driverId(t.driver), name: t.driver } : null,
    hos: t.driver
      ? { status: t.speedMph > 0 ? "driving" : "onDuty", driveRemainingMs: t.driveHoursLeft * H, shiftRemainingMs: (t.driveHoursLeft + 2) * H, cycleRemainingMs: 38 * H, breakRemainingMs: 3 * H, fetchedAt: at(-0.05) }
      : null,
    position: hasGps
      ? { place: nearestWords(pos), lat: pos.lat, lng: pos.lng, speedMph: t.speedMph, sampledAt: at(-0.01), ageSeconds: 36 }
      : null,
    fuelPercent: t.fuelPercent,
    current: cur ? boardLoad(t, cur, true) : null,
    next: t.next ? boardLoad(t, t.next, false) : null,
    eta: cur && etaAt !== null ? { at: at(etaAt), miles: milesLeft ?? 0, restAdded: t.driveHoursLeft < 2 } : null,
    onTime: !cur || !hasGps ? "unknown" : t.story === "late" ? "late" : t.story === "at_risk" ? "at_risk" : "on_time",
    available: { place: avail.place, city: avail.city, state: avail.state, postalCode: avail.postalCode, lat: avail.lat, lng: avail.lng, at: avail.at, basis: avail.basis },
    milesLeft: hasGps ? milesLeft : null,
    warnings: t.warnings.map((w) => ({ unit: w.unit, kind: w.kind, verdict: w.verdict, dueOn: w.dueInDays === null ? null : dayOffset(w.dueInDays), milesLeft: w.milesLeft })),
    flags: {
      lateRisk: t.story === "late" || t.story === "at_risk", noNextLoad: !t.next, emptyNow: !cur,
      hosLow: !!t.driver && t.driveHoursLeft < 2, noGps: !hasGps, warningUrgent: urgent,
    },
  };
}

/** `GET /api/livemap/dispatch-board` — the one route on this surface with an `{ ok, data }` body. */
export function dispatchBoard(): { ok: true; data: DispatchBoardResponse } {
  const data = dispatchBoardResponseSchema.parse({
    generatedAt: at(0), rows: TRUCKS.map(boardRow),
    scope: { linked: true, fleetCodes: [DISPATCHER.fleet], dispatcherIds: [DISPATCHER.mcleodId] },
    fleets: FLEETS, dispatchers: DISPATCHERS, uncoveredCount: UNCOVERED.length, hosAsOf: at(-0.05),
  });
  return { ok: true, data };
}

// ── live map ──────────────────────────────────────────────────────────────────────────────────

const mapStop = (p: Place, seq: number, kind: string, apptHours: number, status: string): LiveMapStop => ({
  seq, kind, name: p.name, city: p.city, state: p.state, appointmentStart: at(apptHours), appointmentEnd: at(apptHours + 2),
  status, addressLine: null, postalCode: p.postalCode,
});

/** Samsara's reverse-geocoded wording ("3 mi NW of Kokomo, IN"), approximated from the nearest city. */
function nearestWords(p: { lat: number; lng: number }): string {
  const places = Object.values(PLACES);
  const dist = (q: Place) => Math.hypot((q.lat - p.lat) * 69, (q.lng - p.lng) * 53);
  const near = places.reduce((a, b) => (dist(b) < dist(a) ? b : a));
  const miles = Math.round(dist(near));
  if (miles < 3) return `${near.city}, ${near.state}`;
  const compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(bearing(near, p) / 45) % 8];
  return `${miles} mi ${compass} of ${near.city}, ${near.state}`;
}

function mapVehicle(t: Truck): LiveMapVehicle {
  const pos = truckPosition(t);
  const ahead = t.current ? t.current.delivery : null;
  const sampledAt = at(-0.01);
  const engineState = t.speedMph > 0 ? "On" : t.current ? "Idle" : "Off";
  const position = {
    lat: pos.lat, lng: pos.lng, headingDegrees: ahead ? bearing(pos, ahead) : null, speedMph: t.speedMph, isEcuSpeed: true,
    formattedLocation: nearestWords(pos), sampledAt, receivedAt: sampledAt,
  };
  const cur = t.current;
  return {
    vehicleId: vehicleId(t.unit), unitNumber: t.unit, driver: t.driver ? { id: driverId(t.driver), name: t.driver } : null,
    position,
    state: deriveVehicleState({ sampledAt, speedMph: t.speedMph, engineState }, NOW),
    engineState, inShop: t.story === "shop", ageSeconds: 36, fuel: { percent: t.fuelPercent, at: at(-0.1) },
    load: cur
      ? {
          id: loadId(cur.ref), ref: cur.ref, status: "in_transit", source: "tms", externalStatus: "P",
          nextStop: mapStop(cur.delivery, 2, "dropoff", cur.deliverAt, "pending"),
          pickup: mapStop(cur.pickup, 1, "pickup", cur.pickupAt, "completed"),
          delivery: mapStop(cur.delivery, 2, "dropoff", cur.deliverAt, "pending"), extraStops: 0,
        }
      : null,
  };
}

/** `GET /api/livemap/positions` — `{ ok, data }`, like the board. A truck with no GPS is `untracked`. */
export function liveMapPositions(): { ok: true; data: LiveMapBoard } {
  const tracked = TRUCKS.filter((t) => t.story !== "no_gps");
  return {
    ok: true,
    data: {
      generatedAt: at(0), scope: "all", scopeReason: "Showing every truck in the fleet.",
      bounds: { stoppedSpeedMph: STOPPED_SPEED_MPH, engineOnBoundSeconds: ENGINE_ON_BOUND_SECONDS, offlineBoundSeconds: OFFLINE_BOUND_SECONDS, fuelFreshSeconds: FUEL_FRESH_SECONDS },
      vehicles: tracked.map(mapVehicle),
      untracked: TRUCKS.filter((t) => t.story === "no_gps").map((t) => ({ vehicleId: vehicleId(t.unit), unitNumber: t.unit })),
      truncated: false,
    },
  };
}

/** `GET /api/livemap/loads/:id/route` — raw, like every other `/api` read but the two above. */
export function loadRoute(id: string): LiveMapLoadRoute | null {
  const t = TRUCKS.find((x) => x.current && loadId(x.current.ref) === id);
  if (!t?.current) return null;
  const l = t.current;
  const line = routeLine(l.pickup, l.delivery);
  const split = Math.round(t.progress * ROUTE_STEPS);
  const hours = (l.deliverAt - l.pickupAt) * 0.8;
  return {
    loadId: id, covered: line.slice(0, split + 1), ahead: line.slice(split), distanceMiles: l.miles, durationHours: hours,
    aheadMiles: Math.round(l.miles * (1 - t.progress)), aheadHours: hours * (1 - t.progress), fromTruck: false,
    truckOnRoute: true, coveredMiles: Math.round(l.miles * t.progress), offRouteMiles: 0, fuelStops: [],
    start: { lat: l.pickup.lat, lng: l.pickup.lng, name: l.pickup.name, kind: "pickup" },
    end: { lat: l.delivery.lat, lng: l.delivery.lng, name: l.delivery.name, kind: "dropoff" },
    fuelNote: null, hazmatNotApplied: false,
  };
}

export function drivenPath(id: string): { loadId: string; points: { lat: number; lng: number }[]; since: string | null; capped: boolean; note: string | null } {
  const route = loadRoute(id);
  return { loadId: id, points: route?.covered ?? [], since: route ? at(-3) : null, capped: false, note: route ? null : "This load has not left its pickup." };
}

// ── loads ─────────────────────────────────────────────────────────────────────────────────────

function dispatchStop(p: Place, seq: number, kind: "pickup" | "dropoff", apptHours: number, done: boolean): DispatchStop & { id: string } {
  return {
    id: `${seq}`, seq, kind, name: p.name, address_line: null, city: p.city, state: p.state, postal_code: p.postalCode,
    appointment_start: at(apptHours), appointment_end: at(apptHours + 2), required_photos: [], notes: null,
    status: done ? "completed" : "pending", location_name: p.name, external_status: done ? "D" : null,
    actual_arrival_at: done ? at(apptHours + 0.25) : null, actual_departure_at: done ? at(apptHours + 1.25) : null, eta_at: null,
  };
}

function dispatchLoad(l: LoadPlan, status: DispatchLoad["status"], truck: string | null, driver: string | null): DispatchLoad {
  const delivered = status === "delivered";
  const onTruck = status === "in_transit";
  const stops = [
    dispatchStop(l.pickup, 1, "pickup", l.pickupAt, delivered || onTruck),
    dispatchStop(l.delivery, 2, "dropoff", l.deliverAt, delivered),
  ];
  const t = TRUCKS.find((x) => x.unit === truck);
  return {
    id: loadId(l.ref), ref: l.ref, status, equipment: l.trailer.startsWith("R") ? "Reefer" : "Dry van", commodity: l.commodity,
    hazmat: l.hazmat, hazmat_status: null, total_miles: l.miles, driver_id: driver ? driverId(driver) : null,
    vehicle_id: truck ? vehicleId(truck) : null, trailer_id: null, driver_name: driver, co_driver_id: null, co_driver_name: null,
    loaded: true, vehicle_unit: truck, trailer_unit: truck ? l.trailer : null, source: "tms", provider: "mcleod",
    submitted_at: null, declined_at: null, cancel_reason: null, notes: null, created_at: at(l.pickupAt - 48), stops,
    last_dispatch: null, external_status: onTruck ? "P" : delivered ? "D" : "A", external_synced_at: at(-0.02),
    dispatcher_external_id: t ? dispatcherOf(t) : null,
    dispatcher_name: t ? (DISPATCHERS.find((d) => d.id === dispatcherOf(t))?.name ?? null) : null, customer_name: l.customer,
  };
}

export function allLoads(): DispatchLoad[] {
  return [
    ...TRUCKS.flatMap((t) => (t.current ? [dispatchLoad(t.current, "in_transit", t.unit, t.driver)] : [])),
    ...TRUCKS.flatMap((t) => (t.next ? [dispatchLoad(t.next, "approved", t.unit, t.driver)] : [])),
    ...UNCOVERED.map((l) => dispatchLoad(l, "pending_approval", null, null)),
    ...DELIVERED.map((l) => ({ ...dispatchLoad(l, "delivered", l.truck, l.driver), completed_at: at(l.deliverAt + 1) })),
  ];
}

/** `GET /api/dispatch/loads/:id` — the detail read, with nothing the list does not already know. */
export function loadDetail(id: string): { load: LoadDetail } | null {
  const l = allLoads().find((x) => x.id === id);
  if (!l) return null;
  return {
    load: {
      ...l, created_by: null, approved_by: null, approved_at: null, released_at: null, assigned_by: null, assigned_at: null,
      accepted_at: null, completed_at: l.status === "delivered" ? l.stops[1]?.actual_departure_at ?? null : null,
      decline_reason: null, external_id: l.ref.replace("DF-", ""), updated_at: at(-0.02),
      stops: l.stops.map((s) => ({ ...s, id: `${l.id}-${s.seq}`, status: s.status ?? "pending", arrived_at: s.actual_arrival_at ?? null, completed_at: s.actual_departure_at ?? null, skip_reason: null, photos: [] })),
      events: [], hazmat_record: null, dispatches: [],
    },
  };
}

export function driverRows(): Array<Record<string, unknown>> {
  return TRUCKS.filter((t) => t.driver).map((t) => ({
    id: driverId(t.driver!), org_id: null, user_id: null, full_name: t.driver, employee_id: null, phone: null, status: "active",
    samsara_driver_id: null, samsara_username: null, current_hos_status: null, current_hos_vehicle: t.unit, current_hos_at: null,
    current_location: null, app_username: null, app_access_enabled: false, identity_source: "mcleod", created_at: at(-2000),
    updated_at: at(-1), archived_at: null,
  }));
}

/** Every trailer a load in the world rides on — the calculator's "From my fleet" picker reads these. */
export function trailerRows(): Array<Record<string, unknown>> {
  const units = new Set(TRUCKS.flatMap((t) => [t.current?.trailer, t.next?.trailer]).filter((u): u is string => !!u));
  return [...units].sort().map((unit) => ({
    id: `00000000-0000-4000-8000-0000000e${unit.replace(/\D/g, "").padStart(4, "0")}`, unit_number: unit,
    trailer_type: unit.startsWith("R") ? "reefer" : "dry_van", cargo_capacity_gal: null, cargo_compartments: null,
  }));
}
