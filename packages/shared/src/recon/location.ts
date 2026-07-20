import {
  matchFuelingStop,
  matchFuelingMoment,
  resolveLocationConfidence,
  type LocationConfidence,
  type SamsaraSample,
} from "../samsara/index.js";

/** Where the truck actually was at the fill (preferred from the tank-rise event when present). */
export interface ObservedLocation {
  observedState: string | null;
  observedCity: string | null;
  observedAddress: string | null;
  observedLat: number | null;
  observedLng: number | null;
}

export interface LocationResult extends ObservedLocation {
  /** true = truck at/near/in-state; false = mismatch (card used where truck wasn't); null = unknown. */
  matched: boolean | null;
  confidence: LocationConfidence | null;
  /** Stop time that anchors the fill when there's no tank-rise (precise: matchFuelingStop; date-only:
   *  matchFuelingMoment). The orchestrator combines this with the tank-rise event to pick the fill anchor. */
  stopMatchedAt: string | null;
  /** Stop basis (precise path only), e.g. 'in_city' — the odometer trust gate reads this. null for date-only. */
  stopBasis: string | null;
  /** Date-only path: GPS proximity alone certifies the fill; the odometer trust gate reads this. */
  nearStation: boolean;
  /** Mismatch evidence for the anomaly, or null when not a mismatch. */
  evidence: Record<string, unknown> | null;
}

/**
 * S2 — Location module. The ONLY place the fueling-time location decision is made, for BOTH the precise and
 * date-only paths (previously duplicated in the reconciler). Pure. `anchorObserved` is the tank-rise event's
 * observed position when present; it takes precedence for the reported observed location + the mismatch
 * evidence — matching the previous `observedFor(...)` behaviour exactly.
 */
export function resolveLocation(input: {
  samples: SamsaraSample[];
  preciseTime: boolean;
  efs: { state: string | null; city: string | null; locationName: string | null };
  fueledAt: string;
  proximityMiles: number | null;
  nearMiles: number | null;
  proxThresholdMiles: number;
  minMismatchMiles: number;
  /** The tank-rise event's observed location, or null when there is no tank-rise event. */
  anchorObserved: ObservedLocation | null;
}): LocationResult {
  const { samples, preciseTime, efs, fueledAt, proximityMiles, nearMiles, proxThresholdMiles, minMismatchMiles, anchorObserved } = input;

  if (preciseTime) {
    const stop = matchFuelingStop(samples, { state: efs.state, city: efs.city }, fueledAt, { stoppedMph: 5 });
    const { confidence, matched } = resolveLocationConfidence(stop, proximityMiles, proxThresholdMiles, { nearMiles, minMismatchMiles });
    // Reported observed location: tank-rise event wins whole-object; else the stop's address. (== observedFor)
    const observed: ObservedLocation = anchorObserved ?? {
      observedState: stop.observedState ?? null,
      observedCity: stop.observedCity ?? null,
      observedAddress: stop.observedAddress ?? null,
      observedLat: null,
      observedLng: null,
    };
    const evidence =
      confidence === "mismatch"
        ? {
            efsCity: efs.city,
            efsState: efs.state,
            samsaraState: observed.observedState,
            samsaraCity: observed.observedCity,
            samsaraAddress: observed.observedAddress,
            nearestMilesToStation: proximityMiles,
            note: `Samsara shows the truck was never in ${efs.state ?? "the EFS state"} at any point across the fueling day${proximityMiles != null ? ` and came no closer than ${proximityMiles} mi to the station` : ""} — the card was used where the truck was not.`,
          }
        : null;
    return { matched, confidence, stopMatchedAt: stop.matchedAt, stopBasis: stop.basis, nearStation: false, evidence, ...observed };
  }

  // ── Date-only path: no exact time → never raise a mismatch; GPS proximity can still positively confirm. ──
  const nearStation = proximityMiles != null && proximityMiles <= proxThresholdMiles;
  const match = matchFuelingMoment(samples, { city: efs.city, state: efs.state, stationName: efs.locationName });
  // Observed comes ONLY from the tank-rise event on the date-only path (== observedFor({})).
  const observed: ObservedLocation = anchorObserved ?? { observedState: null, observedCity: null, observedAddress: null, observedLat: null, observedLng: null };
  return {
    matched: nearStation ? true : null,
    confidence: nearStation ? "gps_confirmed" : "unknown",
    stopMatchedAt: match?.matchedAt ?? null,
    stopBasis: null,
    nearStation,
    evidence: null,
    ...observed,
  };
}
