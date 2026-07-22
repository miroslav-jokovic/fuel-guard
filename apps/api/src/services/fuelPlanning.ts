/**
 * Smart-fueling orchestrator (Phase 5): dispatcher route → HERE truck route → corridor stations + prices →
 * live truck fuel/HOS state → the pure solver → an enriched, read-only plan. Degrades EXPLICITLY at every
 * missing dependency (no HERE key, no stations, no live telematics) rather than fabricating a plan.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveRouteFuelConfig, effectiveTruckProfile, buildTruckFuelState, planFuelStops, stationsAlongRoute,
  milesFromMeters, resolveEffectivePrice, median, DEFAULT_PRICE_LOOKBACK_HOURS, findFirstBorderCrossingMile,
  type SolverStation, type LatLng, type HazmatClass, type TunnelCategory, type TruckFuelState, type PriceConfidence,
  type PostedQuote, type DiscountRule,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { getOrComputeRoute } from "./routeGeometry.js";
import { breakFuelAdvice } from "@fuelguard/shared";
import { NoHereKeyError } from "../lib/here.js";
import { geocodeAddress } from "./geocode.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { makeSamsaraFetcher, makeSamsaraHosFetcher } from "../lib/samsara.js";
import { hereReverseGeocodeState } from "../lib/hereGeocode.js";

/** Fuel % at/above which entering an avoided state does NOT require a pre-border top-off (California rule). 80% per policy. */
const BORDER_TOP_OFF_PCT = 80;

export interface PlanPoint { lat?: number | null; lng?: number | null; text?: string | null }
export interface PlanRequest {
  vehicleId: string;
  origin: PlanPoint;
  destination: PlanPoint;
  waypoints?: PlanPoint[];
  loadGrossLb?: number | null;
  /** Carrier's trailer/equipment for this load; 'reefer' turns on reefer-fuel modeling. */
  equipmentType?: string | null;
  hazmat?: HazmatClass[];
  tunnelCategory?: TunnelCategory | null;
  /** Route around ALL tunnels (safety for hazmat/oversized loads) — passed straight to HERE. */
  avoidTunnels?: boolean | null;
  /** Readable origin/destination labels (from the form) — stored on the saved plan for the history list. */
  originLabel?: string | null;
  destinationLabel?: string | null;
  /** Manual fuel level (0-100), used only when live telematics is unavailable for the truck. */
  manualFuelPct?: number | null;
  /** Optional manual HOS clocks (hours), used with manualFuelPct when telematics is unavailable. */
  manualHos?: { driveHours?: number | null; breakHours?: number | null; shiftHours?: number | null; cycleHours?: number | null } | null;
}

/** Why live telematics could not drive the plan (drives the UI message + manual-entry fallback). */
export type TelematicsReason = "not_linked" | "not_connected" | "unavailable" | "no_fuel_reading";

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
  /** This fuel stop is the mandated top-off just before entering a border state (e.g. the California border). */
  isBorderTopOff: boolean;
  /** The state being entered at a border top-off (e.g. "CA", "MA"), for the UI label. null otherwise. */
  borderState: string | null;
  /** This is a min-drawdown partial fill (bought only enough to reach the next cheaper stop), not a full top-off. */
  isMinFill: boolean;
  /** true = netPrice is a history/brand estimate, not a fresh quote (Phase 5). */
  priceEstimated: boolean;
  /** Confidence in an estimated price (null when the price is a fresh quote or unknown). */
  priceConfidence: PriceConfidence | null;
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

/**
 * Locate the route mile at which the truck first crosses INTO an avoided state (e.g. California), so the solver
 * can top the tank off just before the line. Only the "origin outside → destination inside" case qualifies:
 * a route that starts and ends in a border state, or never enters one, gets no border top-off.
 *
 * `borderStates` is the union of avoid-states (California — enter full to dodge pricey fuel) and fuel-before
 * states (Massachusetts — enter full because there's essentially one truck stop). Detection is identical for
 * both: 2 HERE reverse-geocodes to classify the endpoints, then a bounded binary search (~10 calls) to find the
 * crossing — and ONLY when the destination is inside a border state, so ordinary routes pay just the 2-call
 * check. The crossing itself is found by the pure, unit-tested `findFirstBorderCrossingMile` (coarse-scan +
 * refine, no single-crossing assumption, unknown lookups bias the border earlier = safe). Best-effort: any HERE
 * failure degrades to null and the plan proceeds without a pre-border top-off.
 */
async function findBorderTopOffMile(
  env: Env, borderStates: string[], poly: LatLng[], distanceMiles: number, origin: LatLng, destination: LatLng,
): Promise<{ mile: number; state: string } | null> {
  if (borderStates.length === 0 || poly.length < 2 || distanceMiles <= 0) return null;
  const set = new Set(borderStates.map((s) => s.toUpperCase()));
  const inSet = (s: string | null) => s != null && set.has(s.toUpperCase());
  const [originState, destState] = await Promise.all([
    hereReverseGeocodeState(env, origin.lat, origin.lng),
    hereReverseGeocodeState(env, destination.lat, destination.lng),
  ]);
  if (!inSet(destState) || inSet(originState)) return null; // not an outside→inside crossing
  const state = destState!.toUpperCase(); // the border state we're entering (the destination's)

  const classifyAtMile = async (mile: number): Promise<string | null> => {
    const pt = pointAtMile(poly, mile);
    return pt ? hereReverseGeocodeState(env, pt.lat, pt.lng) : null;
  };
  const mile = await findFirstBorderCrossingMile(distanceMiles, inSet, classifyAtMile);
  return mile != null ? { mile, state } : null;
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
  /** Set on telematics_unavailable: why, so the UI can prompt for manual fuel entry. */
  telematicsReason?: TelematicsReason;
  /** True when the plan was built from a manually-entered fuel level (no live telematics). */
  manualFuelUsed?: boolean;
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
  const isReefer = ((reeferTrailers ?? []) as unknown[]).length > 0 || req.equipmentType === "reefer";

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
    route = await getOrComputeRoute(admin, env, { origin, via, destination, profile, hazmat: req.hazmat, tunnelCategory: req.tunnelCategory ?? null, avoidTunnels: req.avoidTunnels ?? false });
  } catch (e) {
    if (e instanceof NoHereKeyError) return { status: "routing_unavailable", message: "Route planning needs a HERE routing key — configure HERE_API_KEY to enable it.", origin, destination };
    return { status: "error", message: e instanceof Error ? e.message : "Routing failed", origin, destination };
  }
  const distanceMiles = milesFromMeters(route.distanceMeters);
  const directions = route.steps.map((st) => ({ instruction: st.instruction, miles: r1(milesFromMeters(st.lengthMeters)) }));
  const routeView = { distanceMiles: r1(distanceMiles), durationHours: r1(route.durationSeconds / 3600), polyline: route.polyline, directions };

  const tele = await fetchTruckFuelState(admin, env, orgId, veh, isReefer, cfg, req.loadGrossLb ?? null);
  let truck: TruckFuelState;
  let hos: HosClocks;
  let manualFuelUsed = false;
  if (tele.ok && tele.state.gallonsOnHand != null) {
    // Live telematics with a real fuel reading — always preferred.
    truck = tele.state;
    hos = tele.hos;
  } else if (req.manualFuelPct != null) {
    // Fallback: dispatcher-entered fuel level (uses live HOS when present, else typed / none).
    const m = buildManualTruckState(veh, req.manualFuelPct, req.manualHos ?? null, tele.ok ? tele.hos : NULL_HOS, isReefer, cfg, req.loadGrossLb ?? null);
    truck = m.state;
    hos = m.hos;
    manualFuelUsed = true;
  } else {
    // Cannot plan without a fuel level — tell the dispatcher exactly why and prompt for manual entry.
    const reason: TelematicsReason = tele.ok ? "no_fuel_reading" : tele.reason;
    return { status: "telematics_unavailable", telematicsReason: reason, message: TELEMATICS_MESSAGE[reason], route: routeView, origin, destination };
  }
  const truckView = truckStateView(truck, hos);
  // Derive avg speed from the RAW route seconds (not the 1-decimal-rounded hours) so rounding error does not
  // bleed into every mile/break estimate downstream.
  const avgSpeedMph = route.durationSeconds > 0 ? distanceMiles / (route.durationSeconds / 3600) : 55;
  const breakDue = breakFuelAdvice({ timeUntilBreakMs: hos.timeUntilBreakMs, avgSpeedMph, stopsMilesAhead: [] });

  // Single-pass bbox — a spread of Math.min(...polyline) overflows the call stack on a long route.
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const pt of route.polyline) {
    if (pt.lat < minLat) minLat = pt.lat;
    if (pt.lat > maxLat) maxLat = pt.lat;
    if (pt.lng < minLng) minLng = pt.lng;
    if (pt.lng > maxLng) maxLng = pt.lng;
  }
  const pad = 0.1;
  // Hard registry filter: only networks this org has turned ON participate at all (solver policy —
  // preferred/avoid/emergency — then ranks within them).
  const { data: stationRows } = await admin
    .from("fuel_stations")
    .select("id, brand, store_number, name, lat, lng, state, exit, has_diesel")
    .eq("status", "active")
    .in("brand", cfg.enabledBrands)
    // NOTE: intentionally NOT filtering on has_diesel. Every enabled brand is a diesel truck-stop network by
    // definition, and the has_diesel flag is populated unreliably (Pilot locations derive it from an amenities
    // string; Love's from whether a diesel PRICE was present) — filtering on it dropped real diesel stops and
    // stranded routes. The brand filter already guarantees diesel.
    .gte("lat", minLat - pad).lte("lat", maxLat + pad)
    .gte("lng", minLng - pad).lte("lng", maxLng + pad);
  const stations = (stationRows ?? []) as Array<{ id: string; brand: string; store_number: string | null; name: string | null; lat: number | string; lng: number | string; state: string | null; exit: string | null }>;
  if (stations.length === 0) return { status: "no_stations", message: "No fuel stations are loaded for this corridor yet.", route: routeView, truck: truckView, breakAdvice: breakDue, manualFuelUsed, origin, destination };

  // Narrow to the on-route corridor FIRST, then pull price history only for those stations (fewer rows).
  const candidates = stationsAlongRoute(route.polyline, stations.map((s) => ({ id: s.id, lat: Number(s.lat), lng: Number(s.lng) })), origin, { corridorMiles: cfg.corridorMiles, oppositeSideAccessMiles: cfg.oppositeSideAccessMiles });
  const stationById = new Map(stations.map((s) => [s.id, s]));
  const candidateIds = candidates.map((c) => c.station.id);

  // Price history within the learning lookback, for estimating stations whose fresh quote is missing/stale.
  const now0 = Date.now();
  const lookbackHours = DEFAULT_PRICE_LOOKBACK_HOURS;
  const cutoffIso = new Date(now0 - lookbackHours * 3_600_000).toISOString();
  const historyByStation = new Map<string, { net: number | null; observedAtMs: number }[]>();
  const latestByStation = new Map<string, { net: number | null; at: string }>();
  for (let i = 0; i < candidateIds.length; i += 200) {
    const part = candidateIds.slice(i, i + 200);
    const { data: priceRows } = await admin
      .from("fuel_prices").select("station_id, net_price, observed_at").eq("org_id", orgId).eq("product", "diesel")
      .in("station_id", part).gte("observed_at", cutoffIso).order("observed_at", { ascending: false });
    for (const pr of (priceRows ?? []) as Array<{ station_id: string; net_price: number | string | null; observed_at: string }>) {
      const net = pr.net_price != null ? Number(pr.net_price) : null;
      (historyByStation.get(pr.station_id) ?? historyByStation.set(pr.station_id, []).get(pr.station_id)!).push({ net, observedAtMs: Date.parse(pr.observed_at) });
      if (!latestByStation.has(pr.station_id)) latestByStation.set(pr.station_id, { net, at: pr.observed_at }); // rows are observed_at DESC
    }
  }

  // GLOBAL posted layer: latest posted diesel quote per corridor station (currency/unit carried so the
  // resolver can reject non-USD/gal rows), plus the org's per-brand discount rules to derive net from it.
  const postedByStation = new Map<string, PostedQuote>();
  for (let i = 0; i < candidateIds.length; i += 200) {
    const part = candidateIds.slice(i, i + 200);
    const { data: postedRows } = await admin
      .from("fuel_prices_posted").select("station_id, price, currency, unit, observed_at").eq("product", "diesel")
      .in("station_id", part).gte("observed_at", cutoffIso).order("observed_at", { ascending: false });
    for (const pr of (postedRows ?? []) as Array<{ station_id: string; price: number | string; currency: string; unit: string; observed_at: string }>) {
      if (!postedByStation.has(pr.station_id))
        postedByStation.set(pr.station_id, { price: Number(pr.price), currency: pr.currency, unit: pr.unit, observedAtMs: Date.parse(pr.observed_at) });
    }
  }
  const { data: ruleRows } = await admin.from("fuel_discount_rules").select("brand, type, cents_off").eq("org_id", orgId);
  const ruleByBrand = new Map<string, DiscountRule>(
    ((ruleRows ?? []) as Array<{ brand: string; type: DiscountRule["type"]; cents_off: number | string }>).map((r) => [
      r.brand, { brand: r.brand, type: r.type, centsOff: Number(r.cents_off) },
    ]),
  );

  // Corridor brand medians (from FRESH quotes only) — the fallback when a station has no usable history of its own.
  const freshByBrand = new Map<string, number[]>();
  for (const c of candidates) {
    const s = stationById.get(c.station.id)!;
    const latest = latestByStation.get(c.station.id);
    if (latest?.net != null && (now0 - Date.parse(latest.at)) / 3_600_000 <= cfg.priceTtlHours)
      (freshByBrand.get(s.brand) ?? freshByBrand.set(s.brand, []).get(s.brand)!).push(latest.net);
  }
  const brandMedian = (brand: string): number | null => median(freshByBrand.get(brand) ?? []);

  // Plannable price per corridor station: fresh tenant net → fresh posted−rule → history → brand → none.
  const estByStation = new Map<string, ReturnType<typeof resolveEffectivePrice>>();
  const solverStations: SolverStation[] = candidates.map((c) => {
    const s = stationById.get(c.station.id)!;
    const est = resolveEffectivePrice({
      tenantSamples: historyByStation.get(c.station.id) ?? [],
      posted: postedByStation.get(c.station.id) ?? null,
      discountRule: ruleByBrand.get(s.brand) ?? null,
      brandMedian: brandMedian(s.brand),
      nowMs: now0,
      ttlHours: cfg.priceTtlHours,
      lookbackHours,
    });
    estByStation.set(c.station.id, est);
    return { id: c.station.id, brand: s.brand, state: s.state, milesAhead: c.alongTrackMiles, detourMiles: c.detourMiles, netPrice: est.net, priceEstimated: est.estimated };
  });

  // Border top-off: if this route enters a state we must fuel up before (California — pricey fuel; Massachusetts
  // — one truck stop), top the tank off just before the line (unless it'd already cross above BORDER_TOP_OFF_PCT).
  const border = await findBorderTopOffMile(env, [...cfg.avoidStates, ...cfg.fuelBeforeStates], route.polyline, distanceMiles, origin, destination);

  const plan = planFuelStops({
    distanceToGoMiles: distanceMiles,
    stations: solverStations,
    truck,
    settings: cfg,
    avgSpeedMph,
    avoidedBorderMiles: border?.mile ?? undefined,
    borderTopOffPct: BORDER_TOP_OFF_PCT,
    hos: {
      driveRemainingMs: hos.driveRemainingMs,
      shiftRemainingMs: hos.shiftRemainingMs,
      cycleRemainingMs: hos.cycleRemainingMs,
      breakRemainingMs: hos.timeUntilBreakMs,
    },
  });
  const stops: PlanStopView[] = plan.stops.map((st) => {
    const s = st.station ? stationById.get(st.station.id) ?? null : null;
    const latest = st.station ? latestByStation.get(st.station.id) : undefined;
    const est = st.station ? estByStation.get(st.station.id) : undefined;
    const pos = s ? { lat: Number(s.lat), lng: Number(s.lng) } : pointAtMile(route.polyline, st.milesAhead);
    return {
      kind: st.kind,
      milesAhead: r1(st.milesAhead),
      stationLat: pos?.lat ?? null, stationLng: pos?.lng ?? null,
      stationName: s ? (s.name ?? s.brand) : null, brand: s?.brand ?? null, state: s?.state ?? null, exit: s?.exit ?? null, storeNumber: s?.store_number ?? null,
      detourMiles: st.station ? r1(st.station.detourMiles) : 0, gallons: r1(st.fillGal),
      netPrice: st.netPrice, priceAgeHours: latest ? Math.round((Date.now() - Date.parse(latest.at)) / 3_600_000) : null,
      priceEstimated: est?.estimated ?? false, priceConfidence: est?.estimated ? est.confidence : null,
      cost: st.cost != null ? Math.round(st.cost * 100) / 100 : null, arrivalGal: r1(st.arrivalGal), isEmergency: st.isEmergency,
      coversBreak: st.coversBreak, isOvernight: st.isOvernight, driveHoursLeftOnArrival: st.driveHoursLeftOnArrival != null ? r1(st.driveHoursLeftOnArrival) : null,
      isBorderTopOff: st.isBorderTopOff, borderState: st.isBorderTopOff ? border?.state ?? null : null, isMinFill: st.isMinFill, isOffNetwork: st.isOffNetwork,
    };
  });

  const breakAdvice = breakFuelAdvice({ timeUntilBreakMs: hos.timeUntilBreakMs, avgSpeedMph, stopsMilesAhead: plan.stops.filter((st) => st.kind === "fuel").map((st) => st.milesAhead) });
  // Overweight safeguard: with no load weight entered, fills aren't capped for legal gross weight. Only warn when
  // it actually matters — a large single fill (~700+ lb of diesel) that could push a heavy truck over gross.
  const uncappedBigFill = truck.flags.includes("load_weight_unknown") && plan.stops.some((st) => st.kind === "fuel" && st.fillGal >= 100);
  const planFlags = manualFuelUsed ? [...plan.flags, "manual_fuel_entry"] : [...plan.flags];
  if (uncappedBigFill && !planFlags.includes("fills_uncapped_no_load_weight")) planFlags.push("fills_uncapped_no_load_weight");
  const planMessage = describePlan(plan.status, planFlags);
  return {
    status: plan.status,
    message: planMessage,
    plan: { stops, totalGallons: r1(plan.totalGallons), totalCost: plan.totalCost, savingsVsNaive: plan.savingsVsNaive, arrivalFuelPct: plan.arrivalFuelPct, reachesDestination: plan.reachesDestination, flags: planFlags },
    route: routeView, truck: truckView, breakAdvice, manualFuelUsed, origin, destination,
  };
}

/** Human, actionable explanation for the plan banner — especially why an infeasible/emergency plan happened. */
function describePlan(status: string, flags: string[]): string | undefined {
  if (status === "infeasible") {
    if (flags.includes("no_fuel_reading_cannot_plan"))
      return "No live fuel level for this truck, so a safe plan can't be built. Check the truck's Samsara fuel sensor or pick a truck with a current reading.";
    return "The truck can't reach a fuel stop on this route without dropping below its safety reserve. Load stations along this corridor (or widen the corridor buffer in Settings), or the driver must refuel before continuing.";
  }
  if (flags.includes("off_network_stop_used"))
    return "A stop had to be placed at an off-network station (no Pilot/Flying J was reachable in that stretch). Load a preferred station along that corridor to remove it.";
  if (status === "emergency_used") {
    if (flags.includes("avoided_state_fill_used"))
      return "Planned to fuel before the avoided state (e.g. California); a capped emergency splash inside it was still needed to reach the destination safely.";
    return "An emergency stop was needed — no preferred station was reachable in one gap. Buying only enough to reach the next preferred stop.";
  }
  return undefined;
}

/** Read the truck's live fuel samples (last ~3h) + current HOS clocks and compose the TruckFuelState. */
type VehState = { samsara_vehicle_id: string | null; tank_capacity_gal: number | string; observed_max_fill_gal: number | string | null; baseline_mpg: number | string | null };
type TeleResult =
  | { ok: true; state: TruckFuelState; hos: HosClocks }
  | { ok: false; reason: Exclude<TelematicsReason, "no_fuel_reading"> };

const NULL_HOS: HosClocks = { driveRemainingMs: null, shiftRemainingMs: null, cycleRemainingMs: null, timeUntilBreakMs: null };

/** Read live fuel + HOS for the truck, distinguishing WHY it's unavailable so the UI can guide the dispatcher. */
async function fetchTruckFuelState(
  admin: SupabaseClient, env: Env, orgId: string, veh: VehState,
  isReefer: boolean, cfg: ReturnType<typeof resolveRouteFuelConfig>, loadGrossLb: number | null,
): Promise<TeleResult> {
  if (!veh.samsara_vehicle_id) return { ok: false, reason: "not_linked" };
  const token = await loadSamsaraToken(admin, env, orgId);
  if (!token) return { ok: false, reason: "not_connected" };
  const now = Date.now();
  let fuelSamples: { time: string; value: number }[];
  try {
    const res = (await makeSamsaraFetcher(env, token)(String(veh.samsara_vehicle_id), new Date(now - 3 * 3_600_000).toISOString(), new Date(now).toISOString())) as { data: Array<{ id?: string | number; fuelPercents?: Array<{ time: string; value: number | string }> }> };
    const v = res.data.find((x) => String(x.id) === String(veh.samsara_vehicle_id)) ?? res.data[0];
    fuelSamples = (v?.fuelPercents ?? []).map((fp) => ({ time: fp.time, value: Number(fp.value) })).filter((fp) => Number.isFinite(fp.value));
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  let hos = { ...NULL_HOS };
  try {
    const h = (await makeSamsaraHosFetcher(env, token)()).get(String(veh.samsara_vehicle_id));
    if (h) hos = h;
  } catch { /* HOS best-effort; solver flags no_hos */ }

  const state = composeTruckState(veh, fuelSamples, hos, isReefer, cfg, loadGrossLb, now);
  return { ok: true, state, hos };
}

/** Build a TruckFuelState from raw inputs (shared by live + manual paths). */
function composeTruckState(veh: VehState, fuelSamples: { time: string; value: number }[], hos: HosClocks, isReefer: boolean, cfg: ReturnType<typeof resolveRouteFuelConfig>, loadGrossLb: number | null, nowMs: number): TruckFuelState {
  return buildTruckFuelState(
    {
      fuelSamples, tankCapacityGal: Number(veh.tank_capacity_gal), observedMaxFillGal: veh.observed_max_fill_gal != null ? Number(veh.observed_max_fill_gal) : null,
      baselineMpg: veh.baseline_mpg != null ? Number(veh.baseline_mpg) : null, hos, isReefer, loadGrossLb, lastFillTimeMs: null, nowMs,
    },
    { reservePct: cfg.reservePct, mpgSafetyFactor: cfg.mpgSafetyFactor },
  );
}

/** Manual fallback: build the truck state from a dispatcher-entered fuel % (+ optional HOS) when telematics is out. */
function buildManualTruckState(veh: VehState, fuelPct: number, manualHos: PlanRequest["manualHos"], liveHos: HosClocks, isReefer: boolean, cfg: ReturnType<typeof resolveRouteFuelConfig>, loadGrossLb: number | null): { state: TruckFuelState; hos: HosClocks } {
  const now = Date.now();
  const clamped = Math.max(0, Math.min(100, fuelPct));
  const asMs = (h?: number | null) => (h != null && h >= 0 ? h * 3_600_000 : null);
  const hos: HosClocks = manualHos
    ? { driveRemainingMs: asMs(manualHos.driveHours), shiftRemainingMs: asMs(manualHos.shiftHours), cycleRemainingMs: asMs(manualHos.cycleHours), timeUntilBreakMs: asMs(manualHos.breakHours) }
    : liveHos; // fall back to live HOS clocks when the driver didn't type them
  const state = composeTruckState(veh, [{ time: new Date(now).toISOString(), value: clamped }], hos, isReefer, cfg, loadGrossLb, now);
  return { state, hos };
}

const TELEMATICS_MESSAGE: Record<TelematicsReason, string> = {
  not_linked: "This truck isn't linked to Samsara, so there's no live fuel level or hours of service. Enter the current fuel level to plan manually.",
  not_connected: "Samsara isn't connected for your organization. An admin can connect it, or enter the current fuel level to plan manually.",
  unavailable: "Samsara is temporarily unavailable. Try again in a moment, or enter the current fuel level to plan manually.",
  no_fuel_reading: "No recent fuel reading for this truck (the sensor may be offline). Enter the current fuel level to plan manually.",
};

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
