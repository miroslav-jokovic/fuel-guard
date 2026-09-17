/**
 * WHAT A TRUCK IS DOING, and how its dot moves between polls (LIVE-MAP-PLAN.md LM5, D-LM9/D-LM9b).
 *
 * Pure: no clock, no randomness, no I/O. `now` is always a parameter, so a test can place a truck
 * either side of a bound without waiting and without a fake timer. The map, any future report and the
 * driver app all call these, which is the point — a second answer to "is this truck moving?" computed
 * in a component is how two surfaces come to disagree about the same truck on the same screen.
 *
 * ── THE STATES ARE `moving | stopped | parked | offline`, AND `idle` IS NOT AMONG THEM ───────────
 * D-LM9. The `idle` module owns an evidence-backed definition of idling built from engine states,
 * park sessions and learned per-vehicle behaviour. An instantaneous "speed is 0" is not that, and
 * naming it `idle` would put a second, weaker answer to an existing question in front of the same
 * operator.
 *
 * ── HOW `stopped` IS TOLD FROM `parked` WITHOUT ANY HISTORY ──────────────────────────────────────
 * `vehicle_positions` holds ONE row per truck and no past (0341's ruling), so nothing here can look
 * at a series. It does not need to: the vendor's PING RATE is itself the signal. Samsara pings every
 * ≤5 s while a vehicle is on and drops to about one every 5 minutes when it is off (D-LM9b), so the
 * AGE of the newest fix says which regime the truck is in. A truck at 0 mph heard from seconds ago is
 * sitting at a dock with the engine running; a truck at 0 mph last heard from four minutes ago has
 * been switched off. That inference is the whole reason `parked` can exist at all here, and it is why
 * these bounds are read off the vendor's cadence rather than chosen.
 *
 * ── MEASURED ON PRODUCTION, 2026-09-15, THE FIRST HOUR THE FEED EVER RAN ─────────────────────────
 * 171 active trucks. Speed: 120 at exactly 0, 9 between 0 and 3 mph, ONE between 3 and 5, and 41 at
 * 5 mph or more. The 3 mph threshold therefore sits in a GAP rather than through a cluster, and it is
 * not a new number — `matchFuelingMoment` has used 3 mph as "stopped" since the fuel matcher was
 * written, and now reads it from here instead of carrying its own copy.
 *
 * Age: 60 trucks within 30 s, 140 within 5 minutes, 142 within 15 minutes, 29 beyond. The
 * distribution is BIMODAL — only two trucks sit anywhere between 5 and 15 minutes — so the offline
 * bound is insensitive to its exact value across that whole range. That is what makes 15 minutes a
 * robust choice rather than a tuned one, and it is the same figure the feed's own staleness bound
 * uses, so a dispatcher and the freshness card cannot call the same outage by two different names.
 */

/**
 * At or below this, a truck is not moving. 3 mph, and deliberately not 0: a parked truck's GPS speed
 * jitters, and 9 of 171 trucks were reporting between 0 and 3 mph at one instant in production.
 *
 * Promoted out of `matchFuelingMoment`, which had carried it as a bare `?? 3` default since the fuel
 * matcher was written. Two copies of "what counts as stopped" is the shape this repo calls a
 * workaround: it reads correctly right up until somebody tunes one of them.
 */
export const STOPPED_SPEED_MPH = 3;

/**
 * How old a fix may be and still describe a truck with its engine ON.
 *
 * D-LM9b stacks three intervals for a moving truck: the vendor's ping (≤5 s), the collector tier
 * (5 s) and the browser poll (5 s) — about **15 seconds** worst case. This is twice that, so a single
 * missed tick anywhere in the chain does not move a truck at a dock from `stopped` to `parked`. It is
 * derived from those three numbers and must be re-derived, not re-guessed, if any of them changes.
 */
export const ENGINE_ON_BOUND_SECONDS = 30;

/**
 * Past this, we are not describing where a truck is — we are describing where it was.
 *
 * ⚠ MEASURED AGAINST THE **PARKED** CADENCE, NOT THE MOVING ONE, and D-LM9 is explicit about why: a
 * switched-off vehicle legitimately reports only every 5 minutes, so a bound set anywhere near the
 * 15-second moving figure would turn the whole yard grey overnight and teach everyone to ignore the
 * colour. 15 minutes is three of those parked pings.
 *
 * In production this puts 29 of 171 active trucks offline on day one — which is the truth the map is
 * for, not a number to tune away. Seven of them are `active` vehicles whose telematics stopped more
 * than a week ago, one of them six months ago; that is a fleet problem the map surfaces rather than a
 * threshold problem.
 */
export const OFFLINE_BOUND_SECONDS = 900;

/**
 * How old a FUEL reading may be before the board stops presenting it as current (`Q-LM20`, item 8).
 *
 * ── IT IS A SEPARATE NUMBER FROM THE OFFLINE BOUND, AND EQUAL TO IT ON PURPOSE ───────────────────
 * Both answer "past this we are describing what WAS", and a quarter of an hour is the same honest
 * line for a tank as for a position — so the value is the same and the name is not. Deriving one
 * from the other would tie a vendor's ECU cadence to its GPS cadence, which are two different feeds
 * that happen to agree today; a reader retuning the offline bound would silently move what counts as
 * a live fuel reading, which is exactly the coupling `STOPPED_SPEED_MPH` was promoted out of
 * `matchFuelingMoment` to avoid.
 *
 * ⚠ MEASURED, NOT CHOSEN, AND THE FIRST MEASUREMENT WAS WRONG. Production, 2026-09-16 at 22:20 CDT:
 * "6 of 272 vehicles fresh within 15 minutes, average 17.6 days old". Re-run at 08:55 the next
 * morning over the 171 trucks the board actually draws: **171 of 171 have a reading and 101 are
 * inside the quarter hour**, because fuel comes off the ECU and an ECU reports while the engine runs
 * — moving trucks measured **67 of 67 fresh**, parked ones 35 of 79, offline 0 of 25. The first
 * figure described a fleet asleep at ten at night and a denominator including 37 retired trucks and
 * every vehicle with no position.
 *
 * ⚠ The hazard survived the correction, and it is what this bound is FOR: of the 146 trucks whose
 * POSITION was fresh, **35 (24%) carried a fuel reading over an hour old, the worst 5.6 days**. A
 * live marker with a stale tank is the one case a bare percentage would lie about, and it is a
 * quarter of the trucks a dispatcher clicks.
 */
export const FUEL_FRESH_SECONDS = 900;

export type VehicleMapState = "moving" | "stopped" | "parked" | "offline";

/** The little a state decision needs. Deliberately not the whole position row. */
export interface VehicleStateInput {
  /** Vendor `gps.time` — when the truck was THERE. Null or unparseable means we have no fix. */
  sampledAt: string | null | undefined;
  /** Null when the ping carried no speed; absent is not 0 (0341's column is nullable for this). */
  speedMph: number | null | undefined;
}

export interface VehicleStateBounds {
  stoppedSpeedMph?: number;
  engineOnBoundSeconds?: number;
  offlineBoundSeconds?: number;
}

/**
 * Seconds between a fix and `now`. Null when there is no usable timestamp — never 0, because 0 means
 * "we just heard from this truck" and a missing stamp means the opposite.
 *
 * Negative ages are clamped to 0. A vendor clock a second ahead of ours is not a truck reporting from
 * the future, and letting a negative through would make it the freshest thing on the map.
 */
export function positionAgeSeconds(
  sampledAt: string | null | undefined,
  now: string | number | Date,
): number | null {
  if (typeof sampledAt !== "string") return null;
  const t = Date.parse(sampledAt);
  if (!Number.isFinite(t)) return null;
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return null;
  return Math.max(0, (nowMs - t) / 1000);
}

/**
 * What to draw for one truck.
 *
 * ⚠ STALENESS AND STATE ARE TWO DIFFERENT FACTS, and this returns only the second. A truck doing
 * 60 mph whose fix is four minutes old is still `moving` — it is moving, we simply know where it was
 * four minutes ago. Collapsing that into `offline` would grey out most of a driving fleet, because 65
 * of 171 trucks sat between one and five minutes old in production. D-LM10 is the other half: the
 * panel shows the AGE per truck alongside the state, and `positionAgeSeconds` is what it shows.
 */
export function deriveVehicleState(
  position: VehicleStateInput | null | undefined,
  now: string | number | Date,
  bounds: VehicleStateBounds = {},
): VehicleMapState {
  const stoppedSpeed = bounds.stoppedSpeedMph ?? STOPPED_SPEED_MPH;
  const engineOn = bounds.engineOnBoundSeconds ?? ENGINE_ON_BOUND_SECONDS;
  const offline = bounds.offlineBoundSeconds ?? OFFLINE_BOUND_SECONDS;

  const age = positionAgeSeconds(position?.sampledAt, now);
  // No fix at all is `offline`, not a fourth kind of unknown. A truck we have never heard from and a
  // truck we stopped hearing from need the same thing from a dispatcher: find out why.
  if (age == null) return "offline";
  if (age > offline) return "offline";

  const speed = position?.speedMph;
  // `> stoppedSpeed`, so exactly 3 mph is NOT moving — the threshold is the top of the noise band, and
  // a truck sitting at the boundary belongs on the quiet side of it.
  //
  // ⚠ The type and finiteness checks are DEFENSIVE, not load-bearing, and saying so is the point:
  // `NaN > 3`, `null > 3` and `undefined > 3` are all already false, so a mutant that deletes them
  // passes every test in this file. They are kept because they make the intent legible and because
  // they stop being redundant the moment somebody rewrites this as `speed <= stoppedSpeed` — where
  // `NaN <= 3` is ALSO false and the branch would invert. A reader must not mistake them for the
  // thing that handles a missing speed; the ping-rate fall-through below is that thing.
  if (typeof speed === "number" && Number.isFinite(speed) && speed > stoppedSpeed) return "moving";

  // Not moving. The ping rate now decides which kind of not-moving it is — see the header.
  return age <= engineOn ? "stopped" : "parked";
}

/** Straight-line interpolation, `t` clamped to [0, 1] so a late frame cannot overshoot the target. */
export function lerp(from: number, to: number, t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return from + (to - from) * k;
}

/**
 * Interpolate a BEARING the short way round (D-LM8).
 *
 * 359° → 1° must sweep 2° forward through north, not 358° backward through south. A plain `lerp` on
 * the numbers does exactly the wrong thing here, and the symptom — every truck's icon spinning a full
 * turn each time it crosses north — is the kind of defect that looks like a rendering bug rather than
 * an arithmetic one.
 *
 * An exact 180° opposition has no short way round. The tie is resolved COUNTER-CLOCKWISE, and it is
 * pinned by a test: either answer is equally correct, so the only thing that matters is that it never
 * changes silently. Output is normalised to `[0, 360)`, the same range 0341's column admits, so a
 * value out of here is always a value that could be stored.
 */
export function lerpAngle(from: number, to: number, t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  // Shortest signed delta, in [-180, 180). The +540 is +360 (to clear JS's negative `%`) plus 180.
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  const raw = from + delta * k;
  return ((raw % 360) + 360) % 360;
}

/**
 * Interpolate a truck's position between two fixes.
 *
 * ⚠ KNOWN AND DELIBERATE GAP: this does NOT handle the antimeridian. A truck crossing ±180° would be
 * animated the long way around the planet. That is not handled because it cannot happen to a road
 * fleet, and building for it would mean shipping a branch no test could exercise against anything
 * real. It is stated here so the next reader knows it is a decision rather than an oversight — note
 * that 0341 refused to encode a hemisphere in the SCHEMA, which is a different question: the schema
 * must admit any legal coordinate, while an animation may state where it stops being right.
 */
export function lerpPosition(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  t: number,
): { lat: number; lng: number } {
  return { lat: lerp(from.lat, to.lat, t), lng: lerp(from.lng, to.lng, t) };
}
