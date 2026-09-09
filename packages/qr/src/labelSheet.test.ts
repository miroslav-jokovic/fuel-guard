import { describe, expect, it } from "vitest";
import {
  LABEL_PRESETS,
  LABEL_PRESET_IDS,
  POINTS_PER_INCH,
  labelSheet,
  type LabelPresetId,
} from "./labelSheet.js";
import { encode, moduleSizeMm } from "./encode.js";

/**
 * The arithmetic check that resolves the one ambiguity in the published vendor tables: several
 * report "labels across" and "labels down" transposed, and for each preset only one orientation
 * both fits the sheet AND leaves the two opposite margins equal. If a preset were transcribed with
 * its rows and columns swapped, or with a wrong pitch, this is what would catch it.
 */
describe("every preset's geometry closes on the sheet, with equal opposite margins", () => {
  for (const id of LABEL_PRESET_IDS) {
    it(id, () => {
      const p = LABEL_PRESETS[id];
      const usedWidth = (p.columns - 1) * p.pitch.x + p.label.width;
      const usedHeight = (p.rows - 1) * p.pitch.y + p.label.height;

      // It fits.
      expect(p.margin.left + usedWidth).toBeLessThanOrEqual(p.sheet.width + 0.001);
      expect(p.margin.top + usedHeight).toBeLessThanOrEqual(p.sheet.height + 0.001);

      // And it is centred: the right margin equals the left, the bottom equals the top.
      const rightMargin = p.sheet.width - p.margin.left - usedWidth;
      const bottomMargin = p.sheet.height - p.margin.top - usedHeight;
      expect(rightMargin).toBeCloseTo(p.margin.left, 3);
      expect(bottomMargin).toBeCloseTo(p.margin.top, 3);

      // Labels do not overlap.
      expect(p.pitch.x).toBeGreaterThanOrEqual(p.label.width);
      expect(p.pitch.y).toBeGreaterThanOrEqual(p.label.height);
    });
  }
});

describe("the presets are the ones D-INV25 names", () => {
  it("has exactly the five, and the counts published for each", () => {
    const perSheet = Object.fromEntries(
      LABEL_PRESET_IDS.map((id) => [id, LABEL_PRESETS[id].columns * LABEL_PRESETS[id].rows]),
    );
    expect(perSheet).toEqual({
      "avery-22805": 24,
      "avery-22816": 12,
      "avery-5160": 30,
      "avery-5520": 30,
      "roll-single": 1,
    });
  });

  it("keeps 5520 geometrically identical to 5160 — same template, different film", () => {
    const a = LABEL_PRESETS["avery-5160"];
    const b = LABEL_PRESETS["avery-5520"];
    expect({ ...b, id: a.id, name: a.name, material: a.material }).toEqual(a);
  });

  it("uses 72 points to the inch, so a 1.5\" label is 108 pt", () => {
    expect(POINTS_PER_INCH).toBe(72);
    expect(LABEL_PRESETS["avery-22805"].label.width).toBe(108);
  });

  it("leaves every square preset above the phone-camera module floor", () => {
    const symbol = encode("SIL1:AST:7K3M9P", { ecc: "H" });
    for (const id of ["avery-22805", "avery-22816", "roll-single"] as LabelPresetId[]) {
      const widthMm = (LABEL_PRESETS[id].label.width / POINTS_PER_INCH) * 25.4;
      expect(moduleSizeMm(symbol, widthMm)).toBeGreaterThan(0.4);
    }
  });
});

describe("labelSheet placement", () => {
  it("lays the first sheet out left-to-right then down", () => {
    const s = labelSheet(5, "avery-22805");
    const p = LABEL_PRESETS["avery-22805"];
    expect(s.placements[0]).toMatchObject({ position: 1, page: 0, x: p.margin.left, y: p.margin.top });
    expect(s.placements[1]).toMatchObject({ position: 2, x: p.margin.left + p.pitch.x, y: p.margin.top });
    // 4 columns, so the fifth label wraps to the second row.
    expect(s.placements[4]).toMatchObject({
      position: 5,
      x: p.margin.left,
      y: p.margin.top + p.pitch.y,
    });
  });

  it("starts at position 7 when told to, and puts it in the right physical slot", () => {
    const s = labelSheet(1, "avery-22805", { startPosition: 7 });
    const p = LABEL_PRESETS["avery-22805"];
    // Position 7 on a 4-wide sheet is row 1 (0-based), column 2.
    expect(s.placements[0]).toMatchObject({
      position: 7,
      page: 0,
      x: p.margin.left + 2 * p.pitch.x,
      y: p.margin.top + 1 * p.pitch.y,
    });
  });

  it("offsets only the FIRST sheet — the second sheet is fresh and starts at position 1", () => {
    // The behaviour a naive modulo gets wrong, and the one a person expects: you only skip the
    // labels you already peeled off the sheet in your hand.
    const s = labelSheet(20, "avery-22805", { startPosition: 7 });
    expect(s.perSheet).toBe(24);
    const firstSheet = s.placements.filter((pl) => pl.page === 0);
    const secondSheet = s.placements.filter((pl) => pl.page === 1);
    expect(firstSheet).toHaveLength(18); // 24 − 6 already used
    expect(firstSheet[0]?.position).toBe(7);
    expect(firstSheet.at(-1)?.position).toBe(24);
    expect(secondSheet).toHaveLength(2);
    expect(secondSheet[0]?.position).toBe(1);
    expect(s.pages).toBe(2);
  });

  it("fills exactly one page when the count matches the sheet", () => {
    const s = labelSheet(24, "avery-22805");
    expect(s.pages).toBe(1);
    expect(s.placements.at(-1)?.position).toBe(24);
  });

  it("rolls to a third page for a long run", () => {
    const s = labelSheet(60, "avery-5160");
    expect(s.perSheet).toBe(30);
    expect(s.pages).toBe(2);
    expect(labelSheet(61, "avery-5160").pages).toBe(3);
  });

  it("gives a roll one label per page", () => {
    const s = labelSheet(3, "roll-single");
    expect(s.pages).toBe(3);
    expect(s.placements.map((pl) => pl.page)).toEqual([0, 1, 2]);
    expect(s.placements.every((pl) => pl.x === 0 && pl.y === 0)).toBe(true);
  });

  it("applies the nudge identically to every placement — printer drift is a constant", () => {
    const plain = labelSheet(24, "avery-22805");
    const nudged = labelSheet(24, "avery-22805", { nudge: { x: 3, y: -2 } });
    for (let i = 0; i < plain.placements.length; i += 1) {
      expect(nudged.placements[i]!.x - plain.placements[i]!.x).toBeCloseTo(3, 9);
      expect(nudged.placements[i]!.y - plain.placements[i]!.y).toBeCloseTo(-2, 9);
    }
  });

  it("returns nothing, and no pages, for a count of zero", () => {
    const s = labelSheet(0, "avery-22805");
    expect(s.placements).toEqual([]);
    expect(s.pages).toBe(0);
  });

  it("refuses a start position off the end of the sheet", () => {
    expect(() => labelSheet(1, "avery-22805", { startPosition: 25 })).toThrow(/between 1 and 24/);
    expect(() => labelSheet(1, "avery-22805", { startPosition: 0 })).toThrow(/between 1 and 24/);
  });

  it("refuses a negative or fractional count", () => {
    expect(() => labelSheet(-1, "avery-22805")).toThrow(/non-negative/);
    expect(() => labelSheet(1.5, "avery-22805")).toThrow(/non-negative/);
  });
});
