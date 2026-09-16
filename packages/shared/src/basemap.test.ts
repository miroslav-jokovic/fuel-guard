import { describe, it, expect } from "vitest";
import { BASEMAPS, BASEMAP_CHOICES, basemapFor, resolveBasemapStyle, resolveBasemapFormat } from "./basemap.js";

/**
 * The basemap allowlist (D-DR8).
 *
 * This file is small and it is the load-bearing half of the step: `apps/web` writes a style onto a
 * tile URL and `apps/api` decides whether to honour it, and the whole reason both read the same
 * module is that a disagreement between them is SILENT. The proxy falls back rather than erroring,
 * so a style the two ends spell differently produces a light map in dark mode and nothing in any log.
 */
describe("which basemap a map may ask for", () => {
  it("names the HERE basemaps the proxy will serve, each with its format", () => {
    expect(BASEMAPS).toEqual({
      map: { style: "explore.day", format: "jpeg" },
      mapNight: { style: "explore.night", format: "jpeg" },
      satellite: { style: "satellite.day", format: "jpeg" },
      terrain: { style: "topo.day", format: "jpeg" },
    });
  });

  /**
   * ⚠ The format assertion is the one that would have caught the defect worth catching, and D-DR22
   * widened it from satellite to every style. Measured with the production key: `satellite.day` is
   * 41 KB as jpeg against 488 KB as png, and the ROAD styles are 84–91% cheaper too — `explore.day`
   * 286 KB → 47 KB on a dense city tile, 269 KB → 29 KB at the national zoom. A basemap that quietly
   * reverted to png would look identical and cost 6–12× the bytes on the slowest part of the page,
   * which is precisely why a test and not an eye has to hold it.
   *
   * ⚠ Written as a loop over the table rather than four literals: the point is that NO basemap is
   * png, so a fifth one added in png should fail here rather than pass a list it was never added to.
   */
  it("serves every basemap as jpeg, because png pays lossless prices for a rendered photograph", () => {
    for (const [key, basemap] of Object.entries(BASEMAPS)) {
      expect(basemap.format, `${key} must be served as jpeg`).toBe("jpeg");
    }
  });

  it("moves only the road map with the reader's scheme", () => {
    expect(basemapFor("map", true)).toEqual(BASEMAPS.mapNight);
    expect(basemapFor("map", false)).toEqual(BASEMAPS.map);
    // ⚠ HERE publishes no `satellite.night` or `topo.night`, so these do NOT follow the scheme. A
    // satellite photograph of the earth at night is a picture of city lights, not a basemap.
    expect(basemapFor("satellite", true)).toEqual(BASEMAPS.satellite);
    expect(basemapFor("terrain", true)).toEqual(BASEMAPS.terrain);
  });

  /**
   * The night basemap must not appear as a fourth button. It is what `map` BECOMES in dark mode, and
   * offering it beside the others would put the colour scheme on screen twice and let the two
   * disagree — which is the toggle D-DR8 refused to build, arriving through a different door.
   */
  it("offers three choices and never the night map as one of them", () => {
    expect(BASEMAP_CHOICES.map((c) => c.key)).toEqual(["map", "satellite", "terrain"]);
    expect(BASEMAP_CHOICES.map((c) => c.key)).not.toContain("mapNight");
  });

  it("validates a format off the wire and falls back to png", () => {
    expect(resolveBasemapFormat("jpeg")).toBe("jpeg");
    expect(resolveBasemapFormat("png")).toBe("png");
    expect(resolveBasemapFormat("webp")).toBe("png");
    expect(resolveBasemapFormat(undefined)).toBe("png");
    expect(resolveBasemapFormat(["jpeg"])).toBe("png");
  });

  /**
   * ⚠ The fallback is the light basemap and NOT an error, and the test says so explicitly because
   * the neighbouring coordinate check in `mapProxies.ts` does the opposite. A bad coordinate is one
   * broken tile; a rejected style is every tile in the viewport at once, which reads as an outage
   * where a light map reads as a cosmetic defect.
   */
  it("falls back to the light basemap for anything not on the list", () => {
    // ⚠ `satellite.day` is now ON the list (Q-DR2 answered), so the rejected examples had to change
    // — a test asserting it is refused would now be asserting the opposite of the shipped behaviour.
    expect(resolveBasemapStyle("hybrid.day")).toBe("explore.day");
    expect(resolveBasemapStyle("lite.night")).toBe("explore.day");
    expect(resolveBasemapStyle("")).toBe("explore.day");
    expect(resolveBasemapStyle(undefined)).toBe("explore.day");
  });

  it("passes both listed styles through unchanged", () => {
    expect(resolveBasemapStyle("explore.day")).toBe("explore.day");
    expect(resolveBasemapStyle("explore.night")).toBe("explore.night");
    expect(resolveBasemapStyle("satellite.day")).toBe("satellite.day");
    expect(resolveBasemapStyle("topo.day")).toBe("topo.day");
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
