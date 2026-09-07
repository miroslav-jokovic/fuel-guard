import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePng } from "../fixtures/png.mjs";

/**
 * The printed calibration targets say what they are (SCANNER-UPGRADE-PLAN.md, Step 0.1).
 *
 * ── THE FAILURE THIS EXISTS TO CATCH ──────────────────────────────────────────────────────────
 * These sheets get printed and photographed, and every measurement taken from those photographs is
 * a comparison against `manifest.json` — "the 204 step came back at 231", "the fiducial centre moved
 * 6 px", "the 028PX row stopped resolving". Every one of those sentences is nonsense if the manifest
 * and the pixels disagree. And they can disagree silently: change a layout constant, forget to
 * regenerate, and the manifest still describes a sheet that no longer exists while the PNG still
 * decodes perfectly.
 *
 * So this does not check that the sheets are well-formed. It checks that **the declared truth is the
 * drawn truth** — every wedge value, every patch colour, every fiducial centre, every line pitch and
 * every glyph height is read back out of the image and compared to what the manifest promises. The
 * digests catch a corrupted file; these catch a manifest that lies about a correct one.
 *
 * ⚠ A failure here is NOT fixed by regenerating. If a printed sheet is already in somebody's cab,
 * regenerating makes the manifest agree with a sheet nobody is holding. Bump `targetsVersion`,
 * regenerate, REPRINT, and say so — see the generator's `--check` message.
 */

const TARGETS = fileURLToPath(new URL("../fixtures/targets/", import.meta.url));

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface SheetRecord {
  name: string;
  file: string;
  width: number;
  height: number;
  pixelSha256: string;
  measures: string[];
  regions: {
    stepWedge?: { patches: Array<Region & { index: number; value: number }> };
    colourPatches?: { patches: Array<Region & { name: string; rgb: [number, number, number] }> };
    linePairs?: { blocks: Array<Region & { pitchPx: number }> };
    flatField?: Region;
    ladder?: Array<{ capHeightPx: number; scale: number; sample: string; x: number; y: number }>;
  };
}

const manifest = JSON.parse(readFileSync(join(TARGETS, "manifest.json"), "utf8")) as {
  targetsVersion: string;
  print: { dpi: number; widthPx: number; heightPx: number; scalingRequired: string };
  fiducials: { sizePx: number; centres: Array<{ name: string; x: number; y: number; keyed: boolean }> };
  sheets: SheetRecord[];
};

interface Decoded {
  width: number;
  height: number;
  rgb: Uint8Array;
}

const decoded = new Map<string, Decoded>(
  manifest.sheets.map((s) => [s.name, decodePng(readFileSync(join(TARGETS, s.file)))]),
);

function pixel(sheet: Decoded, x: number, y: number): [number, number, number] {
  const i = (y * sheet.width + x) * 3;
  return [sheet.rgb[i]!, sheet.rgb[i + 1]!, sheet.rgb[i + 2]!];
}

/** Ink means "not paper". The sheets are drawn in pure black on pure white, so any darkening is ink. */
function isInk(sheet: Decoded, x: number, y: number): boolean {
  return pixel(sheet, x, y)[0] < 128;
}

function sheetOf(name: string): { record: SheetRecord; image: Decoded } {
  const record = manifest.sheets.find((s) => s.name === name)!;
  return { record, image: decoded.get(name)! };
}

describe("the target sheets on disk", () => {
  it("decodes both sheets at A4 300 dpi with the declared digests", () => {
    expect(manifest.print.dpi).toBe(300);
    for (const record of manifest.sheets) {
      const image = decoded.get(record.name)!;
      expect(image.width, `${record.name} width`).toBe(record.width);
      expect(image.height, `${record.name} height`).toBe(record.height);
      // 2480 x 3508 is A4 at 300 dpi. Anything else and the printed dimensions every label states
      // are wrong, which makes every measurement taken from a print of it wrong too.
      expect(image.width).toBe(2480);
      expect(image.height).toBe(3508);
      expect(createHash("sha256").update(image.rgb).digest("hex"), `${record.name} pixels`).toBe(
        record.pixelSha256,
      );
    }
  });

  it("puts a fiducial where the manifest says its centre is, on every sheet", () => {
    // The centre must be ink, the ring around it paper, and the outer square ink again — a plain
    // "is there something dark here" would pass on any large black blob and would not notice the
    // concentric structure a centroid depends on.
    for (const record of manifest.sheets) {
      const image = decoded.get(record.name)!;
      for (const centre of manifest.fiducials.centres) {
        const tag = `${record.name}/${centre.name}`;
        expect(isInk(image, centre.x, centre.y), `${tag} centre is ink`).toBe(true);
        expect(isInk(image, centre.x - 45, centre.y), `${tag} inner ring is paper`).toBe(false);
        expect(isInk(image, centre.x - 75, centre.y), `${tag} outer square is ink`).toBe(true);
      }
    }
  });

  it("keys exactly one fiducial, so a sheet photographed upside down is detectable", () => {
    const keyed = manifest.fiducials.centres.filter((c) => c.keyed);
    expect(keyed).toHaveLength(1);
    expect(keyed[0]!.name).toBe("top-left");

    const { image } = sheetOf("target-a-metrology");
    const half = manifest.fiducials.sizePx / 2;
    // The key bar sits to the right of the top-left marker and nowhere else.
    expect(isInk(image, keyed[0]!.x + half + 60, keyed[0]!.y)).toBe(true);
    const unkeyed = manifest.fiducials.centres.find((c) => c.name === "bottom-left")!;
    expect(isInk(image, unkeyed.x + half + 60, unkeyed.y)).toBe(false);
  });
});

describe("sheet A carries the values it declares", () => {
  const { record, image } = sheetOf("target-a-metrology");

  it("draws every step-wedge patch at its declared grey value", () => {
    const patches = record.regions.stepWedge!.patches;
    expect(patches).toHaveLength(11);
    for (const patch of patches) {
      const [r, g, b] = pixel(image, patch.x + Math.floor(patch.w / 2), patch.y + Math.floor(patch.h / 2));
      expect(r, `step ${patch.index}`).toBe(patch.value);
      expect(g).toBe(patch.value);
      expect(b).toBe(patch.value);
    }
    // Both ends present, so highlight and shadow clipping are both measurable from a print.
    expect(patches[0]!.value).toBe(0);
    expect(patches[10]!.value).toBe(255);
  });

  it("draws every colour patch at its declared RGB", () => {
    const patches = record.regions.colourPatches!.patches;
    expect(patches.length).toBeGreaterThanOrEqual(9);
    for (const patch of patches) {
      const centre = pixel(image, patch.x + Math.floor(patch.w / 2), patch.y + Math.floor(patch.h / 2));
      expect(centre, patch.name).toEqual(patch.rgb);
    }
    // Three neutrals, because white balance is judged on greys and colour survival on the saturated
    // ones; a target with only saturated patches cannot tell you the paper went blue.
    const neutrals = patches.filter((p) => p.rgb[0] === p.rgb[1] && p.rgb[1] === p.rgb[2]);
    expect(neutrals).toHaveLength(3);
  });

  it("draws each line-pair block at exactly its declared pitch", () => {
    const blocks = record.regions.linePairs!.blocks;
    expect(blocks.length).toBeGreaterThanOrEqual(7);
    for (const block of blocks) {
      const y = block.y + Math.floor(block.h / 2);
      // The declared pitch is a period: a pixel and the one a full period away must match, and the
      // one half a period away must not. That is the definition, checked rather than eyeballed.
      for (let k = 6; k < block.w - block.pitchPx - 6; k += block.pitchPx) {
        const x = block.x + k;
        expect(isInk(image, x, y), `pitch ${block.pitchPx} period at +${k}`).toBe(
          isInk(image, x + block.pitchPx, y),
        );
      }
      const probe = block.x + 6;
      expect(
        isInk(image, probe, y) === isInk(image, probe + block.pitchPx / 2, y),
        `pitch ${block.pitchPx} half-period must differ`,
      ).toBe(false);
    }
    // Every pitch is even. An odd pitch cannot make a 50/50 line pair, and the block would measure
    // duty cycle rather than resolution.
    for (const block of blocks) expect(block.pitchPx % 2, `pitch ${block.pitchPx} is even`).toBe(0);
  });

  it("leaves the flat field completely empty", () => {
    // Its entire job is to carry nothing, so that what a photograph adds to it — noise, vignetting,
    // glare — is the measurement. One stray caption inside it would be ink in the result.
    const field = record.regions.flatField!;
    let ink = 0;
    for (let y = field.y; y < field.y + field.h; y += 3) {
      for (let x = field.x; x < field.x + field.w; x += 3) if (isInk(image, x, y)) ink++;
    }
    expect(ink).toBe(0);
  });
});

describe("sheet B carries the glyph heights it declares", () => {
  const { record, image } = sheetOf("target-b-legibility");

  it("prints each ladder row at exactly its declared cap height", () => {
    const ladder = record.regions.ladder!;
    expect(ladder.length).toBeGreaterThanOrEqual(7);

    for (const row of ladder) {
      // Measure the ink band over the SAMPLE's x-range only: the row's own "014PX" tag is drawn at a
      // fixed small scale and would flatten every measurement to that size.
      const x1 = Math.min(row.x + 400, image.width - 1);
      let top = -1;
      let bottom = -1;
      for (let y = row.y - 12; y < row.y + row.capHeightPx + 12; y++) {
        for (let x = row.x; x < x1; x++) {
          if (!isInk(image, x, y)) continue;
          if (top === -1) top = y;
          bottom = y;
          break;
        }
      }
      expect(top, `row ${row.capHeightPx}px top`).toBe(row.y);
      expect(bottom - top + 1, `row ${row.capHeightPx}px measured height`).toBe(row.capHeightPx);
    }
  });

  it("spans the shipped minMedianCharHeightPx floor from both sides", () => {
    // `config.ts` enforces minMedianCharHeightPx: 16 today and nothing has ever measured it against a
    // glyph. A ladder entirely above or entirely below the floor could not calibrate it: the printed
    // heights must bracket what 16 px becomes once a photograph of this sheet is downscaled.
    const heights = record.regions.ladder!.map((r) => r.capHeightPx);
    expect(Math.min(...heights)).toBeLessThan(16);
    expect(Math.max(...heights)).toBeGreaterThan(16 * 4);
    expect(new Set(heights).size, "every ladder height is distinct").toBe(heights.length);
  });
});
