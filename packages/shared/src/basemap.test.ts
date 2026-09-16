import { describe, it, expect } from "vitest";
import { BASEMAP_STYLES, basemapStyleFor, resolveBasemapStyle } from "./basemap.js";

/**
 * The basemap allowlist (D-DR8).
 *
 * This file is small and it is the load-bearing half of the step: `apps/web` writes a style onto a
 * tile URL and `apps/api` decides whether to honour it, and the whole reason both read the same
 * module is that a disagreement between them is SILENT. The proxy falls back rather than erroring,
 * so a style the two ends spell differently produces a light map in dark mode and nothing in any log.
 */
describe("which basemap a map may ask for", () => {
  it("names the two HERE styles the proxy will serve", () => {
    expect(BASEMAP_STYLES).toEqual({ light: "explore.day", dark: "explore.night" });
  });

  it("derives the style from the reader's resolved scheme", () => {
    expect(basemapStyleFor(true)).toBe("explore.night");
    expect(basemapStyleFor(false)).toBe("explore.day");
  });

  /**
   * ⚠ The fallback is the light basemap and NOT an error, and the test says so explicitly because
   * the neighbouring coordinate check in `mapProxies.ts` does the opposite. A bad coordinate is one
   * broken tile; a rejected style is every tile in the viewport at once, which reads as an outage
   * where a light map reads as a cosmetic defect.
   */
  it("falls back to the light basemap for anything not on the list", () => {
    expect(resolveBasemapStyle("satellite.day")).toBe("explore.day");
    expect(resolveBasemapStyle("lite.night")).toBe("explore.day");
    expect(resolveBasemapStyle("")).toBe("explore.day");
    expect(resolveBasemapStyle(undefined)).toBe("explore.day");
  });

  it("passes both listed styles through unchanged", () => {
    expect(resolveBasemapStyle("explore.day")).toBe("explore.day");
    expect(resolveBasemapStyle("explore.night")).toBe("explore.night");
  });

  /**
   * ⚠ `req.query.style` is an ARRAY when the parameter is repeated, which is why the signature takes
   * `unknown` rather than `string | undefined`. Without this case a `?style=explore.night&style=x`
   * request reaches `values.includes(rawArray)`, which is false — so the behaviour happens to be
   * right, and would stop being right the moment somebody "tidied" the signature to a string and
   * added a `.toString()` to make it compile. Pinned so that edit fails here.
   */
  it("refuses a repeated parameter rather than trusting either copy", () => {
    expect(resolveBasemapStyle(["explore.night", "explore.day"])).toBe("explore.day");
    expect(resolveBasemapStyle(["explore.night"])).toBe("explore.day");
    expect(resolveBasemapStyle({ toString: () => "explore.night" })).toBe("explore.day");
  });
});
