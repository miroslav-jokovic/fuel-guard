import { describe, it, expect } from "vitest";
import {
  deriveVehicleState,
  secondsSince,
  lerp,
  lerpAngle,
  lerpPosition,
  STOPPED_SPEED_MPH,
  ENGINE_ON_BOUND_SECONDS,
  OFFLINE_BOUND_SECONDS,
} from "./livemap.js";

const NOW = "2026-09-15T18:00:00.000Z";
const agoSec = (s: number) => new Date(new Date(NOW).getTime() - s * 1000).toISOString();
const state = (o: { age?: number; speed?: number | null; sampledAt?: string | null }) =>
  deriveVehicleState(
    { sampledAt: o.sampledAt !== undefined ? o.sampledAt : agoSec(o.age ?? 0), speedMph: o.speed ?? null },
    NOW,
  );

describe("secondsSince", () => {
  it("measures from the vendor's stamp, not from when we stored it", () => {
    expect(secondsSince(agoSec(125), NOW)).toBe(125);
  });

  // Null and 0 are opposite claims: 0 means "we just heard from this truck".
  it("returns null, never 0, when there is no usable stamp", () => {
    expect(secondsSince(null, NOW)).toBeNull();
    expect(secondsSince(undefined, NOW)).toBeNull();
    expect(secondsSince("not a date", NOW)).toBeNull();
  });

  // A vendor clock a second fast is not a truck reporting from the future — and if it were allowed
  // through, that truck would sort as the freshest thing on the map.
  it("clamps a stamp from the future to 0 rather than reporting a negative age", () => {
    expect(secondsSince(new Date(new Date(NOW).getTime() + 4000).toISOString(), NOW)).toBe(0);
  });
});

describe("deriveVehicleState", () => {
  it("calls a truck above the speed threshold moving", () => {
    expect(state({ age: 5, speed: 62 })).toBe("moving");
  });

  // The threshold is the TOP of the noise band, so a truck sitting exactly on it belongs on the quiet
  // side. Measured: 9 of 171 production trucks were reporting between 0 and 3 mph while parked.
  it("treats exactly the threshold as NOT moving, and a hair above it as moving", () => {
    expect(state({ age: 5, speed: STOPPED_SPEED_MPH })).toBe("stopped");
    expect(state({ age: 5, speed: STOPPED_SPEED_MPH + 0.1 })).toBe("moving");
  });

  it("is stopped, not parked, when a still truck is still pinging fast — the engine is on", () => {
    expect(state({ age: 5, speed: 0 })).toBe("stopped");
    expect(state({ age: ENGINE_ON_BOUND_SECONDS, speed: 0 })).toBe("stopped");
  });

  // The inference the whole state model rests on: with no history to read, the vendor's PING RATE is
  // the signal. Samsara drops to ~one ping every 5 minutes when a vehicle is switched off.
  it("is parked once a still truck's pings have slowed past the engine-on bound", () => {
    expect(state({ age: ENGINE_ON_BOUND_SECONDS + 1, speed: 0 })).toBe("parked");
    expect(state({ age: 240, speed: 0 })).toBe("parked");
  });

  it("is offline past the staleness bound, and fresh at exactly the bound", () => {
    expect(state({ age: OFFLINE_BOUND_SECONDS, speed: 0 })).toBe("parked");
    expect(state({ age: OFFLINE_BOUND_SECONDS + 1, speed: 0 })).toBe("offline");
  });

  // ⚠ The bound is measured against the PARKED ping cadence (~5 min), not the ~15 s moving one. At a
  // moving-sized bound the whole yard turns grey overnight and the colour stops meaning anything.
  it("does not call a truck parked for ten minutes offline — that is a normal parked ping", () => {
    expect(state({ age: 600, speed: 0 })).toBe("parked");
  });

  // Staleness and state are two different facts (D-LM10). 65 of 171 production trucks sat between one
  // and five minutes old; calling those offline would grey out most of a driving fleet.
  it("still calls a fast truck with a four-minute-old fix moving, and leaves the age to the panel", () => {
    expect(state({ age: 240, speed: 62 })).toBe("moving");
    expect(secondsSince(agoSec(240), NOW)).toBe(240);
  });

  it("is offline when there is no fix at all, rather than inventing a fourth unknown state", () => {
    expect(state({ sampledAt: null, speed: 62 })).toBe("offline");
    expect(deriveVehicleState(null, NOW)).toBe("offline");
    expect(deriveVehicleState(undefined, NOW)).toBe("offline");
  });

  // 0341 makes the column nullable precisely so absent is not 0 — but for the STATE, a fix with no
  // speed cannot be claimed to be moving. It falls to the ping-rate inference like any still truck.
  //
  // ⚠ This one pins BEHAVIOUR and cannot discriminate the implementation: deleting the
  // `Number.isFinite` guard leaves it green, because `NaN > 3` is already false. That was found by
  // mutating, is recorded in `deriveVehicleState`'s own comment, and the assertion is kept anyway —
  // the behaviour is what a caller depends on, whichever line happens to produce it.
  it("does not call a truck with no speed reading moving", () => {
    expect(state({ age: 5, speed: null })).toBe("stopped");
    expect(state({ age: 240, speed: null })).toBe("parked");
    expect(state({ age: 5, speed: Number.NaN })).toBe("stopped");
  });

  it("takes injected bounds so a caller can be configured without a second copy of the rules", () => {
    const at = { sampledAt: agoSec(60), speedMph: 1 };
    expect(deriveVehicleState(at, NOW, { offlineBoundSeconds: 30 })).toBe("offline");
    expect(deriveVehicleState(at, NOW, { engineOnBoundSeconds: 120 })).toBe("stopped");
    expect(deriveVehicleState(at, NOW, { stoppedSpeedMph: 0 })).toBe("moving");
  });
});

describe("lerp", () => {
  it("interpolates and clamps, so a late frame cannot overshoot the target", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 1.4)).toBe(10);
    expect(lerp(0, 10, -0.3)).toBe(0);
  });

  it("moves a truck between two fixes on both axes", () => {
    expect(lerpPosition({ lat: 40, lng: -88 }, { lat: 42, lng: -86 }, 0.5)).toEqual({ lat: 41, lng: -87 });
  });
});

describe("lerpAngle — the short way round", () => {
  // The defect this exists to prevent looks like a rendering bug: every icon spinning a full turn
  // each time the truck crosses north.
  it("sweeps 359° → 1° forward through north, not backwards through south", () => {
    expect(lerpAngle(359, 1, 0.5)).toBe(0);
    expect(lerpAngle(359, 1, 0.25)).toBeCloseTo(359.5, 6);
    expect(lerpAngle(359, 1, 0.75)).toBeCloseTo(0.5, 6);
  });

  it("sweeps the other way across north too", () => {
    expect(lerpAngle(1, 359, 0.5)).toBe(0);
    expect(lerpAngle(10, 350, 0.5)).toBe(0);
  });

  it("takes the short way when the short way is the plain one", () => {
    expect(lerpAngle(90, 180, 0.5)).toBe(135);
    expect(lerpAngle(180, 90, 0.5)).toBe(135);
  });

  // Neither answer is more correct for an exact opposition; the only thing that matters is that it
  // cannot change silently, so the tie is pinned here.
  it("resolves an exact 180° opposition counter-clockwise, deterministically", () => {
    expect(lerpAngle(0, 180, 0.5)).toBe(270);
    expect(lerpAngle(90, 270, 0.5)).toBe(0);
  });

  it("always returns a bearing the position column would admit — [0, 360)", () => {
    for (let from = 0; from < 360; from += 17) {
      for (let to = 0; to < 360; to += 23) {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const got = lerpAngle(from, to, t);
          expect(got, `${from}->${to} @${t}`).toBeGreaterThanOrEqual(0);
          expect(got, `${from}->${to} @${t}`).toBeLessThan(360);
        }
      }
    }
  });

  it("returns the endpoints exactly at t=0 and t=1, and clamps beyond them", () => {
    expect(lerpAngle(359, 1, 0)).toBe(359);
    expect(lerpAngle(359, 1, 1)).toBe(1);
    expect(lerpAngle(359, 1, 2)).toBe(1);
    expect(lerpAngle(359, 1, -1)).toBe(359);
  });
});
