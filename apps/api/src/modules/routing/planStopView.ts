/**
 * The API's view of one planned stop (D-FP5). Split out of fuelPlanning.ts on 2026-09-10 when the price started
 * being carried twice — pump and net, with its basis and age — and the orchestrator crossed the 500-line budget.
 * fuelPlanning.ts still owns the walk; this module owns what a stop looks like on the wire.
 */
import { discountPerGal, type PlannedStop, type LatLng, type PriceConfidence, type PostedQuote, type PriceEstimate, type PriceBasis } from "@silvicom/shared";

const r1 = (n: number) => Math.round(n * 10) / 10;

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
  /** An enabled, non-preferred brand chosen because no preferred station was reachable (never an avoided one). */
  isOffNetwork: boolean;
  /** true = netPrice is a history/brand estimate, not a fresh quote (Phase 5). */
  priceEstimated: boolean;
  /** Confidence in an estimated price (null when the price is a fresh quote or unknown). */
  priceConfidence: PriceConfidence | null;
  /** The posted pump price behind `netPrice` (D-FP5) — null when the net is a median or unknown. */
  postedPrice: number | null;
  /** Pump minus net, $/gal, signed; null when either is unknown. */
  discountPerGal: number | null;
  /** Where the price came from, for the label: the carrier's own report, a posted price, history, a brand median. */
  priceBasis: PriceBasis;
}

export type StationRow = { id: string; brand: string; store_number: string | null; name: string | null; lat: number | string; lng: number | string; state: string | null; exit: string | null };

/** Interpolate the lat/lng at a given cumulative mile along the route polyline (positions rest stops on the map). */
export function pointAtMile(poly: LatLng[], targetMi: number): { lat: number; lng: number } | null {
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
 * One itinerary row for the API view: the station's facts, the fill, and the price TWICE — pump and net —
 * with its basis and age (D-FP5). Outside `planFuelRoute` because that function sits at its grandfathered
 * size and the price now needs more lines than the solver's stop carries.
 */
export function stopView(st: PlannedStop, ctx: {
  stationById: Map<string, StationRow>;
  latestByStation: Map<string, { net: number | null; at: string }>;
  postedByStation: Map<string, PostedQuote>;
  estByStation: Map<string, PriceEstimate>;
  polyline: LatLng[];
  border: { mile: number; state: string } | null;
  nowMs: number;
}): PlanStopView {
  const s = st.station ? ctx.stationById.get(st.station.id) ?? null : null;
  const est = st.station ? ctx.estByStation.get(st.station.id) : undefined;
  const pos = s ? { lat: Number(s.lat), lng: Number(s.lng) } : pointAtMile(ctx.polyline, st.milesAhead);
  // Age of the quote the price actually came from: the carrier's report for a fresh net, the posted layer for a
  // posted−rule price. A median has no single age.
  const ageMs = (() => {
    if (!st.station) return null;
    if (est?.basis === "fresh") { const l = ctx.latestByStation.get(st.station.id); return l ? ctx.nowMs - Date.parse(l.at) : null; }
    if (est?.basis === "posted_discount") { const q = ctx.postedByStation.get(st.station.id); return q ? ctx.nowMs - q.observedAtMs : null; }
    return null;
  })();
  const postedPrice = est?.posted ?? null;
  return {
    kind: st.kind,
    milesAhead: r1(st.milesAhead),
    stationLat: pos?.lat ?? null, stationLng: pos?.lng ?? null,
    stationName: s ? (s.name ?? s.brand) : null, brand: s?.brand ?? null, state: s?.state ?? null, exit: s?.exit ?? null, storeNumber: s?.store_number ?? null,
    detourMiles: st.station ? r1(st.station.detourMiles) : 0, gallons: r1(st.fillGal),
    netPrice: st.netPrice, priceAgeHours: ageMs != null ? Math.round(ageMs / 3_600_000) : null,
    priceEstimated: est?.estimated ?? false, priceConfidence: est?.estimated ? est.confidence : null,
    postedPrice, discountPerGal: discountPerGal(postedPrice, st.netPrice), priceBasis: est?.basis ?? "none",
    cost: st.cost != null ? Math.round(st.cost * 100) / 100 : null, arrivalGal: r1(st.arrivalGal), isEmergency: st.isEmergency,
    coversBreak: st.coversBreak, isOvernight: st.isOvernight, driveHoursLeftOnArrival: st.driveHoursLeftOnArrival != null ? r1(st.driveHoursLeftOnArrival) : null,
    isBorderTopOff: st.isBorderTopOff, borderState: st.isBorderTopOff ? ctx.border?.state ?? null : null, isOffNetwork: st.isOffNetwork,
  };
}
