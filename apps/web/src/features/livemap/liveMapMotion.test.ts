import { describe, it, expect } from "vitest";
import type { LiveMapVehicle } from "@silvicom/shared";
import {
  MOTION_DURATION_MS,
  SNAP_DISTANCE_DEGREES,
  planTweens,
  sampleTweens,
  tweensSettled,
} from "./liveMapMotion";
import type { RenderedPlace } from "./liveMapLayer";

/**
 * The animation, tested without a map (LIVE-MAP-PLAN.md LM8, D-LM8).
 *
 * `performance.now()` never appears here: every function takes `now` as a parameter, which is the
 * same discipline `deriveVehicleState` follows in `@silvicom/shared` and for the same reason — a
 * frame-accurate assertion should not need a fake timer to make it.
 */
const at = (lat: number, lng: number, heading: number | null = 0): LiveMapVehicle => ({
  vehicleId: "veh-1",
  unitNumber: "1207",
  driver: null,
  position: {
    lat,
    lng,
    headingDegrees: heading,
    speedMph: 60,
    isEcuSpeed: true,
    formattedLocation: null,
    sampledAt: "2026-09-15T18:00:00.000Z",
    receivedAt: "2026-09-15T18:00:00.000Z",
  },
  state: "moving",
  ageSeconds: 2,
  load: null,
});

const place = (lat: number, lng: number, heading: number | null = 0): RenderedPlace => ({ lat, lng, heading });

describe("planTweens", () => {
  it("starts a truck we have never drawn where it is, rather than animating it in from nowhere", () => {
    const tweens = planTweens(new Map(), [at(44.5, -88.0)], 0);
    const tween = tweens.get("veh-1")!;
    expect(tween.from).toEqual(tween.to);
  });

  /**
   * ⚠ From the LAST RENDERED place, not the last fix. A poll arriving mid-tween must continue from
   * the dot the user is looking at; starting from the previous FIX would make every truck jump
   * backwards before setting off again, five times a minute.
   */
  it("continues from where the dot currently is, not from the fix it was heading away from", () => {
    const rendered = new Map([["veh-1", place(44.52, -88.02)]]);
    const tween = planTweens(rendered, [at(44.53, -88.03)], 0).get("veh-1")!;
    expect(tween.from).toEqual({ lat: 44.52, lng: -88.02, heading: 0 });
    expect(tween.to).toMatchObject({ lat: 44.53, lng: -88.03 });
  });

  it("drops a truck that has left the board, so the map's state cannot outgrow the board's", () => {
    const rendered = new Map([["veh-1", place(44.5, -88.0)], ["gone", place(40, -80)]]);
    const tweens = planTweens(rendered, [at(44.5, -88.0)], 0);
    expect([...tweens.keys()]).toEqual(["veh-1"]);
  });

  /**
   * A truck whose feed went quiet in one state and reported again in another. Animating it draws a
   * dot gliding across three states in five seconds — a picture of something that did not happen.
   */
  it("snaps rather than animates a jump no truck could have driven between two polls", () => {
    const rendered = new Map([["veh-1", place(44.5, -88.0)]]);
    const far = at(44.5 + SNAP_DISTANCE_DEGREES * 2, -88.0);
    const tween = planTweens(rendered, [far], 0).get("veh-1")!;
    expect(tween.from).toEqual(tween.to);
  });

  it("still animates a step a truck at highway speed really does take in one poll", () => {
    const rendered = new Map([["veh-1", place(44.5, -88.0)]]);
    // ~0.14 miles at 100 mph over 5 s is about 0.002°, two orders of magnitude inside the guard.
    const tween = planTweens(rendered, [at(44.502, -88.0)], 0).get("veh-1")!;
    expect(tween.from).not.toEqual(tween.to);
  });
});

describe("sampleTweens", () => {
  // ⚠ The step has to stay INSIDE `SNAP_DISTANCE_DEGREES` or there is nothing to interpolate: the
  // first draft of this test moved a truck a whole degree, the snap guard fired, and it asserted
  // 44.5 against a dot that had teleported. A fixture can fail a correct implementation too.
  it("puts the dot halfway along at half the interval", () => {
    const tweens = planTweens(new Map([["veh-1", place(44.0, -88.0)]]), [at(44.02, -88.0)], 0);
    const places = sampleTweens(tweens, MOTION_DURATION_MS / 2);
    expect(places.get("veh-1")!.lat).toBeCloseTo(44.01, 6);
  });

  it("lands exactly on the target for a frame that arrives late, rather than overshooting", () => {
    const tweens = planTweens(new Map([["veh-1", place(44.0, -88.0)]]), [at(44.02, -88.0)], 0);
    const places = sampleTweens(tweens, MOTION_DURATION_MS * 4);
    expect(places.get("veh-1")!.lat).toBe(44.02);
  });

  /**
   * ⚠ 359° → 1° is 2° forward through north, not 358° backward through south. Asserted on the
   * MIDPOINT, because the endpoints agree under either arithmetic — a test that only checked t=1
   * would pass with a plain `lerp` and prove nothing. The symptom of getting this wrong looks like a
   * rendering bug (every icon spinning a full turn) rather than an arithmetic one.
   */
  it("sweeps a bearing the short way round through north", () => {
    const tweens = planTweens(new Map([["veh-1", place(44.0, -88.0, 359)]]), [at(44.0, -88.0, 1)], 0);
    const heading = sampleTweens(tweens, MOTION_DURATION_MS / 2).get("veh-1")!.heading!;
    expect(heading).toBeCloseTo(0, 6);
  });

  it("snaps to the new bearing when one end of the sweep is unknown", () => {
    const tweens = planTweens(new Map([["veh-1", place(44.0, -88.0, null)]]), [at(44.0, -88.0, 90)], 0);
    expect(sampleTweens(tweens, MOTION_DURATION_MS / 2).get("veh-1")!.heading).toBe(90);
  });

  it("reports no bearing for a truck that lost one, rather than freezing the last", () => {
    const tweens = planTweens(new Map([["veh-1", place(44.0, -88.0, 90)]]), [at(44.0, -88.0, null)], 0);
    expect(sampleTweens(tweens, MOTION_DURATION_MS / 2).get("veh-1")!.heading).toBeNull();
  });
});

describe("tweensSettled", () => {
  it("is false while anything is still moving and true once everything has arrived", () => {
    const tweens = planTweens(new Map([["veh-1", place(44.0, -88.0)]]), [at(44.02, -88.0)], 0);
    expect(tweensSettled(tweens, MOTION_DURATION_MS - 1)).toBe(false);
    expect(tweensSettled(tweens, MOTION_DURATION_MS)).toBe(true);
  });

  // The frame loop stops on this. An empty board that never settled would keep a laptop's GPU awake
  // drawing nothing.
  it("is true for an empty board", () => {
    expect(tweensSettled(new Map(), 0)).toBe(true);
  });
});
