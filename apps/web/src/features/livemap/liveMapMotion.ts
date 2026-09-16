/**
 * How a truck's dot gets from one fix to the next (LIVE-MAP-PLAN.md LM8, D-LM8).
 *
 * ── SMOOTHNESS IS INTERPOLATION, NOT A FASTER TRANSPORT ──────────────────────────────────────────
 * D-LM8. Between 5-second polls a `requestAnimationFrame` loop slides each dot from where it was
 * drawn to where the newest fix puts it, sweeping the bearing the short way round. No WebSocket, no
 * SSE, no realtime channel — and the note in the plan is worth repeating here, because it is the
 * argument: the reference implementation that built an entire WebSocket service never shipped the
 * animation, and the transport was not the part a user could see.
 *
 * ── WHAT THE ANIMATION COSTS, STATED RATHER THAN HIDDEN ──────────────────────────────────────────
 * A dot is travelling toward the newest fix rather than sitting on it, so it lags by up to one poll
 * (5 s) on top of D-LM9b's ~15 s worst case. That is a real cost and it was accepted for a real
 * reason: at 199 trucks a five-second teleport reads as a broken map, and a dispatcher who distrusts
 * the map stops using it.
 *
 * ⚠ It is bounded to the SEGMENT BETWEEN TWO MEASURED FIXES and never extrapolates past one. Sliding
 * a dot on along its heading because it "should" be moving would be inventing a position, and the
 * per-truck age (D-LM10) is computed from `sampledAt` by the server — it is not affected by any of
 * this, so the number beside the dot stays true while the dot catches up.
 */
import { lerp, lerpAngle, type LiveMapVehicle } from "@silvicom/shared";
import type { RenderedPlace } from "./liveMapLayer";

/** One poll interval. The tween is exactly as long as the gap it fills, so motion is continuous. */
export const MOTION_DURATION_MS = 5_000;

/**
 * Further than this in one poll and we SNAP rather than animate.
 *
 * 0.05° of latitude is about 3.4 miles. A truck at 100 mph — well above anything in this fleet —
 * covers 0.14 miles in the 5 seconds between polls, so nothing that is actually driving comes near
 * this. What does come near it is a FEED EVENT: a truck whose telematics went quiet in Oregon and
 * reported again in Idaho, or a tab that was hidden for an hour and polled once on return. Animating
 * either one draws a dot gliding across three states in five seconds, which is a picture of
 * something that did not happen.
 */
export const SNAP_DISTANCE_DEGREES = 0.05;

export interface Tween {
  from: RenderedPlace;
  to: RenderedPlace;
  startedAt: number;
}

/**
 * Where each truck should start moving from, given where it is being drawn now.
 *
 * `previous` is the LAST RENDERED place, not the last fix — a poll arriving mid-tween must continue
 * from the dot the user is looking at, or every truck would jump backwards to its old fix before
 * setting off again.
 */
export function planTweens(
  previous: ReadonlyMap<string, RenderedPlace>,
  vehicles: readonly LiveMapVehicle[],
  startedAt: number,
): Map<string, Tween> {
  const next = new Map<string, Tween>();
  for (const v of vehicles) {
    const to: RenderedPlace = {
      lat: v.position.lat,
      lng: v.position.lng,
      heading: v.position.headingDegrees,
    };
    const from = previous.get(v.vehicleId);
    // A truck we have never drawn appears where it is. There is nothing to interpolate from, and
    // starting it at some default would animate it in from a place it has never been.
    if (!from || isTooFarToAnimate(from, to)) {
      next.set(v.vehicleId, { from: to, to, startedAt });
      continue;
    }
    next.set(v.vehicleId, { from, to, startedAt });
  }
  // Trucks absent from this board are absent from the map: a tween for a truck with no feature to
  // apply it to is a leak that grows by one entry per retired vehicle per session.
  return next;
}

function isTooFarToAnimate(from: RenderedPlace, to: RenderedPlace): boolean {
  return (
    Math.abs(to.lat - from.lat) > SNAP_DISTANCE_DEGREES ||
    Math.abs(to.lng - from.lng) > SNAP_DISTANCE_DEGREES
  );
}

/**
 * Every truck's place at one instant.
 *
 * `t` is clamped inside `lerp`/`lerpAngle`, so a frame that arrives after the tween should have
 * finished lands exactly on the target rather than overshooting it.
 */
export function sampleTweens(
  tweens: ReadonlyMap<string, Tween>,
  now: number,
  durationMs: number = MOTION_DURATION_MS,
): Map<string, RenderedPlace> {
  const places = new Map<string, RenderedPlace>();
  for (const [id, tween] of tweens) {
    const t = durationMs <= 0 ? 1 : (now - tween.startedAt) / durationMs;
    places.set(id, {
      lat: lerp(tween.from.lat, tween.to.lat, t),
      lng: lerp(tween.from.lng, tween.to.lng, t),
      heading: sampleHeading(tween, t),
    });
  }
  return places;
}

/**
 * A bearing sweeps the short way round (`lerpAngle`) — 359° to 1° is 2° through north, not 358°
 * backwards through south. A truck that gained or lost its bearing between fixes SNAPS to the new
 * one: there is no short way round between "pointing somewhere" and "we do not know", and rotating
 * out of an unknown would be animating a fact we do not have.
 */
function sampleHeading(tween: Tween, t: number): number | null {
  if (tween.to.heading == null || tween.from.heading == null) return tween.to.heading;
  return lerpAngle(tween.from.heading, tween.to.heading, t);
}

/** True once every dot has reached its target — the signal to stop asking for frames. */
export function tweensSettled(
  tweens: ReadonlyMap<string, Tween>,
  now: number,
  durationMs: number = MOTION_DURATION_MS,
): boolean {
  for (const tween of tweens.values()) if (now - tween.startedAt < durationMs) return false;
  return true;
}
