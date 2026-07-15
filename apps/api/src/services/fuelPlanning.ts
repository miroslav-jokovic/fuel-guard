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
  stationName: string;
  brand: string;
  state: string | null;
  exit: string | null;
  storeNumber: string | null;
  milesAhead: number;
  detourMiles: number;
  gallons: number;
  netPrice: number | null;
  priceAgeHours: number | null;
  cost: number | null;
  arrivalGal: number;
  isEmergency: boolean;
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
  route?: { distanceMiles: number; polyline: LatLng[] };
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
  const routeView = { distanceMiles: r1(distanceMiles), polyline: route.polyline };

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
  if (stations.length === 0) return { status: "no_stations", message: "No fuel stations are loaded for this corridor yet.", route: routeView, origin, destination };

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

  const truck = await fetchTruckFuelState(admin, env, orgId, veh, isReefer, cfg);
  if (!truck) return { status: "telematics_unavailable", message: "Could not read live fuel level / HOS for this truck.", route: routeView, origin, destination };

  const plan = planFuelStops({ distanceToGoMiles: distanceMiles, stations: solverStations, truck, settings: cfg });
  const stops: PlanStopView[] = plan.stops.map((st) => {
    const s = stationById.get(st.station.id)!;
    const price = priceByStation.get(st.station.id);
    return {
      stationName: s.name ?? s.brand, brand: s.brand, state: s.state, exit: s.exit, storeNumber: s.store_number,
      milesAhead: r1(st.station.milesAhead), detourMiles: r1(st.station.detourMiles), gallons: r1(st.fillGal),
      netPrice: st.netPrice, priceAgeHours: price ? Math.round((Date.now() - Date.parse(price.at)) / 3_600_000) : null,
      cost: st.cost != null ? Math.round(st.cost * 100) / 100 : null, arrivalGal: r1(st.arrivalGal), isEmergency: st.isEmergency,
    };
  });

  const planFlags = stalePrices > 0 ? [...plan.flags, "stale_prices_excluded"] : plan.flags;
  return {
    status: plan.status,
    plan: { stops, totalGallons: r1(plan.totalGallons), totalCost: plan.totalCost, savingsVsNaive: plan.savingsVsNaive, arrivalFuelPct: plan.arrivalFuelPct, reachesDestination: plan.reachesDestination, flags: planFlags },
    route: routeView, origin, destination,
  };
}

/** Read the truck's live fuel samples (last ~3h) + current HOS clocks and compose the TruckFuelState. */
async function fetchTruckFuelState(
  admin: SupabaseClient, env: Env, orgId: string,
  veh: { samsara_vehicle_id: string | null; tank_capacity_gal: number | string; observed_max_fill_gal: number | string | null; baseline_mpg: number | string | null },
  isReefer: boolean, cfg: ReturnType<typeof resolveRouteFuelConfig>,
): Promise<TruckFuelState | null> {
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

  return buildTruckFuelState(
    {
      fuelSamples, tankCapacityGal: Number(veh.tank_capacity_gal), observedMaxFillGal: veh.observed_max_fill_gal != null ? Number(veh.observed_max_fill_gal) : null,
      baselineMpg: veh.baseline_mpg != null ? Number(veh.baseline_mpg) : null, hos, isReefer, loadGrossLb: null, lastFillTimeMs: null, nowMs: now,
    },
    { reservePct: cfg.reservePct, mpgSafetyFactor: cfg.mpgSafetyFactor },
  );
}
