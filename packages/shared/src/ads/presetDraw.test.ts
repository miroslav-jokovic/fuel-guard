import { describe, expect, it } from "vitest";
import { drawPresets, nextPresetBatch, type PresetCandidate } from "./presetDraw.js";

const P = (key: string, enabled = true): PresetCandidate => ({ version_id: `v-${key}`, key, enabled });
const FIVE = ["P1", "P2", "P3", "P4", "P5"].map((k) => P(k));

describe("drawPresets", () => {
  it("the same seed and inputs give the same order, every time", () => {
    const a = drawPresets("campaign-1", FIVE, []);
    expect(drawPresets("campaign-1", FIVE, [])).toEqual(a);
    expect(drawPresets("campaign-1", [...FIVE].reverse(), [])).toEqual(a);
    expect([...a.order].sort()).toEqual(a.eligible);
  });

  it("different seeds give different orders", () => {
    const orders = new Set(Array.from({ length: 50 }, (_, i) => drawPresets(`c-${i}`, FIVE, []).order.join()));
    expect(orders.size).toBeGreaterThan(20);
  });

  it("each preset leads about a fifth of 6,000 draws — no preset is favoured by its place in the list", () => {
    const first = new Map<string, number>();
    for (let i = 0; i < 6000; i++) {
      const lead = drawPresets(`seed-${i}`, FIVE, []).order[0]!;
      first.set(lead, (first.get(lead) ?? 0) + 1);
    }
    for (const p of FIVE) {
      const n = first.get(p.version_id) ?? 0;
      // Expected 1,200; ±4.5σ of a binomial(6000, 0.2) is ±139. Fixed seeds, so this never flakes.
      expect(Math.abs(n - 1200), `${p.key} led ${n}`).toBeLessThan(140);
    }
  });

  it("a preset live for the same brief is never drawn, and is named as excluded", () => {
    for (let i = 0; i < 200; i++) {
      const d = drawPresets(`s-${i}`, FIVE, ["P2", "P4"]);
      expect(d.order).not.toContain("v-P2");
      expect(d.order).not.toContain("v-P4");
      expect(d.order).toHaveLength(3);
      expect(d.excluded_live).toEqual(["P2", "P4"]);
    }
  });

  it("a disabled preset is never drawn", () => {
    const d = drawPresets("s", [P("P1"), P("P2", false), P("P3")], []);
    expect(d.eligible).toEqual(["v-P1", "v-P3"]);
  });

  it("with every preset live or disabled the draw is exhausted — it never falls back to a repeat", () => {
    const d = drawPresets("s", [P("P1"), P("P2", false)], ["P1"]);
    expect(d).toMatchObject({ order: [], exhausted: true });
  });

  it("refuses an empty seed: an unrecorded draw cannot be explained", () => {
    expect(() => drawPresets("", FIVE, [])).toThrow(/seed/);
  });
});

describe("nextPresetBatch", () => {
  const draw = { order: ["a", "b", "c", "d", "e"] };
  it("creatives enter two at a time in the drawn order, skipping those started", () => {
    expect(nextPresetBatch(draw, [])).toEqual(["a", "b"]);
    expect(nextPresetBatch(draw, ["a", "b"])).toEqual(["c", "d"]);
    expect(nextPresetBatch(draw, ["a", "b", "c", "d"])).toEqual(["e"]);
    expect(nextPresetBatch(draw, ["a", "b", "c", "d", "e"])).toEqual([]);
  });
  it("a batch size below one is refused", () => {
    expect(() => nextPresetBatch(draw, [], 0)).toThrow();
  });
});
