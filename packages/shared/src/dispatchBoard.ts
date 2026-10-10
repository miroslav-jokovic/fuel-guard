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

/**
 * When the truck reaches `to`, by the v1 basis above. Null when either end has no coordinates — an
 * ETA from nowhere is not shown. A truck already within a mile of the stop is there now.
 */
export function boardEta(
  from: { lat: number; lng: number } | null,
  to: DispatchBoardStop | null,
  hos: DispatchBoardHos | null,
  now: Date,
): DispatchBoardEta | null {
  if (!from || !to || to.lat == null || to.lng == null) return null;
  const miles = haversineMiles(from.lat, from.lng, to.lat, to.lng) * BOARD_ROAD_FACTOR;
  const driveMs = (miles / BOARD_PLANNING_MPH) * HOUR_MS;
  // The legal drive left is the binding clock of drive / shift / cycle (smartFueling's rule, reused).
  const legal = hos ? legalDriveMs({ ...hos, timeUntilBreakMs: hos.breakRemainingMs }) : null;
  const restAdded = legal != null && driveMs > legal;
  const at = new Date(now.getTime() + driveMs + (restAdded ? BOARD_RESET_MS : 0));
  return { at: at.toISOString(), miles: Math.round(miles), restAdded };
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
 * Where and when the truck is next empty — the "PTA" pair long-haul planning runs on (plan §4 #1).
 * With a load: the last delivery's city, at the later of its appointment and the truck's arrival there
 * (an ETA to the LAST stop, which on a single-drop load is the next stop). With none: where it is, now.
 */
export function emptiesAt(
  current: DispatchBoardLoad | null,
  lastStopEta: DispatchBoardEta | null,
  position: { place: string | null } | null,
  now: Date,
): { place: string | null; at: string | null } | null {
  if (!current) return position ? { place: position.place, at: now.toISOString() } : null;
  const last = current.lastStop;
  if (!last) return null;
  const candidates = [last.appointmentStart, lastStopEta?.at].filter((t): t is string => !!t).map(Date.parse);
  const at = candidates.length ? new Date(Math.max(...candidates)).toISOString() : null;
  return { place: placeOf(last), at };
}

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
