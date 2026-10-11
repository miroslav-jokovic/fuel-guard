import { haversineMiles } from "../ai.js";
import { cityFromAddress, stateFromAddress, type SamsaraSample } from "../samsara/index.js";

/**
 * Where the card's truck was at the moment the card was used (CF1, CARD-FRAUD-ALERTS-PLAN.md D-CF1).
 *
 * The location check (`resolveLocation`) answers a different question — "was the truck in the station's
 * state at any point that fueling day" — and keeps only the verdict. That verdict is enough to raise a
 * decline, and useless for telling a person what happened: the 2026-09-22 South Bend attempts on card
 * …27564 were scored `alert` and the notification could say nothing better than an EFS error code,
 * because nobody had kept where truck 729 actually was. This keeps it.
 *
 * A MEASUREMENT, never a verdict (`sql-returns-measurement-ts-owns-verdict`): the incident fold (CF2)
 * decides what a distance means. null = not measured — no sample close enough in time — and is never
 * read as "the truck was at the station".
 */
export interface TruckPosition {
  /** The GPS sample's own instant — the alert says "Samsara, 09-22 19:20", not the attempt's time. */
  at: string;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
  address: string | null;
  /** Great-circle miles from the truck to the station's geocode; null when the station has none. */
  milesToStation: number | null;
}

/**
 * The same 30-minute bound `resolveOdometer` interpolates within. A truck at highway speed covers ~35
 * miles in that time, which is small beside the distances that mean anything here (the measured
 * attempts were hundreds of miles from their trucks) and large beside Samsara's moving ping interval.
 */
export const TRUCK_POSITION_MAX_GAP_MIN = 30;

export function truckPositionAt(
  samples: SamsaraSample[],
  atIso: string,
  station: { lat: number; lng: number } | null,
  maxGapMin: number = TRUCK_POSITION_MAX_GAP_MIN,
): TruckPosition | null {
  const at = Date.parse(atIso);
  if (!Number.isFinite(at)) return null;
  let best: SamsaraSample | null = null;
  let bestGap = Infinity;
  for (const s of samples) {
    if (s.lat == null || s.lng == null) continue;
    const gap = Math.abs(Date.parse(s.time) - at);
    if (gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  if (!best || bestGap > maxGapMin * 60_000) return null;
  return {
    at: best.time,
    lat: best.lat,
    lng: best.lng,
    city: cityFromAddress(best.address),
    state: stateFromAddress(best.address),
    address: best.address,
    milesToStation: station ? Math.round(haversineMiles(best.lat, best.lng, station.lat, station.lng) * 10) / 10 : null,
  };
}
