import { describe, expect, it } from "vitest";
import {
  AD_FORMATS, FORMAT_SIZE, checkRender, contains, contrastRatio, parseHex, safeZone, tightenZone, type PlacedText,
} from "./renderGeometry.js";

const WHITE = [255, 255, 255] as const;
const BLACK = [0, 0, 0] as const;
const block = (patch: Partial<PlacedText> = {}): PlacedText => ({
  label: "pay", box: { x: 200, y: 400, width: 600, height: 120 }, needed_width: 580, px: 64, bold: true,
  color: WHITE, background_samples: [BLACK], ...patch,
});

describe("safe zones", () => {
  it("each format's zone lies inside its frame", () => {
    for (const f of AD_FORMATS) {
      const { width, height } = FORMAT_SIZE[f];
      expect(contains({ x: 0, y: 0, width, height }, safeZone(f)), f).toBe(true);
    }
  });
  it("9:16 keeps the top 15 % and the bottom 36 % clear — where the platform draws its own buttons", () => {
    const z = safeZone("9:16");
    expect(z.y).toBe(288);
    expect(z.y + z.height).toBe(1228);
  });
  it("a brand kit may tighten a zone, never widen it", () => {
    const base = safeZone("1:1");
    expect(tightenZone(base, { ...base, x: base.x + 10, width: base.width - 10 })).not.toBeNull();
    expect(tightenZone(base, { ...base, x: base.x - 1 })).toBeNull();
  });
});

describe("contrast (WCAG 2.x)", () => {
  it("matches the reference values: black on white 21:1, #777 on white ~4.48:1", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(parseHex("#777777")!, WHITE)).toBeCloseTo(4.48, 2);
  });
  it("parses brand colours and refuses anything that is not six hex digits", () => {
    expect(parseHex("#0B3D2E")).toEqual([11, 61, 46]);
    expect(parseHex("0b3d2e")).toEqual([11, 61, 46]);
    expect(parseHex("#fff")).toBeNull();
    expect(parseHex("teal")).toBeNull();
  });
});

describe("checkRender", () => {
  it("white bold pay on black inside the zone is green", () => {
    expect(checkRender("1:1", [block()])).toEqual([]);
  });
  it("the WORST sample decides: one light pixel under the text fails a block that averages fine", () => {
    const f = checkRender("1:1", [block({ px: 20, bold: false, background_samples: [BLACK, BLACK, [230, 230, 230]] })]);
    expect(f).toEqual([{ kind: "low_contrast", label: "pay", worst: 1.25, required: 4.5 }]);
  });
  it("large text needs 3:1, body text 4.5:1 — #777 on white passes large and fails small", () => {
    const grey = parseHex("#777777")!;
    expect(checkRender("1:1", [block({ color: grey, background_samples: [WHITE], px: 24, bold: false })])).toEqual([]);
    expect(checkRender("1:1", [block({ color: grey, background_samples: [WHITE], px: 23, bold: false })])[0]?.kind).toBe("low_contrast");
  });
  it("a line that needs more width than its box is refused, not shrunk", () => {
    expect(checkRender("1:1", [block({ needed_width: 601 })])).toEqual([{ kind: "overflows", label: "pay", needed_width: 601, width: 600 }]);
    expect(checkRender("1:1", [block({ needed_width: 600 })])).toEqual([]);
  });
  it("text in a Reels button strip is outside the safe zone", () => {
    expect(checkRender("9:16", [block({ box: { x: 200, y: 1700, width: 600, height: 120 } })])).toEqual([
      { kind: "outside_safe_zone", label: "pay" },
    ]);
  });
  it("a block with no background measured is a finding, never a pass", () => {
    expect(checkRender("1:1", [block({ background_samples: [] })])).toEqual([{ kind: "no_background_samples", label: "pay" }]);
  });
});
