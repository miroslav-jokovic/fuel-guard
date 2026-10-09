import type { SupabaseClient } from "@supabase/supabase-js";
import {
  effectiveTruckProfile,
  milesFromMeters,
  routeLengthMiles,
  splitRouteAt,
  type LatLng,
  type LiveMapLoadRoute,
  type RouteSplit,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { NoHereKeyError } from "../../lib/here.js";
import { readLoadForRoute } from "../loads/index.js";
import { getOrComputeRoute, loadPlanningTruck, readStationAddresses, solveOnRoute, type PlanResult } from "../routing/index.js";
import { readVehiclePositions } from "../samsara/index.js";

/**
 * A load's route on the live map (TRUCK-CARD-ROUTE-PLAN TC3).
 *
 * ── ONE LINE, AND THE FUEL STOPS ARE PLANNED ON IT (D-TC6) ───────────────────────────────────────
 * The route is computed once, pickup → every stop → delivery, through `getOrComputeRoute` with the
 * fleet's standard truck (the org's planning settings, D-TC3's note), so its cache key holds only the
 * stops and a second press costs no HERE call. The solver then runs on the part of THAT line still
 * ahead of the truck, from the truck's live fuel. Planning from the truck's position instead would be a
 * second route, whose stops need not lie on the line drawn, and a cache miss on every press.
 *
 * ── OFF THE ROUTE, OR NOT YET AT THE PICKUP (Q-TC1, ruled (a)) ───────────────────────────────────
 * A truck farther than `OFF_ROUTE_MILES` from the line gets no split: the whole line is "ahead", and
 * the fuel stops are planned from the pickup with today's fuel. The card says the truck is off it.
 *
 * ── HAZMAT (Q-TC2, ruled (a)) ────────────────────────────────────────────────────────────────────
 * The classes come from the load's CLEARED hazmat record. Production holds no `hazmat_loads` row and no
 * hazmat-marked load on a truck (measured 2026-10-09), so reading the classes is TC4's work, and until
 * it lands a hazmat-marked load is routed without restrictions and SAYS so (`hazmatNotApplied`), never
 * silently.
 */
export type LoadRouteAnswer =
  | { ok: true; route: LiveMapLoadRoute }
  | { ok: false; status: 404 | 409 | 503; code: string; message: string };

export async function readLoadRoute(admin: SupabaseClient, env: Env, orgId: string, loadId: string): Promise<LoadRouteAnswer> {
  const load = await readLoadForRoute(admin, orgId, loadId);
  if (!load) return { ok: false, status: 404, code: "not_found", message: "That load no longer exists" };
  if (load.stops.length < 2) {
    return { ok: false, status: 409, code: "no_route", message: "This load has fewer than two stops with a location, so there is no route to draw." };
  }
  if (!load.vehicleId) return { ok: false, status: 409, code: "no_truck", message: "This load has no truck on it." };
  const truck = await loadPlanningTruck(admin, orgId, load.vehicleId, null);
  if (!truck) return { ok: false, status: 404, code: "not_found", message: "This load's truck is not on the roster." };

  const points: LatLng[] = load.stops.map((s) => ({ lat: s.lat, lng: s.lng }));
  const profile = effectiveTruckProfile(
    { heightIn: truck.veh.height_in, lengthIn: truck.veh.length_in, widthIn: truck.veh.width_in, axleCount: truck.veh.axle_count, grossWeightLb: null },
    truck.cfg,
  );
  let route;
  try {
    route = await getOrComputeRoute(admin, env, {
      origin: points[0]!, via: points.slice(1, -1), destination: points.at(-1)!, profile, hazmat: [], tunnelCategory: null, avoidTunnels: false,
    });
  } catch (e) {
    if (e instanceof NoHereKeyError) return { ok: false, status: 503, code: "routing_unavailable", message: "Route planning is not configured." };
    throw e;
  }

  const position = (await readVehiclePositions(admin, orgId)).rows.find((p) => p.vehicle_id === load.vehicleId) ?? null;
  const split: RouteSplit = position
    ? splitRouteAt(route.polyline, { lat: Number(position.lat), lng: Number(position.lng) })
    : { covered: [], ahead: route.polyline, coveredMiles: 0, offRouteMiles: Infinity, onRoute: false };

  // The slice's distance and time, by the share of the line still ahead: HERE timed the whole route,
  // and the part behind the truck is driven.
  const share = split.onRoute ? Math.max(0, 1 - split.coveredMiles / Math.max(routeLengthMiles(route.polyline), 1e-9)) : 1;
  const plan = await solveOnRoute(admin, env, orgId, {
    ...truck,
    route: { polyline: split.ahead, distanceMeters: route.distanceMeters * share, durationSeconds: route.durationSeconds * share, steps: [] },
    origin: split.ahead[0]!,
    destination: points.at(-1)!,
    loadGrossLb: null,
    manualFuelPct: null,
    manualHos: null,
  });

  const fuel = (plan.plan?.stops ?? []).filter((s) => s.kind === "fuel" && s.stationLat != null && s.stationLng != null);
  const addresses = await readStationAddresses(admin, fuel.map((s) => s.stationId).filter((id): id is string => id != null));
  return {
    ok: true,
    route: {
      loadId: load.id,
      covered: split.covered,
      ahead: split.ahead,
      distanceMiles: Math.round(milesFromMeters(route.distanceMeters) * 10) / 10,
      durationHours: Math.round((route.durationSeconds / 3600) * 10) / 10,
      truckOnRoute: split.onRoute,
      coveredMiles: Math.round(split.coveredMiles * 10) / 10,
      offRouteMiles: position ? Math.round(split.offRouteMiles * 10) / 10 : null,
      fuelStops: fuel.map((s) => {
        const a = s.stationId ? addresses.get(s.stationId) : undefined;
        return {
          name: s.stationName, brand: s.brand, address: a?.address ?? null, city: a?.city ?? null, state: s.state,
          zip: a?.zip ?? null, exit: s.exit, lat: s.stationLat!, lng: s.stationLng!, milesAhead: s.milesAhead,
        };
      }),
      fuelNote: fuelNote(plan, fuel.length),
      hazmatNotApplied: load.hazmat,
    },
  };
}

/**
 * The planner's answer in the map's words. Its own messages are written for the Fuel planning page,
 * which can ask for a fuel level by hand; the map cannot, so "enter the current fuel level" is not said.
 */
function fuelNote(plan: PlanResult, stops: number): string | null {
  if (plan.status === "telematics_unavailable") return "No live fuel reading for this truck, so no fuel stops are planned.";
  if (plan.status === "routing_unavailable" || plan.status === "error") return "Fuel stops could not be planned for this route.";
  if (plan.status === "no_stations") return "No fuel stations are loaded along this route.";
  if (plan.status === "infeasible") return "The truck cannot reach a fuel stop on this route above its safety reserve.";
  if (stops === 0) return "No fuel stop needed to reach the delivery.";
  return plan.message ?? null;
}
