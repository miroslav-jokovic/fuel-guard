/**
 * The dispatch board's rules, pure (`docs/plans/dispatch-loads/DISPATCH-BOARD-PLAN.md` §5, DB4).
 *
 * Every verdict a dispatcher reads off a row — when the truck reaches its next stop, whether that is
 * on time, where and when it is next empty, and which problems it has — is decided HERE, once, and
 * nowhere else. The API composes rows with these; the Loads page shows the same on-time badge from
 * the same function (D-DB6), so the two pages cannot disagree about one load.
 */
import { haversineMiles } from "./ai.js";
import { legalDriveMs } from "./smartFueling/hos.js";
import { OFFLINE_BOUND_SECONDS } from "./livemap.js";
import type {
  DispatchBoardAvailable,
  DispatchBoardEta,
  DispatchBoardFlags,
  DispatchBoardHos,
  DispatchBoardLoad,
  DispatchBoardStop,
  DispatchScope,
  OnTimeVerdict,
} from "./dispatchBoardContract.js";

const HOUR_MS = 3_600_000;

/**
 * The v1 ETA's basis (D-DB4), stated as constants because the tooltip has to say them.
 *
 * Straight-line miles × a road factor ÷ a planning speed. 1.2 is the usual great-circle-to-road
 * circuity for US interstate freight; 50 mph sits between the 45 mph solo / 54 mph team a published
 * dispatch board ships (Ditat, plan §4) and covers fuel and short stops. It is deliberately crude: no
 * HERE call per row (the TC3 route reader costs one per load), and McLeod's own `eta` is hand-typed —
 * 36 of 150 were more than six hours in the past on 2026-10-09. Q-DB4 measures this against actual
 * arrivals for two weeks before anyone pays for precision.
 */
export const BOARD_ROAD_FACTOR = 1.2;
export const BOARD_PLANNING_MPH = 50;
/** The 10-hour off-duty reset (49 CFR 395.3(a)(1)) added when legal drive time runs out en route. */
export const BOARD_RESET_MS = 10 * HOUR_MS;
/** Inside this margin before the window closes, an ETA is "at risk" rather than on time. */
export const BOARD_AT_RISK_MS = HOUR_MS;
/** A truck whose legal drive time is under this is flagged — enough to finish a short leg, not a long one. */
export const BOARD_HOS_LOW_MS = 2 * HOUR_MS;
/** A clocks row older than three polls is not "now"; the board shows no clocks rather than stale ones. */
export const BOARD_HOS_STALE_MS = 15 * 60_000;

/** The appointment's close: its end when McLeod gave a window, else its start. */
function windowCloses(stop: DispatchBoardStop): number | null {
  const t = stop.appointmentEnd ?? stop.appointmentStart;
  return t ? Date.parse(t) : null;
}

/** A point the board can measure from or to; a stop McLeod sent without coordinates is not one. */
type Point = { lat: number | null; lng: number | null };

/**
 * Road miles by the v1 basis, truck → each point in order — the legs chained, so a load with a stop
 * between here and the delivery is not measured as if it drove straight past it. Null when the truck or
 * any point has no coordinates: a partial sum would read as the whole distance.
 */
export function boardMiles(from: { lat: number; lng: number } | null, path: readonly Point[]): number | null {
  if (!from || !path.length) return null;
  let miles = 0;
  let at = from;
  for (const p of path) {
    if (p.lat == null || p.lng == null) return null;
    miles += haversineMiles(at.lat, at.lng, p.lat, p.lng) * BOARD_ROAD_FACTOR;
    at = { lat: p.lat, lng: p.lng };
  }
  return miles;
}

/**
 * When the truck reaches the last point of `path`, by the v1 basis above. Null when an end has no
 * coordinates — an ETA from nowhere is not shown.
 */
export function boardEtaAlong(
  from: { lat: number; lng: number } | null,
  path: readonly Point[],
  hos: DispatchBoardHos | null,
  now: Date,
): DispatchBoardEta | null {
  const miles = boardMiles(from, path);
  if (miles == null) return null;
  const driveMs = (miles / BOARD_PLANNING_MPH) * HOUR_MS;
  // The legal drive left is the binding clock of drive / shift / cycle (smartFueling's rule, reused).
  const legal = hos ? legalDriveMs({ ...hos, timeUntilBreakMs: hos.breakRemainingMs }) : null;
  const restAdded = legal != null && driveMs > legal;
  const at = new Date(now.getTime() + driveMs + (restAdded ? BOARD_RESET_MS : 0));
  return { at: at.toISOString(), miles: Math.round(miles), restAdded };
}

/** When the truck reaches `to` — one leg of `boardEtaAlong`. */
export function boardEta(
  from: { lat: number; lng: number } | null,
  to: DispatchBoardStop | null,
  hos: DispatchBoardHos | null,
  now: Date,
): DispatchBoardEta | null {
  return to ? boardEtaAlong(from, [to], hos, now) : null;
}

/**
 * On time, at risk, or late — against the window's close. A stop the truck has reached is judged by
 * its actual arrival, not by an estimate. No appointment, or no ETA, is "unknown": never green by default.
 */
export function onTimeVerdict(stop: DispatchBoardStop | null, eta: DispatchBoardEta | null): OnTimeVerdict {
  if (!stop) return "unknown";
  const closes = windowCloses(stop);
  if (closes == null) return "unknown";
  const arrival = stop.arrivedAt ? Date.parse(stop.arrivedAt) : eta ? Date.parse(eta.at) : null;
  if (arrival == null) return "unknown";
  if (arrival > closes) return "late";
  if (!stop.arrivedAt && arrival > closes - BOARD_AT_RISK_MS) return "at_risk";
  return "on_time";
}

const placeOf = (s: { city: string | null; state: string | null } | null): string | null =>
  s ? [s.city, s.state].filter(Boolean).join(", ") || null : null;

/**
 * City, state and ZIP out of Samsara's reverse-geocoded place, which ends "…, City, ST, 12345" (or
 * "City, ST" with no ZIP) — measured on production positions 2026-10-15. Anything else gives nulls, and
 * the truck can still be found by its coordinates; a guessed state would put it in the wrong filter.
 */
export function usPlaceParts(place: string | null): { city: string | null; state: string | null; postalCode: string | null } {
  const none = { city: null, state: null, postalCode: null };
  if (!place) return none;
  const parts = place.split(",").map((p) => p.trim()).filter(Boolean);
  const zip = parts.length && /^\d{5}(-\d{4})?$/.test(parts[parts.length - 1]!) ? parts.pop()! : null;
  const state = parts.pop();
  const city = parts.pop();
  if (!state || !/^[A-Z]{2}$/.test(state) || !city) return none;
  return { city, state, postalCode: zip };
}

/**
 * Where and when the truck is next available — the "PTA" pair long-haul planning runs on (plan §4 #1),
 * and the question the dispatchers' own board is built around (V2 plan §1). With a load: the last
 * delivery, at the later of its appointment and the truck's arrival there. With none: where it is, now.
 * Structured, not a display string, so the board can filter by state and by distance (D-DBV3).
 */
export function availableAt(
  current: DispatchBoardLoad | null,
  lastStopEta: DispatchBoardEta | null,
  position: { place: string | null; lat: number; lng: number } | null,
  now: Date,
): DispatchBoardAvailable | null {
  if (!current) {
    if (!position) return null;
    return { place: position.place, ...usPlaceParts(position.place), lat: position.lat, lng: position.lng, at: now.toISOString(), basis: "now" };
  }
  const last = current.lastStop;
  if (!last) return null;
  const appt = last.appointmentStart ? Date.parse(last.appointmentStart) : null;
  const eta = lastStopEta ? Date.parse(lastStopEta.at) : null;
  // The later one decides, and the basis says which: an ETA past the appointment is the truck running late.
  const basis = eta != null && (appt == null || eta > appt) ? "eta" : appt != null ? "appointment" : null;
  return {
    place: placeOf(last),
    city: last.city,
    state: last.state,
    postalCode: last.postalCode,
    lat: last.lat,
    lng: last.lng,
    at: basis ? new Date(basis === "eta" ? eta! : appt!).toISOString() : null,
    basis,
  };
}

/**
 * "Which trucks will be free in Florida, or within 100 miles of Orlando, by Friday 08:00?" (D-DBV3).
 * Every criterion given must hold; none given matches all. The radius is straight-line on purpose —
 * it is "near", and a road factor would make 100 miles mean 83 on the map.
 */
export function availableNear(
  available: DispatchBoardAvailable | null,
  q: { states?: readonly string[]; near?: { lat: number; lng: number; radiusMiles: number } | null; by?: string | null },
): boolean {
  const states = (q.states ?? []).map((s) => s.toUpperCase());
  if (!states.length && !q.near && !q.by) return true;
  if (!available) return false;
  if (states.length && !(available.state && states.includes(available.state.toUpperCase()))) return false;
  if (q.near) {
    if (available.lat == null || available.lng == null) return false;
    if (haversineMiles(q.near.lat, q.near.lng, available.lat, available.lng) > q.near.radiusMiles) return false;
  }
  if (q.by && !(available.at && Date.parse(available.at) <= Date.parse(q.by))) return false;
  return true;
}

/**
 * The points a typed city can be found by, from the board's own rows — every delivery and every truck
 * position names a city with its coordinates. No geocoder is bought for v1 (V2 plan §3.1): a city that
 * no row has ever named is not found, and the filter falls back to its state and says so.
 */
export function knownCityPoints(
  rows: ReadonlyArray<{ available: DispatchBoardAvailable | null }>,
): Map<string, { city: string; state: string; lat: number; lng: number }> {
  const out = new Map<string, { city: string; state: string; lat: number; lng: number }>();
  for (const { available: a } of rows) {
    if (!a?.city || !a.state || a.lat == null || a.lng == null) continue;
    const key = cityKey(a.city, a.state);
    if (!out.has(key)) out.set(key, { city: a.city, state: a.state, lat: a.lat, lng: a.lng });
  }
  return out;
}

export const cityKey = (city: string, state: string): string => `${city.trim().toUpperCase()}|${state.trim().toUpperCase()}`;

/** HOS clocks the board may present as current; older ones are dropped rather than shown as now. */
export function freshHos(hos: DispatchBoardHos | null, now: Date): DispatchBoardHos | null {
  if (!hos) return null;
  return now.getTime() - Date.parse(hos.fetchedAt) > BOARD_HOS_STALE_MS ? null : hos;
}

/**
 * The row's problems, each its own flag (plan §4 #3 — never one blended colour). A truck in the shop
 * is not "empty" or "without a next load": it is not available, and flagging it would train people to
 * ignore the flags.
 */
export function boardFlags(input: {
  inShop: boolean;
  current: DispatchBoardLoad | null;
  next: DispatchBoardLoad | null;
  onTime: OnTimeVerdict;
  hos: DispatchBoardHos | null;
  gpsAgeSeconds: number | null;
}): DispatchBoardFlags {
  const legal = input.hos ? legalDriveMs({ ...input.hos, timeUntilBreakMs: input.hos.breakRemainingMs }) : null;
  return {
    lateRisk: input.onTime === "late" || input.onTime === "at_risk",
    noNextLoad: !input.inShop && input.current != null && input.next == null,
    emptyNow: !input.inShop && input.current == null,
    // Low drive time matters only for a truck with work ahead of it; an empty truck's clock is not a risk.
    hosLow: input.current != null && legal != null && legal < BOARD_HOS_LOW_MS,
    noGps: input.gpsAgeSeconds == null || input.gpsAgeSeconds > OFFLINE_BOUND_SECONDS,
  };
}

/** Does any flag call for a dispatcher? The row's left-edge dot (plan §4 #4). */
export const needsAttention = (f: DispatchBoardFlags): boolean => f.lateRisk || f.hosLow || f.noGps;

/**
 * Is this truck "mine" (D-DB1, D-DB3)? Two axes, never merged: the truck is in a fleet my login runs,
 * OR a load on it — current or next — is dispatched by my login. The second is what keeps a colleague
 * covering for me from hiding my truck, and what shows me the trucks I am covering for.
 */
export function inMyScope(
  row: { fleetCode: string | null; current: { dispatcherId: string | null } | null; next: { dispatcherId: string | null } | null },
  scope: DispatchScope,
): boolean {
  if (row.fleetCode && scope.fleetCodes.includes(row.fleetCode)) return true;
  return [row.current, row.next].some((l) => l?.dispatcherId != null && scope.dispatcherIds.includes(l.dispatcherId));
}

/**
 * The load's dispatcher is not the one who runs the truck's fleet — a colleague is moving it. Shown
 * quietly on the row ("moved by asen"): 18% of loads in progress on 2026-10-09, and the covering case a
 * fleet owner wants to notice. Unknown on either side is not a mismatch.
 */
export function movedByOther(
  fleetDispatcherId: string | null,
  load: { dispatcherId: string | null } | null,
): boolean {
  return fleetDispatcherId != null && load?.dispatcherId != null && load.dispatcherId !== fleetDispatcherId;
}

/** A dispatcher's display name from the McLeod roster, falling back to the login. */
export function dispatcherName(id: string | null | undefined, dispatchers: ReadonlyArray<{ id: string; name: string | null }>): string {
  if (!id) return "";
  return dispatchers.find((d) => d.id === id)?.name || id;
}
