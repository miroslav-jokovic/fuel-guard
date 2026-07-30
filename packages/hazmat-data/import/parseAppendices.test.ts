import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHazSubstances, parseMarinePollutants, normalizeName } from "./parseAppendices.js";
import { hazSubstanceSchema, marinePollutantSchema } from "../src/schema.js";

const rd = (n: string): string => readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)), "utf8");
const haz = parseHazSubstances(rd("appendix-a-slice.xml"));
const mp = parseMarinePollutants(rd("appendix-b-slice.xml"));

describe("parseHazSubstances — Appendix A (RQ table)", () => {
  it("parses every slice row into a schema-valid HazSubstance", () => {
    expect(haz.length).toBe(9);
    for (const h of haz) expect(() => hazSubstanceSchema.parse(h)).not.toThrow();
  });

  it("splits 'lbs (kg)', including decimal kilograms", () => {
    expect(haz.find((h) => h.name === "Benzene")).toEqual({
      name: "Benzene",
      nameNormalized: "benzene",
      casNumber: null,
      rqPounds: 10,
      rqKg: 4.54,
    });
    expect(haz.find((h) => h.name === "Hexamethylphosphoramide")).toMatchObject({ rqPounds: 1, rqKg: 0.454 });
    expect(haz.find((h) => h.name === "Acetaldehyde")).toMatchObject({ rqPounds: 1000, rqKg: 454 });
  });

  it("inherits the parent RQ for an indented isomer sub-entry (blank RQ cell)", () => {
    // "iso-/sec-Amyl acetate" have blank RQ cells and take "Amyl acetate"'s 5000 (2270).
    expect(haz.find((h) => h.name === "Amyl acetate")).toMatchObject({ rqPounds: 5000, rqKg: 2270 });
    expect(haz.find((h) => h.name === "iso-Amyl acetate")).toMatchObject({ rqPounds: 5000, rqKg: 2270 });
    expect(haz.find((h) => h.name === "sec-Amyl acetate")).toMatchObject({ rqPounds: 5000, rqKg: 2270 });
  });

  it("normalizes names for matching", () => {
    expect(normalizeName("  Benzene, Chloro-  ")).toBe("benzene, chloro-");
  });
});

describe("parseMarinePollutants — Appendix B", () => {
  it("parses every slice row into a schema-valid MarinePollutant", () => {
    expect(mp.length).toBe(7);
    for (const m of mp) expect(() => marinePollutantSchema.parse(m)).not.toThrow();
  });

  it("reads the 'PP' column as the severe flag", () => {
    expect(mp.filter((m) => m.severe).map((m) => m.name)).toEqual([
      "Aldrin",
      "Chlordane",
      "Diphenylchloroarsine, solid or liquid",
      "Endrin",
    ]);
    expect(mp.find((m) => m.name === "Acetone cyanohydrin, stabilized")).toMatchObject({ severe: false });
    expect(mp.find((m) => m.name === "DNOC")).toMatchObject({ severe: false });
  });
});
