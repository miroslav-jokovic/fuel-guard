import { computed, type Ref } from "vue";
import { dayRangeInstants, isEnteredAhead, loadDeliveredAt, parseYmd, shiftDay, todayInZone } from "@silvicom/shared";
import type { UrlQueryState } from "@silvicom/ui";
import type { DispatchLoad } from "./useDispatchLoads";

/**
 * The Loads list's Delivered window and its Driver and Truck filters (LOADS-ACTIVITY-PLAN D-LA6).
 *
 * ── THE WINDOW IS CARRIER DAYS, AND THE SERVER BOUNDS IT ─────────────────────────────────────────
 * The picker holds inclusive `YYYY-MM-DD` days. `dayRangeInstants` turns them into the carrier's
 * midnights, never the viewer's (`a-calendar-day-is-not-an-instant`), and those two instants go to
 * `GET /api/dispatch/loads`, which returns open loads whole and delivered ones only inside them. The
 * trailing seven days is each end's FALLBACK, never written to the URL, so a bookmark keeps meaning "the
 * last week", as on Billing.
 *
 * ── DRIVER AND TRUCK ARE EXACT ───────────────────────────────────────────────────────────────────
 * The search box matched "80" to trucks 801, 806, 809 and every load number with an 80 in it. These
 * match one id. A driver matches either seat of a team (D-LA2). Each entry carries the count of rows
 * it would show, counted over the list every OTHER filter admits, like the Dispatcher select (Q-DBV8).
 */

export const DEFAULT_WINDOW_DAYS = 7;
export const NO_DRIVER = "__none__";
const DAY_PARAM = (v: string | undefined) => parseYmd(v ?? "") ?? null;

export function useDeliveredWindow(qs: UrlQueryState, zone: Ref<string>, now: () => Date = () => new Date()) {
  const fallback = computed(() => {
    const to = todayInZone(now(), zone.value);
    return { from: shiftDay(to, -(DEFAULT_WINDOW_DAYS - 1)), to };
  });
  const fromParam = qs.param("delivered_from");
  const toParam = qs.param("delivered_to");
  // A day equal to its fallback is left out of the URL, so the default stays "the last week".
  const from = computed<string>({
    get: () => DAY_PARAM(fromParam.value) ?? fallback.value.from,
    set: (v) => qs.set({ delivered_from: v === fallback.value.from ? undefined : v }),
  });
  const to = computed<string>({
    get: () => DAY_PARAM(toParam.value) ?? fallback.value.to,
    set: (v) => qs.set({ delivered_to: v === fallback.value.to ? undefined : v }),
  });
  /** The two instants the API takes. The zone is in it, so a zone that lands late re-reads (D-PREC6). */
  const instants = computed(() => {
    const r = dayRangeInstants(from.value, to.value, zone.value);
    return { from: r.start, before: r.endExclusive };
  });
  const moved = computed(() => from.value !== fallback.value.from || to.value !== fallback.value.to);
  const reset = (): Partial<Record<string, undefined>> => ({ delivered_from: undefined, delivered_to: undefined });
  return { from, to, instants, moved, reset };
}

type Option = { value: string; label: string; count?: string };

/** Does this load belong to the picked driver (either seat) and truck? "" = anyone. */
export function matchesUnits(load: DispatchLoad, driverId: string, vehicleId: string): boolean {
  if (driverId === NO_DRIVER && (load.driver_id || load.co_driver_id)) return false;
  if (driverId && driverId !== NO_DRIVER && load.driver_id !== driverId && load.co_driver_id !== driverId) return false;
  if (vehicleId && load.vehicle_id !== vehicleId) return false;
  return true;
}

function tally(entries: Iterable<[string, string]>): Map<string, { label: string; count: number }> {
  const out = new Map<string, { label: string; count: number }>();
  for (const [id, label] of entries) {
    const e = out.get(id) ?? { label, count: 0 };
    e.count += 1;
    out.set(id, e);
  }
  return out;
}

const sorted = (m: Map<string, { label: string; count: number }>): Option[] =>
  [...m].map(([value, e]) => ({ value, label: e.label, count: String(e.count) })).sort((a, b) => a.label.localeCompare(b.label));

/** Every driver on these loads, either seat, by name, with how many of the loads each is on. */
export function driverOptions(loads: readonly DispatchLoad[]): Option[] {
  const seats = loads.flatMap((l) => {
    const both: [string, string][] = [];
    if (l.driver_id) both.push([l.driver_id, l.driver_name ?? "Unnamed driver"]);
    if (l.co_driver_id && l.co_driver_id !== l.driver_id) both.push([l.co_driver_id, l.co_driver_name ?? "Unnamed driver"]);
    return both;
  });
  const none = loads.filter((l) => !l.driver_id && !l.co_driver_id).length;
  return [
    { value: "", label: "Any driver" },
    ...sorted(tally(seats)),
    ...(none ? [{ value: NO_DRIVER, label: "No driver", count: String(none) }] : []),
  ];
}

/** Every truck on these loads, by unit, with how many of the loads each carries. */
export function truckOptions(loads: readonly DispatchLoad[]): Option[] {
  const units = loads.flatMap((l): [string, string][] => (l.vehicle_id ? [[l.vehicle_id, l.vehicle_unit ?? "Unknown unit"]] : []));
  const opts = sorted(tally(units)).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  return [{ value: "", label: "Any truck" }, ...opts];
}

/** A load's delivered time and whether McLeod has it keyed ahead (D-LA1, D-LA4), for the column. */
export function deliveredCell(load: DispatchLoad, nowMs: number): { at: string | null; ahead: boolean } {
  const at = load.status === "delivered" ? loadDeliveredAt(load.stops) : null;
  return { at, ahead: isEnteredAhead(at, nowMs) };
}
