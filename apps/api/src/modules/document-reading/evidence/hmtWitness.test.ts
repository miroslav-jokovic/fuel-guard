import { describe, expect, it } from "vitest";
import { printedHazmatLineSchema, type PrintedHazmatLine } from "@silvicom/shared";
import { hmtVerdict } from "./hmtWitness.js";

/**
 * The table as a witness (§7B A2). The lines are the ones read LIVE from the ten office BOLs on
 * 2026-10-11 (§7B.2), with the values each model gave — so the test is the measurement, kept.
 */
const line = (over: Partial<PrintedHazmatLine>): PrintedHazmatLine => printedHazmatLineSchema.parse(over);

/** 0135071, Haiku 5.5: the shipper's product codes in the id column. */
export const PRODUCT_CODE_LINES = [
  line({ idText: "5607540", psn: "ENVIRONMENTALLY HAZARDOUS SUBSTANCE, SOLID, N.O.S.", hazardClass: "9", pg: "III" }),
  line({ idText: "5608714", psn: "ENVIRONMENTALLY HAZARDOUS SUBSTANCE, LIQUID, N.O.S.", hazardClass: "9", pg: "III" }),
  line({ idText: "5503610", psn: "PAINT", hazardClass: "3", pg: "III" }),
  line({ idText: "5348477", psn: "ENVIRONMENTALLY HAZARDOUS SUBSTANCE, SOLID, N.O.S.", hazardClass: "9", pg: "III" }),
  line({ idText: "5503615", psn: "PAINT", hazardClass: "3", pg: "II" }),
];
/** The same paper as Sonnet 4.6 and 5.5 read it, plus lines from the other papers — every one correct. */
export const CORRECT_LINES = [
  line({ idText: "UN3077", psn: "ENVIRONMENTALLY HAZARDOUS SUBSTANCE, SOLID, N.O.S.", hazardClass: "9", pg: "III" }),
  line({ idText: "UN3082", psn: "ENVIRONMENTALLY HAZARDOUS SUBSTANCE, LIQUID, N.O.S.", hazardClass: "9", pg: "III" }),
  line({ idText: "UN1263", psn: "PAINT", hazardClass: "3", pg: "II" }),
  line({ idText: "UN2735", psn: "Amines, liquid, corrosive, n.o.s.", hazardClass: "8", pg: "II" }),
  line({ idText: "UN2775", psn: null, hazardClass: "6.1", pg: "II" }),
  line({ idText: "UN2876", psn: null, hazardClass: "6.1", pg: "III" }),
  line({ idText: "UN1760", psn: null, hazardClass: "8", pg: "II" }),
];

describe("hmtVerdict", () => {
  it("refuses all five product codes Haiku 5.5 read as UN numbers on 0135071", () => {
    for (const l of PRODUCT_CODE_LINES) expect(hmtVerdict(l)).toMatchObject({ consistent: false });
  });

  it("finds every correctly read office line consistent, naming the table row", () => {
    for (const l of CORRECT_LINES) expect(hmtVerdict(l)).toMatchObject({ consistent: true, hmtRef: expect.stringMatching(/#/) });
  });

  it("refuses a real UN number with a class that contradicts it", () => {
    expect(hmtVerdict(line({ idText: "UN1263", psn: "PAINT", hazardClass: "8", pg: "II" }))).toEqual(
      expect.objectContaining({ consistent: false, reason: "class_mismatch" }));
  });

  it("finds diesel printed as Combustible liquid consistent, and still refuses the word on gasoline", () => {
    expect(hmtVerdict(line({ idText: "NA1993", psn: "Diesel fuel", hazardClass: "Combustible liquid", pg: "III" }))).toEqual(
      expect.objectContaining({ consistent: true, hmtRef: "NA1993-diesel-fuel#III" }));
    expect(hmtVerdict(line({ idText: "UN1203", psn: "Gasoline", hazardClass: "Combustible liquid", pg: "II" }))).toEqual(
      expect.objectContaining({ consistent: false, reason: "class_mismatch" }));
  });
});
