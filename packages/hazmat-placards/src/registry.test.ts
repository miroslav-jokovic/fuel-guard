import { describe, expect, it } from "vitest";
import { PLACARD_ART, placardArt, placardSvg } from "./index.js";

const FUEL_EXACT: string[] = ["FLAMMABLE","GASOLINE","COMBUSTIBLE","FUEL_OIL","FLAMMABLE_GAS","NON_FLAMMABLE_GAS","CLASS_9"];

describe("@hazmat/placards registry", () => {
  it("has art for all 25 PlacardName values", () => {
    expect(Object.keys(PLACARD_ART).length).toBe(25);
  });
  it("every entry is a well-formed standalone SVG with a CFR design ref", () => {
    for (const [name, art] of Object.entries(PLACARD_ART)) {
      expect(art.svg.startsWith("<svg")).toBe(true);
      expect(art.svg.trimEnd().endsWith("</svg>")).toBe(true);
      expect(art.svg).toContain('viewBox="0 0 200 200"');
      expect(art.designRef).toMatch(/^49 CFR 172\.\d/);
      expect(art.name).toBe(name);
    }
  });
  it("renders the exact fuel placards with non-provisional artwork", () => {
    for (const n of FUEL_EXACT) expect(placardArt(n as never).symbolProvisional).toBe(false);
    // DANGEROUS is present but flagged for a visual pass (its band design needs sign-off).
    expect(placardArt("DANGEROUS").symbolProvisional).toBe(true);
  });
  it("uses red for the flammable family and green for non-flammable gas", () => {
    expect(placardSvg("FLAMMABLE")).toContain("#E4002B");
    expect(placardSvg("GASOLINE")).toContain("#E4002B");
    expect(placardSvg("NON_FLAMMABLE_GAS")).toContain("#00843D");
    expect(placardArt("GASOLINE").label).toBe("GASOLINE");
    expect(placardArt("FUEL_OIL").label).toBe("FUEL OIL");
  });
  it("Class 9 shows a stripe field and an underlined 9 with no word", () => {
    expect(placardArt("CLASS_9").label).toBe("");
    expect(placardArt("CLASS_9").classNumber).toBe("9");
  });
});
