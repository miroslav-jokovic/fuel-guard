import { describe, expect, it } from "vitest";
import { footerPosition, visibleSize } from "./footer.js";

/**
 * The test does not restate the four cases — it re-derives them.
 *
 * `display()` is the transform a PDF viewer applies for `/Rotate`, written independently from the
 * function under test. Each assertion places a footer, pushes it through that transform, and checks
 * it landed at the visual bottom-left of the printed sheet. Getting both the function and this
 * transform wrong in the same direction is the only way a bad placement passes, and they are written
 * from opposite ends.
 */

/** Page-space point → where the viewer draws it, for a page rotated `angle` degrees clockwise. */
function display(
  angle: number,
  width: number,
  height: number,
  x: number,
  y: number,
): { x: number; y: number } {
  switch (((angle % 360) + 360) % 360) {
    case 90:
      return { x: y, y: width - x };
    case 180:
      return { x: width - x, y: height - y };
    case 270:
      return { x: height - y, y: x };
    default:
      return { x, y };
  }
}

const W = 612;
const H = 792;
const FROM_LEFT = 18;
const UP = 18;

describe("footerPosition", () => {
  for (const angle of [0, 90, 180, 270]) {
    it(`lands at the visual bottom-left of a page rotated ${angle}°`, () => {
      const p = footerPosition(angle, W, H, FROM_LEFT, UP);
      const seen = display(angle, W, H, p.x, p.y);
      expect(seen.x).toBeCloseTo(FROM_LEFT, 6);
      expect(seen.y).toBeCloseTo(UP, 6);
    });

    it(`advances to the viewer's right on a page rotated ${angle}°`, () => {
      // A run of text advances along its own rotation. One point along it must move the footer
      // RIGHT on the printed sheet and leave its height alone — otherwise the page number reads
      // upwards, or backwards, and nobody notices until it is printed.
      const p = footerPosition(angle, W, H, FROM_LEFT, UP);
      const rad = (p.rotate * Math.PI) / 180;
      const ahead = display(angle, W, H, p.x + Math.cos(rad), p.y + Math.sin(rad));
      const start = display(angle, W, H, p.x, p.y);
      expect(ahead.x - start.x).toBeCloseTo(1, 6);
      expect(ahead.y - start.y).toBeCloseTo(0, 6);
    });
  }

  it("treats a negative or over-turned angle as the equivalent quarter turn", () => {
    expect(footerPosition(-90, W, H, FROM_LEFT, UP)).toEqual(
      footerPosition(270, W, H, FROM_LEFT, UP),
    );
    expect(footerPosition(450, W, H, FROM_LEFT, UP)).toEqual(
      footerPosition(90, W, H, FROM_LEFT, UP),
    );
  });

  it("right-aligns to the visual right edge, which is the long edge on a turned page", () => {
    // This is what the page-number stamp does: measure the text, subtract from the visible width.
    const textWidth = 60;
    for (const angle of [0, 90, 180, 270]) {
      const visible = visibleSize(angle, W, H);
      const p = footerPosition(angle, W, H, visible.width - UP - textWidth, UP);
      const seen = display(angle, W, H, p.x, p.y);
      expect(seen.x).toBeCloseTo(visible.width - UP - textWidth, 6);
      expect(seen.x + textWidth).toBeLessThanOrEqual(visible.width);
    }
  });
});

describe("visibleSize", () => {
  it("swaps the sheet's dimensions only on a quarter turn", () => {
    expect(visibleSize(0, W, H)).toEqual({ width: W, height: H });
    expect(visibleSize(180, W, H)).toEqual({ width: W, height: H });
    expect(visibleSize(90, W, H)).toEqual({ width: H, height: W });
    expect(visibleSize(270, W, H)).toEqual({ width: H, height: W });
  });
});
