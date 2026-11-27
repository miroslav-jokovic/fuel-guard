import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { Quad } from "../src/enhance/homography";
import { docalignerQuad, type HeatmapPlane } from "../src/edges/docalignerDecode";
import { decodeFixtureInput, inputDigest, syntheticHeatmap, SYNTHETIC_CASES } from "../src/edges/docalignerFixture";

/**
 * The decode-parity fixture is the CONTRACT the Android scanner is held to (`DocAlignerDecode.kt`), so
 * it must say what this reference says today. Every expected answer is re-derived here from the
 * committed inputs; a change to `docalignerDecode.ts` without regenerating the fixture fails this file,
 * not a phone.
 */
interface Expected {
  W: number;
  H: number;
  quad: Quad | null;
}
interface Fixture {
  real: { name: string; heatmapF16: string; expected: Expected[] }[];
  synthetic: { name: string; expected: Expected[] }[];
  input: { sum: number; head: number[] };
}
const fixture = JSON.parse(readFileSync(new URL("../fixtures/edges/docaligner-decode.json", import.meta.url), "utf8")) as Fixture;

describe("docaligner decode fixture", () => {
  it("re-derives every real heatmap's corners", () => {
    expect(fixture.real.length).toBeGreaterThanOrEqual(5);
    for (const r of fixture.real) {
      const bytes = gunzipSync(Buffer.from(r.heatmapF16, "base64"));
      const half = new Float16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
      const planes: HeatmapPlane[] = [0, 1, 2, 3].map((c) => (x, y) => half[c * 128 * 128 + y * 128 + x]!);
      for (const e of r.expected) expect(docalignerQuad(planes, 128, 128, e.W, e.H), r.name).toEqual(e.quad);
      expect(r.expected.every((e) => e.quad !== null), `${r.name}: a real SmartDoc page must be found`).toBe(true);
    }
  });

  it("re-derives the synthetic cases, including a missing corner and a second blob", () => {
    expect(fixture.synthetic.map((s) => s.name)).toEqual(SYNTHETIC_CASES.map((c) => c.name));
    for (const [i, c] of SYNTHETIC_CASES.entries()) {
      const planes: HeatmapPlane[] = [0, 1, 2, 3].map((ch) => (x, y) => syntheticHeatmap(c, ch, x, y));
      for (const e of fixture.synthetic[i]!.expected) expect(docalignerQuad(planes, 128, 128, e.W, e.H), c.name).toEqual(e.quad);
    }
    expect(fixture.synthetic.find((s) => s.name === "one corner too weak")!.expected.every((e) => e.quad === null)).toBe(true);
  });

  it("re-derives the model input digest", () => {
    expect(inputDigest(decodeFixtureInput())).toEqual(fixture.input);
  });

  it("takes the LARGEST blob of a channel, not the first one scanned", () => {
    // The second case's extra blob sits above-left of the real corner in scan order; the corner wins.
    const two = fixture.synthetic.find((s) => s.name === "two blobs in one channel")!.expected[0]!.quad!;
    const clean = fixture.synthetic.find((s) => s.name === "four clean corners")!.expected[0]!.quad!;
    expect(Math.abs(two[0].x - clean[0].x)).toBeLessThan(1);
    expect(Math.abs(two[0].y - clean[0].y)).toBeLessThan(1);
  });
});
