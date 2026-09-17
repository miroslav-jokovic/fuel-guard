import { describe, it, expect } from "vitest";
import type { LiveMapVehicle } from "@silvicom/shared";
import {
  MAX_TWEEN_MS,
  MOTION_DURATION_MS,
  MOTION_LATENCY_BUDGET_MS,
  SNAP_DISTANCE_DEGREES,
  planTweens,
  sampleTweens,
  tweensSettled,
} from "./liveMapMotion";
import { LIVE_MAP_POLL_MS } from "./useLiveMapBoard";
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

/**
 * The relationship between the two intervals, which is the whole of the stutter defect.
 *
 * ⚠ These assert the RELATIONSHIP and never the literals. `MOTION_DURATION_MS` was `5_000` next to a
 * `LIVE_MAP_POLL_MS` of `5_000` for as long as the live map has existed, and a test reading
 * `expect(MOTION_DURATION_MS).toBe(5_000)` would have passed on every one of those days while the
 * markers froze once a cycle. A test that cannot fail on the defect it is named after is decoration.
 */
describe("the tween and the poll it covers", () => {
  it("outlasts the poll interval by the latency budget, whatever the poll interval becomes", () => {
    expect(MOTION_DURATION_MS).toBe(LIVE_MAP_POLL_MS + MOTION_LATENCY_BUDGET_MS);
    expect(MOTION_DURATION_MS).toBeGreaterThan(LIVE_MAP_POLL_MS);
  });

  /**
   * The defect itself, stated as the frame loop sees it: at the instant the next poll FIRES, the
   * current tween must still be in flight — because the board it asks for does not land until the
   * round trip after that. An equal duration made this `true`, `step()` stopped requesting frames,
   * and the dot stood still for the length of the request.
   */
  it("is still animating when the next poll fires, so there is no gap to freeze in", () => {
    const tweens = planTweens(new Map([["veh-1", place(44.0, -88.0)]]), [at(44.02, -88.0)], 0);
    expect(tweensSettled(tweens, LIVE_MAP_POLL_MS)).toBe(false);
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

  /**
   * ⚠ The second half of the fix, and the half that is easy to miss. Once the tween outlasts the
   * poll, no tween is ever finished when the next board re-bases it — so a settled test made of the
   * clock alone would keep the rAF loop running forever, including over a fleet that is parked.
   * `step()`'s comment ("a permanent rAF loop over a parked fleet would keep a laptop's GPU awake for
   * a picture that is not changing") is the requirement, and this is what now holds it.
   */
  it("settles a parked truck immediately rather than interpolating it towards itself", () => {
    const tweens = planTweens(new Map([["veh-1", place(44.0, -88.0, 90)]]), [at(44.0, -88.0, 90)], 0);
    expect(tweensSettled(tweens, 0)).toBe(true);
  });

  // Somewhere to go includes a bearing: a truck turning on the spot in a yard has not moved and is
  // still changing on screen.
  it("keeps drawing a truck that is only turning", () => {
    const tweens = planTweens(new Map([["veh-1", place(44.0, -88.0, 90)]]), [at(44.0, -88.0, 180)], 0);
    expect(tweensSettled(tweens, 0)).toBe(false);
  });
});

/**
 * D-LM8b — the tween is cut from the FIXES, not from the poll.
 *
 * ⚠ Measured on production 2026-09-17 and the reason this exists: 27 moving trucks had a median fix
 * age of 5.6 s, so fixes land about every 11 seconds while the board is polled every 5. More than
 * half of all boards therefore repeat a truck's position, and the previous code re-based on every one
 * of them — restarting a 6.5 s tween with almost no ground to cover, which is a dot crawling at a
 * quarter speed for a whole window and then jumping. The owner reported exactly that, as "still
 * slowing down every ~5 seconds", after the freeze had been fixed.
 */
/** The file's own `at()` with a stated fix time — which is what this section is about. */
const fixAt = (lat: number, sampledAt: string): LiveMapVehicle => {
  const v = at(lat, -88.0);
  return { ...v, position: { ...v.position, sampledAt } };
};

describe("a board that repeats a fix", () => {

  it("leaves that truck's tween exactly as it was, rather than restarting it", () => {
    const rendered = new Map([["veh-1", place(44.0, -88.0)]]);
    const first = planTweens(rendered, [fixAt(44.02, "2026-09-17T12:00:00.000Z")], 0);
    const tween = first.get("veh-1")!;

    // The next board arrives 5s later carrying the SAME fix — no news about this truck.
    const second = planTweens(new Map([["veh-1", place(44.01, -88.0)]]), [fixAt(44.02, "2026-09-17T12:00:00.000Z")], 5_000, first);

    expect(second.get("veh-1")).toBe(tween);
    expect(second.get("veh-1")!.startedAt).toBe(0);
  });

  // …and a board that DOES bring a new fix re-bases from where the dot currently is, as before.
  it("re-bases the moment a newer fix arrives", () => {
    const first = planTweens(new Map([["veh-1", place(44.0, -88.0)]]), [fixAt(44.02, "2026-09-17T12:00:00.000Z")], 0);
    const second = planTweens(new Map([["veh-1", place(44.01, -88.0)]]), [fixAt(44.04, "2026-09-17T12:00:11.000Z")], 5_000, first);

    expect(second.get("veh-1")).not.toBe(first.get("veh-1"));
    expect(second.get("veh-1")!.from).toEqual({ lat: 44.01, lng: -88.0, heading: 0 });
    expect(second.get("veh-1")!.startedAt).toBe(5_000);
  });
});

describe("how long a tween runs", () => {
  const secondFix = (gapSeconds: number) => {
    const first = planTweens(new Map([["veh-1", place(44.0, -88.0)]]), [fixAt(44.02, "2026-09-17T12:00:00.000Z")], 0);
    const later = new Date(Date.parse("2026-09-17T12:00:00.000Z") + gapSeconds * 1000).toISOString();
    return planTweens(new Map([["veh-1", place(44.01, -88.0)]]), [fixAt(44.04, later)], 5_000, first).get("veh-1")!;
  };

  /**
   * The measured interval, plus the latency budget the poll version used. ⚠ NOT the poll interval:
   * this fleet's fixes are ~11 s apart, so covering each segment in 6.5 s makes every dot outrun its
   * own truck and then wait.
   */
  it("spends the time the two fixes actually describe", () => {
    expect(secondFix(11).durationMs).toBe(11_000 + MOTION_LATENCY_BUDGET_MS);
    expect(secondFix(5).durationMs).toBe(5_000 + MOTION_LATENCY_BUDGET_MS);
  });

  /**
   * ⚠ A truck parked for an hour reports a fix whose predecessor is an hour old. Animating that
   * segment over an hour is a dot that never appears to move at all, so past the cap the honest
   * reading is that we do not know how it got there and it should simply arrive.
   */
  it("caps a long gap rather than gliding for an hour", () => {
    expect(secondFix(3_600).durationMs).toBe(MAX_TWEEN_MS);
    expect(MAX_TWEEN_MS).toBeGreaterThan(13_600); // the worst interval measured on production
  });

  // A first sighting has no interval to read, so it falls back to the poll-shaped default.
  it("falls back to the poll-shaped duration when there is no previous fix to measure against", () => {
    const first = planTweens(new Map([["veh-1", place(44.0, -88.0)]]), [fixAt(44.02, "2026-09-17T12:00:00.000Z")], 0);
    expect(first.get("veh-1")!.durationMs).toBe(MOTION_DURATION_MS);
  });

  // Each tween is sampled against ITS OWN duration — the reason the field exists on the tween.
  it("samples every truck against its own duration, not one global one", () => {
    const slow = { from: place(0, 0), to: place(10, 0), startedAt: 0, durationMs: 10_000, toSampledAt: "x" };
    const quick = { from: place(0, 0), to: place(10, 0), startedAt: 0, durationMs: 1_000, toSampledAt: "y" };
    const sampled = sampleTweens(new Map([["slow", slow], ["quick", quick]]), 1_000);
    expect(sampled.get("quick")!.lat).toBe(10);
    expect(sampled.get("slow")!.lat).toBeCloseTo(1, 5);
  });
});
