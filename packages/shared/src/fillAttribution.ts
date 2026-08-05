/**
 * FILL-ATTRIBUTION VERIFICATION (WP-ATTR) — is a fuel transaction booked to the truck the driver was
 * actually in? The ELD LOGBOOK is the ground truth: Samsara HOS log entries carry the vehicle they were
 * recorded in (hos_duty_segments.vehicle_id after 0120), giving a queryable driver→truck timeline.
 *
 * Why: fills get their vehicle from the unit number typed at the pump (or a stale card mapping). When a
 * driver changes trucks and keeps typing the old unit, the new truck's fuel lands in the old truck's
 * rolling window — gallons pile up while that truck's odometer barely moves, and cumulative_overfuel
 * false-fires. Misattribution also poisons the MPG chain and baseline. The verifier classifies every
 * fill instead of letting bad attribution silently drive the math.
 *
 * DESIGN — a strong signal, not an absolute (the "almost 100%" caveat): real-world exceptions are
 * routine — a driver fuels the NEW truck before logging into it (ELD login lag), team/slip-seat
 * co-drivers, yard hostlers fueling trucks they never log into. So:
 *  - the lookup uses a ±ATTRIBUTION_TIME_BUFFER window around the fueling instant, and ANY logbook
 *    presence in the attributed truck inside that window CONFIRMS (switch-time ambiguity never accuses);
 *  - a `suspect` verdict alone only EXCLUDES the fill from window/baseline math (data-quality posture);
 *  - REWRITING the attribution additionally requires independent corroboration (the attributed truck
 *    failed the GPS location match at the station) — decided by shouldReattribute, audit-logged upstream.
 * Pure module — no I/O.
 */

export type AttributionVerdict = "confirmed" | "suspect" | "unknown";

/** How far around the fueling instant the logbook is consulted. Covers ELD login lag at shift start and
 *  EFS posted-time slop, while staying short enough that yesterday's truck can't confirm today's fill. */
export const ATTRIBUTION_TIME_BUFFER_MS = 2 * 3_600_000;

/** One logbook (HOS duty) segment for the fill's driver, with the truck it was recorded in. */
export interface LogbookSegment {
  /** Our vehicles.id the segment resolved to. Null = vehicle unresolved/not recorded → uninformative. */
  vehicleId: string | null;
  startMs: number;
  /** Null = still open. */
  endMs: number | null;
}

export interface AttributionCheck {
  verdict: AttributionVerdict;
  /** When suspect: the truck the logbook shows instead (the segment covering the instant, else the
   *  nearest in-buffer segment). Null unless verdict === "suspect". */
  logbookVehicleId: string | null;
}

/**
 * Classify one fill's vehicle attribution against the driver's logbook timeline.
 *  - confirmed — some in-buffer segment shows the attributed truck (incl. mid-switch: EITHER truck
 *    present confirms; ambiguity never accuses).
 *  - suspect   — the logbook has in-buffer vehicle coverage and NONE of it is the attributed truck.
 *  - unknown   — no attributed vehicle, or no in-buffer segment with a resolved vehicle (no ELD, driver
 *    unattributed, hostler fills). Unknown NEVER degrades behavior — the fill is treated as today.
 */
export function verifyFillAttribution(
  attributedVehicleId: string | null,
  fueledAtMs: number,
  segments: LogbookSegment[],
  bufferMs: number = ATTRIBUTION_TIME_BUFFER_MS,
): AttributionCheck {
  if (!attributedVehicleId || !Number.isFinite(fueledAtMs))
    return { verdict: "unknown", logbookVehicleId: null };
  const lo = fueledAtMs - bufferMs;
  const hi = fueledAtMs + bufferMs;
  const inWindow = segments.filter((s) => {
    if (s.vehicleId == null) return false;
    const end = s.endMs ?? Number.POSITIVE_INFINITY;
    return s.startMs <= hi && end >= lo;
  });
  if (inWindow.length === 0) return { verdict: "unknown", logbookVehicleId: null };
  if (inWindow.some((s) => s.vehicleId === attributedVehicleId))
    return { verdict: "confirmed", logbookVehicleId: null };

  // Every in-buffer logbook segment shows a DIFFERENT truck. Prefer the segment covering the exact
  // instant; else the one whose edge is nearest to it.
  const covering = inWindow.find(
    (s) => s.startMs <= fueledAtMs && (s.endMs ?? Number.POSITIVE_INFINITY) >= fueledAtMs,
  );
  const nearest =
    covering ??
    inWindow.reduce((a, b) => {
      const da = Math.min(
        Math.abs(a.startMs - fueledAtMs),
        Math.abs((a.endMs ?? a.startMs) - fueledAtMs),
      );
      const db = Math.min(
        Math.abs(b.startMs - fueledAtMs),
        Math.abs((b.endMs ?? b.startMs) - fueledAtMs),
      );
      return db < da ? b : a;
    });
  return { verdict: "suspect", logbookVehicleId: nearest.vehicleId };
}

/**
 * Should a suspect fill be automatically RE-ATTRIBUTED to the logbook truck? Requires two independent
 * contradictions of the recorded attribution:
 *  1. the driver's logbook shows a different truck (verdict === "suspect"), AND
 *  2. telematics places the attributed truck AWAY from the station at the fueling time
 *     (samsaraLocationMatched === false — not null/unknown: absence of GPS is not evidence).
 * Logbook alone excludes the fill from the math; only logbook + GPS agreement rewrites the record
 * (audit-logged by the caller, mirroring the capacity self-heal pattern).
 */
export function shouldReattribute(
  check: AttributionCheck,
  samsaraLocationMatched: boolean | null | undefined,
): boolean {
  return (
    check.verdict === "suspect" &&
    check.logbookVehicleId != null &&
    samsaraLocationMatched === false
  );
}
