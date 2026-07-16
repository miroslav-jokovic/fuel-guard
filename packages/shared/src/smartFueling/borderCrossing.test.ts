import { describe, it, expect } from "vitest";
import { findFirstBorderCrossingMile } from "./borderCrossing.js";

// inSet for a single border state "MA".
const inMA = (s: string | null) => s === "MA";

/** Build a classifier from a list of [fromMi, state] segments (state applies until the next segment). */
function segmentClassifier(segments: [number, string | null][], failAt?: (mi: number) => boolean) {
  return async (mi: number): Promise<string | null> => {
    if (failAt?.(mi)) return null; // simulate a HERE failure at these miles
    let state: string | null = segments[0]?.[1] ?? null;
    for (const [from, s] of segments) { if (mi + 1e-9 >= from) state = s; else break; }
    return state;
  };
}

describe("findFirstBorderCrossingMile", () => {
  it("finds a single clean crossing (CT → MA at mile 200)", async () => {
    const cls = segmentClassifier([[0, "CT"], [200, "MA"]]);
    const mile = await findFirstBorderCrossingMile(400, inMA, cls, { scanStepMi: 25 });
    expect(mile).not.toBeNull();
    expect(Math.abs(mile! - 200)).toBeLessThan(2); // pinned to ~±1 mi
  });

  it("returns the FIRST entry on a weaving route (clips MA early, exits, re-enters) — not the last", async () => {
    // In MA over [100,140], back to CT, then MA again from 300 to the destination.
    const cls = segmentClassifier([[0, "CT"], [100, "MA"], [140, "CT"], [300, "MA"]]);
    const mile = await findFirstBorderCrossingMile(400, inMA, cls, { scanStepMi: 20 });
    expect(mile).not.toBeNull();
    expect(Math.abs(mile! - 100)).toBeLessThan(3); // the FIRST crossing (~100), proving no single-crossing assumption
  });

  it("returns null when the route never enters the border state", async () => {
    const cls = segmentClassifier([[0, "CT"], [200, "NH"]]);
    expect(await findFirstBorderCrossingMile(400, inMA, cls, {})).toBeNull();
  });

  it("returns null when the crossing sits essentially at the destination", async () => {
    const cls = segmentClassifier([[0, "CT"], [399.5, "MA"]]);
    expect(await findFirstBorderCrossingMile(400, inMA, cls, { scanStepMi: 25 })).toBeNull();
  });

  it("still brackets correctly when interior lookups fail (nulls are skipped, not treated as outside)", async () => {
    // Confirmed CT at the start, MA near the end, but every lookup in the middle band fails (null).
    const cls = segmentClassifier([[0, "CT"], [250, "MA"]], (mi) => mi > 60 && mi < 240);
    const mile = await findFirstBorderCrossingMile(400, inMA, cls, { scanStepMi: 25 });
    expect(mile).not.toBeNull();
    // The true border is 250; with a null band [60,240] the refine biases earlier (safe) but stays before 250.
    expect(mile!).toBeLessThanOrEqual(250 + 1e-6);
    expect(mile!).toBeGreaterThan(50);
  });

  it("biases the border EARLIER (never later) when refinement lookups fail", async () => {
    // Coarse scan confirms CT@200-ish and MA@225-ish, but the refine band fails → must not push past the true line.
    const cls = segmentClassifier([[0, "CT"], [225, "MA"]], (mi) => mi > 210 && mi < 224);
    const mile = await findFirstBorderCrossingMile(400, inMA, cls, { scanStepMi: 25, refineIters: 10 });
    expect(mile).not.toBeNull();
    expect(mile!).toBeLessThanOrEqual(225 + 1e-6); // earlier/at the line, never beyond it
  });
});
