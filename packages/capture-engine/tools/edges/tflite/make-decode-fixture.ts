import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { docalignerQuad, type HeatmapPlane } from "../../../src/edges/docalignerDecode";
import { decodeFixtureInput, inputDigest, syntheticHeatmap, SYNTHETIC_CASES } from "../../../src/edges/docalignerFixture";

/**
 * Writes `fixtures/edges/docaligner-decode.json`: the cases the Android decoder (`DocAlignerDecode.kt`)
 * must reproduce exactly, with the answers the TypeScript reference (`src/edges/docalignerDecode.ts`) gives.
 *
 *   - real heatmaps from the model (float16, gzip, base64), from `heatmaps_for_fixture.py`, each decoded
 *     at two image sizes: a portrait analysis frame (480 × 640) and the SmartDoc landscape (640 × 360);
 *   - synthetic heatmaps built from a formula both languages evaluate identically (no transcendental
 *     functions), for the edges a real frame rarely shows: one channel empty, two blobs in one channel;
 *   - a digest of the model input for a synthetic image (the phone checks it at all four camera rotations).
 *
 *   node tools/edges/tflite/make-decode-fixture.ts <heatmaps-dir>
 *
 * `tests/docalignerDecode.test.ts` re-derives every expected answer from the committed inputs, so
 * the fixture fails the build the day the reference changes and it is not regenerated.
 */
const dir = process.argv[2];
if (!dir) throw new Error("usage: make-decode-fixture.ts <dir written by heatmaps_for_fixture.py>");
const index = JSON.parse(readFileSync(`${dir}/heatmaps.json`, "utf8")) as { name: string; offset: number }[];
const bin = readFileSync(`${dir}/heatmaps.bin`);
const PLANE = 128 * 128;
const SIZES: [number, number][] = [[480, 640], [640, 360]];

const real = index.map(({ name, offset }) => {
  const half = new Float16Array(bin.buffer.slice(bin.byteOffset + offset, bin.byteOffset + offset + 4 * PLANE * 2));
  const planes: HeatmapPlane[] = [0, 1, 2, 3].map((c) => (x, y) => half[c * PLANE + y * 128 + x]!);
  return {
    name,
    heatmapF16: gzipSync(Buffer.from(half.buffer)).toString("base64"),
    expected: SIZES.map(([W, H]) => ({ W, H, quad: docalignerQuad(planes, 128, 128, W, H) })),
  };
});

const synthetic = SYNTHETIC_CASES.map((c) => {
  const planes: HeatmapPlane[] = [0, 1, 2, 3].map((ch) => (x, y) => syntheticHeatmap(c, ch, x, y));
  return { ...c, expected: SIZES.map(([W, H]) => ({ W, H, quad: docalignerQuad(planes, 128, 128, W, H) })) };
});

const input = inputDigest(decodeFixtureInput());

const out = { generatedBy: "packages/capture-engine/tools/edges/tflite/make-decode-fixture.ts", real, synthetic, input };
writeFileSync(new URL("../../../fixtures/edges/docaligner-decode.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(`${real.length} real, ${synthetic.length} synthetic`);
