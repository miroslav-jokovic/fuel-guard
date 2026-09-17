import { describe, it, expect } from "vitest";
import type { LiveMapVehicle } from "@silvicom/shared";
import { planTweens, sampleTweens, type Tween } from "@/features/livemap/liveMapMotion";
import type { RenderedPlace } from "@/features/livemap/liveMapLayer";

/**
 * How fast the DOT moves, over a minute of production-shaped boards (D-LM8b).
 *
 * ── WHY A VELOCITY TEST AND NOT ANOTHER ASSERTION ABOUT TWEENS ──────────────────────────────────
 * The owner reported the markers "slowing down every 4.7 seconds" AFTER the freeze had been fixed,
 * and every unit test in `liveMapMotion.test.ts` passed throughout: each one asks whether a single
 * tween is built correctly, and the defect was in the SEQUENCE of them. What a reader sees is a
 * speed, so this measures a speed — sampling the real `planTweens`/`sampleTweens` at 60fps and
 * reporting how much it varies.
 *
 * ── THE SHAPE OF THE INPUT IS MEASURED, NOT INVENTED ────────────────────────────────────────────
 * Production, 2026-09-17: 27 trucks moving, median fix age **5.6 s**, mean 5.5 s, worst 13.6 s.
 * Ages are uniform over the arrival interval, so fixes land about every **11 seconds** against a
 * **5-second** poll — which is why the constants below are 5,000 and 11,000 and not two round
 * numbers. More than half of all boards repeat a position.
 *
 * ⚠ It asserts a RATIO against the old behaviour rather than an absolute swing, so it cannot be
 * satisfied by tuning a constant until the number looks good: `planTweens` called without the
 * existing tweens IS the old behaviour, so the comparison stays honest as the code moves.
 * Measured at the time of writing: **127% swing and 1,204 slow frames before, 21% and 4 after.**
 */
const POLL = 5_000, FIX_EVERY = 11_000, FPS = 60, WATCH = 60_000;

function vehicleAt(lat: number, sampledAt: string): LiveMapVehicle {
  return {
    vehicleId: "veh-1", unitNumber: "1207", driver: null, state: "moving", ageSeconds: 2, load: null,
    fuel: null,
    position: { lat, lng: -88, headingDegrees: 90, speedMph: 62, isEcuSpeed: true,
      formattedLocation: null, sampledAt, receivedAt: sampledAt },
  };
}

function run(threadExisting: boolean): { swingPct: number; stalls: number } {
  const t0 = Date.parse("2026-09-17T12:00:00.000Z");
  let tweens = new Map<string, Tween>();
  let places = new Map<string, RenderedPlace>([["veh-1", { lat: 0, lng: -88, heading: 90 }]]);
  let poll = -1, lastLat = 0;
  const speeds: number[] = [];

  for (let t = 0; t <= WATCH; t += 1000 / FPS) {
    if (Math.floor(t / POLL) !== poll) {
      poll = Math.floor(t / POLL);
      // A new fix only every FIX_EVERY ms; the board repeats the last one in between.
      const fixIndex = Math.floor(t / FIX_EVERY);
      const lat = fixIndex * 0.01;                       // the truck advances 0.01° per fix
      const sampledAt = new Date(t0 + fixIndex * FIX_EVERY).toISOString();
      tweens = threadExisting
        ? planTweens(places, [vehicleAt(lat, sampledAt)], t, tweens)
        // The behaviour before D-LM8b: every board re-bases, with one fixed duration.
        : planTweens(places, [vehicleAt(lat, sampledAt)], t);
    }
    places = sampleTweens(tweens, t);
    const lat = places.get("veh-1")!.lat;
    if (t > 20_000) speeds.push((lat - lastLat) * FPS);
    lastLat = lat;
  }
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const sorted = [...speeds].sort((a, b) => a - b);
  const p05 = sorted[Math.floor(sorted.length * 0.05)]!;
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  return { swingPct: ((p95 - p05) / mean) * 100, stalls: speeds.filter((v) => v < mean * 0.5).length };
}

describe("marker velocity over a minute of production-shaped boards", () => {
  it("holds a steady speed instead of crawling on every repeated fix", () => {
    const before = run(false);
    const after = run(true);
    console.log(`BEFORE swing ${before.swingPct.toFixed(0)}% · slow frames ${before.stalls}`);
    console.log(`AFTER  swing ${after.swingPct.toFixed(0)}% · slow frames ${after.stalls}`);
    expect(after.swingPct).toBeLessThan(before.swingPct / 3);
    expect(after.stalls).toBeLessThan(before.stalls / 10);
  });
});
