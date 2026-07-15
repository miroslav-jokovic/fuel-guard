/**
 * Smart-fueling orchestrator (Phase 5): dispatcher route → HERE truck route → corridor stations + prices →
 * live truck fuel/HOS state → the pure solver → an enriched, read-only plan. Degrades EXPLICITLY at every
 * missing dependency (no HERE key, no stations, no live telematics) rather than fabricating a plan.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveRouteFuelConfig, effectiveTruckProfile, buildTruckFuelState, planFuelStops, stationsAlongRoute,
  milesFromMeters, type SolverStation, type LatLng, type HazmatClass, type TunnelCategory, type TruckFuelState,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { getOrComputeRoute } from "./routeGeometry.js";
import { breakFuelAdvice } from "@fuelguard/shared";
import { NoHereKeyError } from "../lib/here.js";
import { geocodeAddress } from "./geocode.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { makeSamsaraFetcher, makeSamsaraHosFetcher } from "../lib/samsara.js";

export interface PlanPoint { lat?: number | null; lng?: number | null; text?: string | null }
export interface PlanRequest {
  vehicleId: string;
  origin: PlanPoint;
  destination: PlanPoint;
  waypoints?: PlanPoint[];
  loadGrossLb?: number | null;
  hazmat?: HazmatClass[];
  tunnelCategory?: TunnelCategory | null;
}

export interface PlanStopView {
  kind: "fuel" | "rest";
  milesAhead: number;
  stationLat: number | null;
  stationLng: number | null;
  stationName: string | null;
  brand: string | null;
  state: string | null;
  exit: string | null;
  storeNumber: string | null;
  detourMiles: number;
  gallons: number;
  netPrice: number | null;
  priceAgeHours: number | null;
  cost: number | null;
  arrivalGal: number;
  isEmergency: boolean;
  coversBreak: boolean;
  isOvernight: boolean;
  driveHoursLeftOnArrival: number | null;
}

/** Interpolate the lat/lng at a given cumulative mile along the route polyline (positions rest stops on the map). */
function pointAtMile(poly: LatLng[], targetMi: number): { lat: number; lng: number } | null {
  if (poly.length === 0) return null;
  const havMi = (a: LatLng, b: LatLng) => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s1 = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 3958.8 * 2 * Math.atan2(Math.sqrt(s1), Math.sqrt(1 - s1));
  };
  let cum = 0;
  for (let i = 1; i < poly.length; i++) {
    const seg = havMi(poly[i - 1]!, poly[i]!);
    if (cum + seg >= targetMi) {
      const t = seg > 0 ? (targetMi - cum) / seg : 0;
      return { lat: poly[i - 1]!.lat + (poly[i]!.lat - poly[i - 1]!.lat) * t, lng: poly[i - 1]!.lng + (poly[i]!.lng - poly[i - 1]!.lng) * t };
    }
    cum += seg;
  }
  return poly[poly.length - 1]!;
}

export type PlanResultStatus = "ok" | "emergency_used" | "infeasible" | "routing_unavailable" | "no_stations" | "telematics_unavailable" | "error";

export interface PlanResult {
  status: PlanResultStatus;
  message?: string;
  plan?: {
    stops: PlanStopView[];
    totalGallons: number;
    totalCost: number | null;
    savingsVsNaive: number | null;
    arrivalFuelPct: number | null;
    reachesDestination: boolean;
    flags: string[];
  };
  route?: { distanceMiles: number; durationHours: number; polyline: LatLng[]; directions: { instruction: string; miles: number }[] };
  truck?: ReturnType<typeof truckStateView>;
  breakAdvice?: { breakDueMiles: number | null; breakDueHours: number | null; coincidesStopIndex: number | null; savesMinutes: number };
  origin?: LatLng;
  destination?: LatLng;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

async function resolvePoint(env: Env, p: PlanPoint): Promise<LatLng | null> {
  if (p.lat != null && p.lng != null) return { lat: p.lat, lng: p.lng };
  if (p.text) return geocodeAddress(env, p.text);
  return null;
}

export async function planFuelRoute(admin: SupabaseClient, env: Env, orgId: string, req: PlanRequest): Promise<PlanResult> {
  const { data: settingsRow } = await admin.from("route_fuel_settings").select("*").eq("org_id", orgId).maybeSingle();
  const cfg = resolveRouteFuelConfig(settingsRow);

  const { data: veh } = await admin
    .from("vehicles")
    .select("id, samsara_vehicle_id, tank_capacity_gal, observed_max_fill_gal, baseline_mpg, height_in, length_in, width_in, axle_count")
    .eq("id", req.vehicleId).eq("org_id", orgId).maybeSingle();
  if (!veh) return { status: "error", message: "Vehicle not found" };

  const { data: reeferTrailers } = await admin.from("trailers").select("id").eq("org_id", orgId).eq("assigned_vehicle_id", req.vehicleId).eq("is_reefer", true).limit(1);
  const isReefer = ((reeferTrailers ?? []) as unknown[]).length > 0;

  const origin = await resolvePoint(env, req.origin);
  const destination = await resolvePoint(env, req.destination);
  if (!origin || !destination) return { status: "error", message: "Could not resolve the origin or destination address" };
  const via: LatLng[] = [];
  for (const w of req.waypoints ?? []) { const pt = await resolvePoint(env, w); if (pt) via.push(pt); }

  const profile = effectiveTruckProfile(
    { heightIn: veh.height_in, lengthIn: veh.length_in, widthIn: veh.width_in, axleCount: veh.axle_count, grossWeightLb: req.loadGrossLb ?? null },
    cfg,
  );

  let route;
  try {
    route = await getOrComputeRoute(admin, env, { origin, via, destination, profile, hazmat: req.hazmat, tunnelCategory: req.tunnelCategory ?? null });
  } catch (e) {
    if (e instanceof NoHereKeyError) return { status: "routing_unavailable", message: "Route planning needs a HERE routing key — configure HERE_API_KEY to enable it.", origin, destination };
    return { status: "error", message: e instanceof Error ? e.message : "Routing failed", origin, destination };
  }
  const distanceMiles = milesFromMeters(route.distanceMeters);
  const directions = route.steps.map((st) => ({ instruction: st.instruction, miles: r1(milesFromMeters(st.lengthMeters)) }));
  const routeView = { distanceMiles: r1(distanceMiles), durationHours: r1(route.durationSeconds / 3600), polyline: route.polyline, directions };

  const truckData = await fetchTruckFuelState(admin, env, orgId, veh, isReefer, cfg, req.loadGrossLb ?? null);
  if (!truckData) return { status: "telematics_unavailable", message: "Could not read live fuel level / HOS for this truck.", route: routeView, origin, destination };
  const truck = truckData.state;
  const truckView = truckStateView(truck, truckData.hos);
  const avgSpeedMph = routeView.durationHours > 0 ? distanceMiles / routeView.durationHours : 55;
  const breakDue = breakFuelAdvice({ timeUntilBreakMs: truckData.hos.timeUntilBreakMs, avgSpeedMph, stopsMilesAhead: [] });

  // Single-pass bbox — a spread of Math.min(...polyline) overflows the call stack on a long route.
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const pt of route.polyline) {
    if (pt.lat < minLat) minLat = pt.lat;
    if (pt.lat > maxLat) maxLat = pt.lat;
    if (pt.lng < minLng) minLng = pt.lng;
    if (pt.lng > maxLng) maxLng = pt.lng;
  }
  const pad = 0.1;
  const { data: stationRows } = await admin
    .from("fuel_stations")
    .select("id, brand, store_number, name, lat, lng, state, exit, has_diesel")
    .eq("status", "active")
    .gte("lat", minLat - pad).lte("lat", maxLat + pad)
    .gte("lng", minLng - pad).lte("lng", maxLng + pad);
  const stations = (stationRows ?? []) as Array<{ id: string; brand: string; store_number: string | null; name: string | null; lat: number | string; lng: number | string; state: string | null; exit: string | null }>;
  if (stations.length === 0) return { status: "no_stations", message: "No fuel stations are loaded for this corridor yet.", route: routeView, truck: truckView, breakAdvice: breakDue, origin, destination };

  const stationIds = stations.map((s) => s.id);
  const { data: priceRows } = await admin
    .from("fuel_prices").select("station_id, net_price, observed_at").eq("org_id", orgId).eq("product", "diesel")
    .in("station_id", stationIds).order("observed_at", { ascending: false });
  const priceByStation = new Map<string, { net: number | null; at: string }>();
  for (const pr of (priceRows ?? []) as Array<{ station_id: string; net_price: number | string | null; observed_at: string }>)
    if (!priceByStation.has(pr.station_id)) priceByStation.set(pr.station_id, { net: pr.net_price != null ? Number(pr.net_price) : null, at: pr.observed_at });

  const candidates = stationsAlongRoute(route.polyline, stations.map((s) => ({ id: s.id, lat: Number(s.lat), lng: Number(s.lng) })), origin, { corridorMiles: cfg.corridorMiles });
  const stationById = new Map(stations.map((s) => [s.id, s]));
  // Price TTL: a price older than the org's window is treated as UNKNOWN (excluded from cheapest-selection),
  // so the solver won't route to a "cheap" station on a stale quote. Counted + surfaced as a plan flag.
  const now0 = Date.now();
  let stalePrices = 0;
  const solverStations: SolverStation[] = candidates.map((c) => {
    const s = stationById.get(c.station.id)!;
    const price = priceByStation.get(c.station.id);
    let net = price?.net ?? null;
    if (net != null && price && (now0 - Date.parse(price.at)) / 3_600_000 > cfg.priceTtlHours) { net = null; stalePrices += 1; }
    return { id: c.station.id, brand: s.brand, state: s.state, milesAhead: c.alongTrackMiles, detourMiles: c.detourMiles, netPrice: net };
  });

  const plan = planFuelStops({
    distanceToGoMiles: distanceMiles,
    stations: solverStations,
    truck,
    settings: cfg,
    avgSpeedMph,
    hos: {
      driveRemainingMs: truckData.hos.driveRemainingMs,
      shiftRemainingMs: truckData.hos.shiftRemainingMs,
      cycleRemainingMs: truckData.hos.cycleRemainingMs,
      breakRemainingMs: truckData.hos.timeUntilBreakMs,
    },
  });
  const stops: PlanStopView[] = plan.stops.map((st) => {
    const s = st.station ? stationById.get(st.station.id) ?? null : null;
    const price = st.station ? priceByStation.get(st.station.id) : undefined;
    const pos = s ? { lat: Number(s.lat), lng: Number(s.lng) } : pointAtMile(route.polyline, st.milesAhead);
    return {
      kind: st.kind,
      milesAhead: r1(st.milesAhead),
      stationLat: pos?.lat ?? null, stationLng: pos?.lng ?? null,
      stationName: s ? (s.name ?? s.brand) : null, brand: s?.brand ?? null, state: s?.state ?? null, exit: s?.exit ?? null, storeNumber: s?.store_number ?? null,
      detourMiles: st.station ? r1(st.station.detourMiles) : 0, gallons: r1(st.fillGal),
      netPrice: st.netPrice, priceAgeHours: price ? Math.round((Date.now() - Date.parse(price.at)) / 3_600_000) : null,
      cost: st.cost != null ? Math.round(st.cost * 100) / 100 : null, arrivalGal: r1(st.arrivalGal), isEmergency: st.isEmergency,
      coversBreak: st.coversBreak, isOvernight: st.isOvernight, driveHoursLeftOnArrival: st.driveHoursLeftOnArrival != null ? r1(st.driveHoursLeftOnArrival) : null,
    };
  });

  const breakAdvice = breakFuelAdvice({ timeUntilBreakMs: truckData.hos.timeUntilBreakMs, avgSpeedMph, stopsMilesAhead: plan.stops.filter((st) => st.kind === "fuel").map((st) => st.milesAhead) });
  const planFlags = stalePrices > 0 ? [...plan.flags, "stale_prices_excluded"] : plan.flags;
  const planMessage = describePlan(plan.status, planFlags);
  return {
    status: plan.status,
    message: planMessage,
    plan: { stops, totalGallons: r1(plan.totalGallons), totalCost: plan.totalCost, savingsVsNaive: plan.savingsVsNaive, arrivalFuelPct: plan.arrivalFuelPct, reachesDestination: plan.reachesDestination, flags: planFlags },
    route: routeView, truck: truckView, breakAdvice, origin, destination,
  };
}

/** Human, actionable explanation for the plan banner — especially why an infeasible/emergency plan happened. */
function describePlan(status: string, flags: string[]): string | undefined {
  if (status === "infeasible") {
    if (flags.includes("no_fuel_reading_cannot_plan"))
      return "No live fuel level for this truck, so a safe plan can't be built. Check the truck's Samsara fuel sensor or pick a truck with a current reading.";
    return "The truck can't reach a fuel stop on this route without dropping below its safety reserve. Load stations along this corridor (or widen the corridor buffer in Settings), or the driver must refuel before continuing.";
  }
  if (status === "emergency_used") {
    if (flags.includes("avoided_state_fill_used"))
      return "Planned to fuel before the avoided state (e.g. California); a capped emergency splash inside it was still needed to reach the destination safely.";
    return "An emergency stop was needed — no preferred station was reachable in one gap. Buying only enough to reach the next preferred stop.";
  }
  return undefined;
}

/** Read the truck's live fuel samples (last ~3h) + current HOS clocks and compose the TruckFuelState. */
async function fetchTruckFuelState(
  admin: SupabaseClient, env: Env, orgId: string,
  veh: { samsara_vehicle_id: string | null; tank_capacity_gal: number | string; observed_max_fill_gal: number | string | null; baseline_mpg: number | string | null },
  isReefer: boolean, cfg: ReturnType<typeof resolveRouteFuelConfig>, loadGrossLb: number | null,
): Promise<{ state: TruckFuelState; hos: HosClocks } | null> {
  const token = await loadSamsaraToken(admin, env, orgId);
  if (!token || !veh.samsara_vehicle_id) return null;
  const now = Date.now();
  let fuelSamples: { time: string; value: number }[];
  try {
    const res = (await makeSamsaraFetcher(env, token)(String(veh.samsara_vehicle_id), new Date(now - 3 * 3_600_000).toISOString(), new Date(now).toISOString())) as { data: Array<{ id?: string | number; fuelPercents?: Array<{ time: string; value: number | string }> }> };
    const v = res.data.find((x) => String(x.id) === String(veh.samsara_vehicle_id)) ?? res.data[0];
    fuelSamples = (v?.fuelPercents ?? []).map((fp) => ({ time: fp.time, value: Number(fp.value) })).filter((fp) => Number.isFinite(fp.value));
  } catch {
    return null;
  }
  let hos = { driveRemainingMs: null as number | null, shiftRemainingMs: null as number | null, cycleRemainingMs: null as number | null, timeUntilBreakMs: null as number | null };
  try {
    const h = (await makeSamsaraHosFetcher(env, token)()).get(String(veh.samsara_vehicle_id));
    if (h) hos = h;
  } catch { /* HOS best-effort; solver flags no_hos */ }

  const state = buildTruckFuelState(
    {
      fuelSamples, tankCapacityGal: Number(veh.tank_capacity_gal), observedMaxFillGal: veh.observed_max_fill_gal != null ? Number(veh.observed_max_fill_gal) : null,
      baselineMpg: veh.baseline_mpg != null ? Number(veh.baseline_mpg) : null, hos, isReefer, loadGrossLb, lastFillTimeMs: null, nowMs: now,
    },
    { reservePct: cfg.reservePct, mpgSafetyFactor: cfg.mpgSafetyFactor },
  );
  return { state, hos };
}

interface HosClocks { driveRemainingMs: number | null; shiftRemainingMs: number | null; cycleRemainingMs: number | null; timeUntilBreakMs: number | null; }

/** Compact truck telematics view for the Route panel: fuel level + all four HOS clocks (hours). */
function truckStateView(state: TruckFuelState, hos: HosClocks) {
  const hrs = (ms: number | null) => (ms != null ? Math.round((ms / 3_600_000) * 10) / 10 : null);
  const fuelPct = state.gallonsOnHand != null && state.effectiveTankCapacityGal > 0
    ? Math.round((state.gallonsOnHand / state.effectiveTankCapacityGal) * 100)
    : null;
  return {
    fuelPct,
    gallonsOnHand: state.gallonsOnHand != null ? r1(state.gallonsOnHand) : null,
    tankCapacityGal: r1(state.effectiveTankCapacityGal),
    driveRemainingHours: hrs(hos.driveRemainingMs),
    breakInHours: hrs(hos.timeUntilBreakMs),
    shiftRemainingHours: hrs(hos.shiftRemainingMs),
    cycleRemainingHours: hrs(hos.cycleRemainingMs),
    reachableMiles: state.reachableMiles != null ? r1(state.reachableMiles) : null,
    fuelRangeMiles: state.fuelRangeMiles != null ? r1(state.fuelRangeMiles) : null,
  };
}
