/**
 * Which truck place a stopped truck is AT, from HERE's place search (D-LM31).
 *
 * ── THE QUESTION ─────────────────────────────────────────────────────────────────────────────────
 * The owner, 2026-11-09: "when I see the truck and zoom in I don't know if that is a truck stop or
 * what it is". The card's Location line is Samsara's `formattedLocation`, a street address — "IL-53,
 * Joliet" for a truck parked inside the Pilot there. HERE's Browse API, on the key the tile proxy
 * already uses, names the place: categories `700-7900-0132` Truck Stop - Plaza, `400-4300-0199`
 * Complete Rest Area, `700-7900-0131` Truck Parking, `700-7850-0126` Truck Repair.
 *
 * ── THE RULE IS A MEASUREMENT, NOT A GUESS (2026-11-09) ──────────────────────────────────────────
 * All 106 of the real fleet's trucks that were stopped with a fix in the last three days were run
 * through Browse, and every doubtful answer was checked against satellite imagery with the truck's fix
 * and HERE's pin drawn on it:
 *
 *   · TRUCK STOPS, REST AREAS, TRUCK PARKING — right in every case that could be judged, out to 234 m:
 *     the truck sits in the plaza's own truck lot while HERE's pin is on the building. A plaza is
 *     large, hence `PLAZA_RADIUS_M`.
 *   · TRUCK REPAIR within 120 m — three right (TA's shop lot, a Speedco at a truck stop, All Heart's
 *     gate), one unclear. Beyond 120 m — two WRONG and none clearly right: both wrong ones were trucks
 *     in Silvicom's OWN yard on Armitage Ave, Melrose Park, 165 m and 243 m from the repair shops
 *     beside it. A shop is a small lot, hence `REPAIR_RADIUS_M`. ⚠ The yard is where trucks sit most,
 *     so a looser radius would put the wrong name on the commonest case.
 *
 * ⚠ "The nearest place of any kind" was measured too and REFUSED: it would never mislabel the yard,
 * but it drops real truck stops wherever the McDonald's, the EV charger or the fuel island inside the
 * plaza is nearer than the plaza's own pin — it dropped 34 of the 48 hits, among them the Pilot in
 * Amarillo (a McDonald's 57 m away), Whiskey Pete's in Primm (its own Flying J) and two TravelCenters.
 *
 * ⚠ The sample is 15 checked cases, not thousands: the radii are where the evidence ran out, and a
 * place past them is left unnamed rather than guessed. The street address still shows beside it.
 */
import type { VehicleMapState } from "./livemap.js";
import type { LiveMapTruckPlace, TruckPlaceKind } from "./livemapContract.js";

/** A truck stop, rest area or truck parking counts out to here (see header: right out to 234 m). */
export const PLAZA_RADIUS_M = 250;
/** A truck repair shop counts only this close (see header: both wrong cases were past 160 m). */
export const REPAIR_RADIUS_M = 120;

/** HERE category id → our kind and how far from its pin the truck may be. Order is preference. */
export const TRUCK_PLACE_CATEGORIES: readonly { id: string; kind: TruckPlaceKind; radiusM: number }[] = [
  { id: "700-7900-0132", kind: "truck_stop", radiusM: PLAZA_RADIUS_M },
  { id: "400-4300-0199", kind: "rest_area", radiusM: PLAZA_RADIUS_M },
  { id: "700-7900-0131", kind: "truck_parking", radiusM: PLAZA_RADIUS_M },
  { id: "700-7850-0126", kind: "truck_repair", radiusM: REPAIR_RADIUS_M },
];

/** The widest radius any kind allows — the search circle, so nothing a rule could accept is cut off. */
export const TRUCK_PLACE_SEARCH_RADIUS_M = Math.max(...TRUCK_PLACE_CATEGORIES.map((c) => c.radiusM));

/** The words a dispatcher reads for each kind. */
export const TRUCK_PLACE_LABEL: Record<TruckPlaceKind, string> = {
  truck_stop: "Truck stop",
  rest_area: "Rest area",
  truck_parking: "Truck parking",
  truck_repair: "Truck repair",
};

/**
 * Whether a truck in this state is somewhere worth naming. A MOVING truck is between places, and an
 * OFFLINE one's last fix says where it was, not where it is — naming a truck stop for either would
 * state as current a fact nobody has.
 */
export function placeLookupApplies(state: VehicleMapState): boolean {
  return state === "stopped" || state === "parked";
}

/**
 * One fix's identity for the lookup: rounded to 4 decimals, ~11 m, enough to absorb a parked truck's
 * GPS jitter and small enough that a truck which really moved is asked about again. The API caches
 * HERE's answer under it and the card keys its query on it — one definition, so the two cannot
 * disagree about whether a truck has moved.
 */
export function placeKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/** One Browse result, reduced to what the rule reads. */
export interface PlaceCandidate {
  title?: string;
  distance?: number;
  categories?: { id?: string }[];
}

/**
 * The truck place this truck is at, or null.
 *
 * A candidate qualifies when ANY of its categories is a truck kind and it is within THAT kind's
 * radius — a Love's tagged Gas Station + Truck Stop counts as a truck stop out to 250 m. Of the
 * qualifiers the nearest wins; a tie goes to the earlier kind in `TRUCK_PLACE_CATEGORIES`, so a plaza
 * beats the repair bay inside it.
 */
export function pickTruckPlace(candidates: readonly PlaceCandidate[]): LiveMapTruckPlace | null {
  let best: { place: LiveMapTruckPlace; d: number; rank: number } | null = null;
  for (const c of candidates) {
    const name = c.title?.trim();
    const d = c.distance;
    if (!name || typeof d !== "number" || !Number.isFinite(d) || d < 0) continue;
    const ids = new Set((c.categories ?? []).map((k) => k.id));
    const rank = TRUCK_PLACE_CATEGORIES.findIndex((k) => ids.has(k.id) && d <= k.radiusM);
    if (rank < 0) continue;
    const place: LiveMapTruckPlace = { name, kind: TRUCK_PLACE_CATEGORIES[rank]!.kind, distanceMeters: Math.round(d) };
    if (!best || d < best.d || (d === best.d && rank < best.rank)) {
      best = { place, d, rank };
    }
  }
  return best?.place ?? null;
}
