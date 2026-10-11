import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { workingCopyOf, workingSizeOf } from "./canonical.js";

describe("workingSizeOf", () => {
  it("gives the size sharp's resize produces, for portrait, landscape, square and small pages", async () => {
    // 2550×3300 is a Letter page at 300 DPI; 1670×2175 the office scans at ≈196 DPI; 3300×2550 a
    // /Rotate 90 page; 2000×1500 a Samsara photo; 1999×1001 an odd size that exercises the rounding.
    for (const [w, h] of [[2550, 3300], [1670, 2175], [3300, 2550], [2000, 1500], [1999, 1001], [1700, 1700], [1300, 1000]] as const) {
      const png = await sharp({ create: { width: w, height: h, channels: 3, background: "#fff" } }).png().toBuffer();
      const working = await workingCopyOf(png);
      expect(workingSizeOf(w, h), `${w}×${h}`).toEqual({ width: working.width, height: working.height });
    }
  });
});
