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
 * ⚠ D-LM8b (2026-09-17): the tween's LENGTH is a property of the two fixes as well, not a constant —
 * measured on production, this fleet's moving trucks are re-fixed about every 11 seconds while the
 * board is polled every 5, so most boards repeat a position and a board that repeats one is now left
 * alone entirely. `tweenDurationFor` carries the numbers.
 *
 * ⚠ It is bounded to the SEGMENT BETWEEN TWO MEASURED FIXES and never extrapolates past one. Sliding
 * a dot on along its heading because it "should" be moving would be inventing a position, and the
 * per-truck age (D-LM10) is computed from `sampledAt` by the server — it is not affected by any of
 * this, so the number beside the dot stays true while the dot catches up.
 */
import { lerp, lerpAngle, type LiveMapVehicle } from "@silvicom/shared";
import type { RenderedPlace } from "./liveMapLayer";
import { LIVE_MAP_POLL_MS } from "./useLiveMapBoard";

/**
 * How long the board takes to ARRIVE after the poll timer fires, which the tween has to cover.
 *
 * ⚠ This constant exists because the thing it budgets for was missed entirely. `MOTION_DURATION_MS`
 * was `5_000` beside a `LIVE_MAP_POLL_MS` of `5_000`, under a comment reading "the tween is exactly
 * as long as the gap it fills, so motion is continuous" — and **exactly** is the word that was wrong.
 * The timer fires at T+5000 and the board lands at T+5000+latency, so a tween that ends at T+5000
 * ends in front of a dot that then has nothing to do until the response arrives. The owner reported
 * markers "freezing and restarting every 5–6 seconds"; the freeze IS the round trip, once per cycle,
 * for as long as the page is open.
 *
 * **1.5 s, and here is the arithmetic rather than a round number.** The transport floor to the
 * production host measured from this machine on 2026-09-16 is 97–168 ms over eight requests
 * (`/api/version`, which does no work). The board itself is three sequential queries and
 * `useLiveMapBoard` records ~1.0 s from a laptop, never yet measured inside Railway. 1.5 s covers
 * that with about half again in hand.
 *
 * ⚠ **THE BUDGET IS NOT FREE, AND THE COST IS EXACTLY THE BUDGET.** Simulated over 400 cycles: a
 * tween of `P + B` re-based every `P` settles at a steady state where the dot trails the newest fix
 * by precisely `B` of travel — 1.5 s, which is **143 ft at 65 mph**. That is on top of the up-to-one-
 * poll lag D-LM8 already accepted and states, and it is the right side of the trade at this scale:
 * 143 ft is sub-pixel below zoom 14, while a dot that stops dead once a cycle is visible at every
 * zoom. ⚠ It also means a budget is not something to inflate "to be safe" — doubling it doubles the
 * distance the map lies by.
 *
 * ⚠ A round trip SLOWER than the budget brings the stutter back for the excess. The honest fix for
 * that is measuring the board inside Railway (the open item in `useLiveMapBoard`), not a bigger
 * number here.
 */
export const MOTION_LATENCY_BUDGET_MS = 1_500;

/**
 * One poll interval PLUS the round trip that follows it — DERIVED, so the two cannot drift apart.
 *
 * ⚠ Written as an expression and not as `6_500`, because the defect being fixed was two literals
 * that agreed with each other and with nothing else. Change `LIVE_MAP_POLL_MS` and this follows;
 * pinned by "outlasts the poll interval by the latency budget, whatever the poll interval becomes",
 * which asserts the RELATIONSHIP — a test asserting `6_500` would teach the next reader nothing and
 * would have passed just as happily on the broken pair.
 */
export const MOTION_DURATION_MS = LIVE_MAP_POLL_MS + MOTION_LATENCY_BUDGET_MS;

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
  /**
   * How long THIS tween runs, which is a property of the two fixes rather than of the app (D-LM8b).
   *
   * See `planTweens` for the measurement that made it per-tween: the fleet's fixes arrive about every
   * 11 seconds and the board is polled every 5, so a single global duration is right for neither.
   */
  durationMs: number;
  /**
   * The `sampledAt` of the fix this tween is travelling TO — the only reliable way to tell a board
   * carrying news from a board repeating itself. Positions compare equal to the metre and would make
   * a truck that genuinely has not moved indistinguishable from one whose fix has not been refreshed.
   */
  toSampledAt: string;
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
  existing: ReadonlyMap<string, Tween> = new Map(),
): Map<string, Tween> {
  const next = new Map<string, Tween>();
  for (const v of vehicles) {
    const to: RenderedPlace = {
      lat: v.position.lat,
      lng: v.position.lng,
      heading: v.position.headingDegrees,
    };
    const was = existing.get(v.vehicleId);

    /**
     * ⚠ A BOARD THAT BRINGS NO NEWS ABOUT THIS TRUCK MUST NOT TOUCH ITS TWEEN. This is the whole of
     * D-LM8b: re-basing on a repeated fix restarts the clock with almost no ground left to cover, so
     * the dot crawls for that whole window and then jumps when a real fix lands — which is what the
     * owner reported as "still slowing down every ~5 seconds" after the freeze was fixed.
     */
    if (was && was.toSampledAt === v.position.sampledAt) {
      next.set(v.vehicleId, was);
      continue;
    }

    const from = previous.get(v.vehicleId);
    // A truck we have never drawn appears where it is. There is nothing to interpolate from, and
    // starting it at some default would animate it in from a place it has never been.
    if (!from || isTooFarToAnimate(from, to)) {
      next.set(v.vehicleId, { from: to, to, startedAt, durationMs: MOTION_DURATION_MS, toSampledAt: v.position.sampledAt });
      continue;
    }
    next.set(v.vehicleId, {
      from,
      to,
      startedAt,
      durationMs: tweenDurationFor(was, v.position.sampledAt),
      toSampledAt: v.position.sampledAt,
    });
  }
  // Trucks absent from this board are absent from the map: a tween for a truck with no feature to
  // apply it to is a leak that grows by one entry per retired vehicle per session.
  return next;
}

/**
 * How long to spend covering the ground between two fixes — the interval the fixes themselves
 * describe, not a constant (D-LM8b).
 *
 * ── MEASURED ON PRODUCTION, 2026-09-17 ──────────────────────────────────────────────────────────
 * 27 trucks were moving; the median age of their fixes was **5.6 s**, the mean 5.5 s and the worst
 * 13.6 s. Ages are uniform over the arrival interval, so a mean age of 5.5 s means fixes land about
 * every **11 seconds** — against a 5-second poll. A truck therefore gets a NEW position on fewer than
 * half the boards that mention it, and animating every segment over one fixed `MOTION_DURATION_MS`
 * is wrong in both directions: too fast when the fix is 11 s old, far too slow on the poll that
 * merely repeats it.
 *
 * So the duration is the gap between this fix and the one before it, plus the same latency budget
 * the poll version used, and the dot travels the segment at something close to the truck's real speed.
 *
 * ⚠ CAPPED, because a truck that has been parked for an hour reports a fix whose predecessor is an
 * hour old, and a one-hour tween is a dot that never appears to move. The cap is deliberately just
 * above the worst interval measured (13.6 s) rather than a round number: past it, the honest reading
 * is that we do not know how the truck got there, and the dot should arrive rather than glide.
 */
export const MAX_TWEEN_MS = 15_000;

function tweenDurationFor(was: Tween | undefined, sampledAt: string): number {
  const previousFix = was ? Date.parse(was.toSampledAt) : Number.NaN;
  const thisFix = Date.parse(sampledAt);
  if (!Number.isFinite(previousFix) || !Number.isFinite(thisFix)) return MOTION_DURATION_MS;
  const interval = thisFix - previousFix;
  // A fix that is not newer than the one before it says nothing about how long the journey took.
  if (interval <= 0) return MOTION_DURATION_MS;
  return Math.min(interval + MOTION_LATENCY_BUDGET_MS, MAX_TWEEN_MS);
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
): Map<string, RenderedPlace> {
  const places = new Map<string, RenderedPlace>();
  for (const [id, tween] of tweens) {
    const t = tween.durationMs <= 0 ? 1 : (now - tween.startedAt) / tween.durationMs;
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

/**
 * True once there is nothing left to draw — the signal to stop asking for frames.
 *
 * ⚠ **"Nothing left to draw" is now two conditions, and the second one had to be added the moment
 * the tween outlasted the poll.** This used to be the clock alone: a tween was over when
 * `MOTION_DURATION_MS` had elapsed. With the duration deliberately longer than the poll interval, no
 * tween is ever over when the next board re-bases it — so the clock alone would mean the frame loop
 * NEVER stops, over a parked fleet as much as a moving one, and `step()`'s own comment ("a permanent
 * rAF loop over a parked fleet would keep a laptop's GPU awake for a picture that is not changing")
 * would have quietly become false. That comment is the requirement; the timer was only ever a proxy
 * for it.
 *
 * So a tween is settled when it has run its course OR when it has nowhere to go. A truck parked at
 * the same coordinates with the same bearing settles on the first frame, which is strictly better
 * than the old behaviour — a parked fleet used to animate for five seconds out of every five,
 * interpolating between a position and itself.
 *
 * ⚠ Heading counts as somewhere to go. A truck rotating on the spot in a yard has `from.lat/lng ===
 * to.lat/lng` and is still moving on screen.
 */
export function tweensSettled(tweens: ReadonlyMap<string, Tween>, now: number): boolean {
  for (const tween of tweens.values()) {
    if (now - tween.startedAt >= tween.durationMs) continue;
    if (!isStill(tween)) return false;
  }
  return true;
}

/** A tween with nowhere to go: same place, same bearing. Nothing to interpolate, nothing to draw. */
function isStill(tween: Tween): boolean {
  return (
    tween.from.lat === tween.to.lat &&
    tween.from.lng === tween.to.lng &&
    tween.from.heading === tween.to.heading
  );
}
