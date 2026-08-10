import { describe, expect, it } from "vitest";
import { PLACARD_ART, renderPlacardWithIdNumber } from "./registry.js";
import { diamondHalfWidthAt, estimateTextWidth, renderPlacardSvg } from "./svg.js";

/**
 * Geometry regressions for the placard renderer. Three real failures live here, all of which shipped:
 *
 *  1. the root <svg> carried width="200" height="200", so it ignored whatever box the caller sized and
 *     overflowed it — covering captions, positions text and citation chips underneath;
 *  2. `clipPath id="cl"` was hardcoded, so two striped placards on one page shared a clip and Class 9
 *     came out with full-height stripes instead of §172.560's top-half-only field;
 *  3. wording font size was chosen from the WORD COUNT with no measurement, so long placard wordings
 *     ran out through the sides of the diamond.
 */

/** Every glyph box must sit inside the diamond |x−100| + |y−100| ≤ 96, with room for the border rule. */
const SAFE = 96 - 4;

interface ParsedText {
  x: number;
  y: number;
  size: number;
  content: string;
}

function parseTexts(svg: string): ParsedText[] {
  const out: ParsedText[] = [];
  const re = /<text\b([^>]*)>([^<]*)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    const attrs = m[1] ?? "";
    const num = (name: string): number => Number(new RegExp(`${name}="([-\\d.]+)"`).exec(attrs)?.[1] ?? "0");
    out.push({ x: num("x"), y: num("y"), size: num("font-size"), content: m[2] ?? "" });
  }
  return out;
}

function insideDiamond(x: number, y: number): boolean {
  return Math.abs(x - 100) + Math.abs(y - 100) <= SAFE;
}

describe("placard SVG geometry", () => {
  it("scales to its container instead of forcing 200×200 pixels", () => {
    for (const art of Object.values(PLACARD_ART)) {
      expect(art.svg).toContain('viewBox="0 0 200 200"');
      expect(art.svg).toContain('width="100%"');
      expect(art.svg).toContain('height="100%"');
      expect(art.svg).toContain("preserveAspectRatio");
      expect(art.svg, "a fixed pixel size on the root would overflow whatever box the caller sized").not.toMatch(
        /<svg[^>]*width="\d+"/,
      );
    }
  });

  it("still offers intrinsic pixels when a caller genuinely wants them", () => {
    const svg = renderPlacardSvg(
      { text: "FLAMMABLE", classNumber: "3", background: { kind: "solid", color: "#E4002B" }, symbol: "flame", ink: "#FFFFFF" },
      { pxSize: 64 },
    );
    expect(svg).toContain('width="64"');
    expect(svg).toContain('height="64"');
  });

  it("gives every striped placard its own clip id so two on a page cannot collide", () => {
    const nine = PLACARD_ART.CLASS_9.svg;
    const solid = PLACARD_ART.FLAMMABLE_SOLID.svg;
    const idOf = (svg: string): string => /<clipPath id="([^"]+)"/.exec(svg)?.[1] ?? "";
    expect(idOf(nine)).not.toBe("");
    expect(idOf(solid)).not.toBe("");
    expect(idOf(nine)).not.toBe(idOf(solid));
  });

  it("keeps Class 9's stripe field in the TOP HALF only (§172.560)", () => {
    const clip = /<clipPath id="[^"]+"><polygon points="([^"]+)"/.exec(PLACARD_ART.CLASS_9.svg)?.[1] ?? "";
    // the top triangle, not the full diamond
    expect(clip.split(" ").length).toBe(3);
    const full = /<clipPath id="[^"]+"><polygon points="([^"]+)"/.exec(PLACARD_ART.FLAMMABLE_SOLID.svg)?.[1] ?? "";
    expect(full.split(" ").length).toBe(4);
  });

  it("fits every wording and class number inside the diamond", () => {
    for (const [name, art] of Object.entries(PLACARD_ART)) {
      for (const t of parseTexts(art.svg)) {
        const w = estimateTextWidth(t.content, t.size);
        const top = t.y - t.size * 0.72;
        const bottom = t.y + t.size * 0.14;
        for (const y of [top, bottom]) {
          expect(
            w / 2,
            `${name}: "${t.content}" at ${t.size}px overflows the diamond at y=${y.toFixed(1)}`,
          ).toBeLessThanOrEqual(diamondHalfWidthAt(y) - 4);
        }
        expect(insideDiamond(t.x, top), `${name}: "${t.content}" starts outside the diamond`).toBe(true);
        expect(insideDiamond(t.x, bottom), `${name}: "${t.content}" ends outside the diamond`).toBe(true);
      }
    }
  });

  it("shrinks long wordings rather than letting them overflow", () => {
    const short = parseTexts(PLACARD_ART.POISON.svg)[0]!;
    const long = parseTexts(PLACARD_ART.SPONTANEOUSLY_COMBUSTIBLE.svg)[0]!;
    expect(long.size).toBeLessThan(short.size);
  });

  it("meets the §172.519 minimum class-number height (41 mm ≈ 20.5 units of cap height)", () => {
    for (const [name, art] of Object.entries(PLACARD_ART)) {
      if (art.classNumber == null) continue;
      const numberText = parseTexts(art.svg).find((t) => t.content === art.classNumber);
      expect(numberText, `${name} lost its class number`).toBeDefined();
      expect(numberText!.size * 0.72, `${name} class number is under the §172.519 minimum`).toBeGreaterThanOrEqual(20.5);
    }
  });
});

describe("§172.332(c) identification number on the placard", () => {
  it("renders the number across the center and drops the wording", () => {
    const svg = renderPlacardWithIdNumber("CORROSIVE", "UN1789")!;
    expect(svg).toContain(">1789<");
    expect(svg, "the wording is replaced by the number band, per the §172.332(d) example").not.toContain(">CORROSIVE<");
    expect(svg, "the class number stays in the bottom corner").toContain(">8<");
  });

  it("strips the UN/NA prefix — the placard carries digits only", () => {
    expect(renderPlacardWithIdNumber("FLAMMABLE", "NA1993")).toContain(">1993<");
    expect(renderPlacardWithIdNumber("FLAMMABLE", "NA1993")).not.toContain("NA1993");
  });

  it("refuses the designs §172.334 bars, rather than drawing an unlawful placard", () => {
    expect(renderPlacardWithIdNumber("DANGEROUS", "1789")).toBeNull();
    expect(renderPlacardWithIdNumber("RADIOACTIVE", "2915")).toBeNull();
    for (const n of ["EXPLOSIVES_1_1", "EXPLOSIVES_1_4", "EXPLOSIVES_1_6"] as const) {
      expect(renderPlacardWithIdNumber(n, "0004")).toBeNull();
    }
    expect(PLACARD_ART.DANGEROUS.idNumberProhibited).toBe(true);
    expect(PLACARD_ART.CORROSIVE.idNumberProhibited).toBe(false);
  });

  it("refuses an id with no digits", () => {
    expect(renderPlacardWithIdNumber("CORROSIVE", "UN")).toBeNull();
    expect(renderPlacardWithIdNumber("CORROSIVE", "")).toBeNull();
  });
});
