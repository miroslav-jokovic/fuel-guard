import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHmtSection } from "./parseHmt.js";
import { hmtEntrySchema, type HmtEntry } from "../src/schema.js";

/**
 * FROZEN parser fixture (Phase H1, deliverable 2). `fixtures/hmt-fuel-slice.xml` is a small,
 * REAL slice of the eCFR §172.101 "processed" XML (the two header rows + the fuel rows, verbatim,
 * from the captured section-172-101.xml, eCFR date 2026-07-28). The expected `HmtEntry` objects
 * below were HAND-VERIFIED cell-by-cell against the raw XML — this is the Source-A ground truth the
 * two-source diff (D5 v5) checks the human transcription against. If eCFR markup drifts, THIS test
 * is where it must break loudly, not the engine.
 */

const fixturePath = fileURLToPath(new URL("./fixtures/hmt-fuel-slice.xml", import.meta.url));
const SLICE_XML = readFileSync(fixturePath, "utf8");

// Hand-verified expected entries (13 canonical fuel entries; a UN/NA number is not unique, so each
// is keyed by its synthetic entryId). Covers every structural feature: plain names, 'or'-alternates,
// (c)(2) italic qualifiers, "see also" cross-references, Class-2 PG-null gases, multi-PG entries,
// "None" label codes, multi-value bulk refs, and "Forbidden" quantity limits.
const EXPECTED: Record<string, HmtEntry> = {
  "UN1203-gasoline": {
    entryId: "UN1203-gasoline",
    symbols: [],
    psnPrinted: "Gasoline",
    psnAlternates: [],
    italicText: "includes gasoline mixed with ethyl alcohol, with not more than 10% alcohol",
    hazardClass: "3",
    subsidiaryClasses: [],
    idPrefix: "UN",
    idNumber: "1203",
    pgRows: [
      {
        pg: "II",
        labelCodes: ["3"],
        specialProvisions: ["144", "177", "B1", "B33", "IB2", "T4"],
        exceptionsRef: "150",
        nonBulkPackagingRef: "202",
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "5 L", cargoAircraft: "60 L" },
        vesselStowage: { location: "E", other: [] },
      },
    ],
  },
  "UN1202-diesel-fuel": {
    entryId: "UN1202-diesel-fuel",
    symbols: ["I"],
    psnPrinted: "Diesel fuel",
    psnAlternates: [],
    italicText: null,
    hazardClass: "3",
    subsidiaryClasses: [],
    idPrefix: "UN",
    idNumber: "1202",
    pgRows: [
      {
        pg: "III",
        labelCodes: ["3"],
        specialProvisions: ["144", "B1", "IB3", "T2", "TP1"],
        exceptionsRef: "150",
        nonBulkPackagingRef: "203",
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "60 L", cargoAircraft: "220 L" },
        vesselStowage: { location: "A", other: [] },
      },
    ],
  },
  "NA1993-diesel-fuel": {
    entryId: "NA1993-diesel-fuel",
    symbols: ["D"],
    psnPrinted: "Diesel fuel",
    psnAlternates: [],
    italicText: null,
    hazardClass: "3",
    subsidiaryClasses: [],
    idPrefix: "NA",
    idNumber: "1993",
    pgRows: [
      {
        pg: "III",
        labelCodes: [],
        specialProvisions: ["144", "B1", "IB3", "T4", "TP1", "TP29"],
        exceptionsRef: "150",
        nonBulkPackagingRef: "203",
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "60 L", cargoAircraft: "220 L" },
        vesselStowage: { location: "A", other: [] },
      },
    ],
  },
  "NA1993-fuel-oil": {
    entryId: "NA1993-fuel-oil",
    symbols: ["D"],
    psnPrinted: "Fuel oil",
    psnAlternates: [],
    italicText: "(No. 1, 2, 4, 5, or 6)",
    hazardClass: "3",
    subsidiaryClasses: [],
    idPrefix: "NA",
    idNumber: "1993",
    pgRows: [
      {
        pg: "III",
        labelCodes: ["3"],
        specialProvisions: ["144", "B1", "IB3", "T4", "TP1", "TP29"],
        exceptionsRef: "150",
        nonBulkPackagingRef: "203",
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "60 L", cargoAircraft: "220 L" },
        vesselStowage: { location: "A", other: [] },
      },
    ],
  },
  "UN3475-ethanol-and-gasoline-mixture": {
    entryId: "UN3475-ethanol-and-gasoline-mixture",
    symbols: [],
    psnPrinted: "Ethanol and gasoline mixture",
    psnAlternates: ["Ethanol and motor spirit mixture", "Ethanol and petrol mixture"],
    italicText: "with more than 10% ethanol",
    hazardClass: "3",
    subsidiaryClasses: [],
    idPrefix: "UN",
    idNumber: "3475",
    pgRows: [
      {
        pg: "II",
        labelCodes: ["3"],
        specialProvisions: ["144", "177", "IB2", "T4", "TP1"],
        exceptionsRef: "150",
        nonBulkPackagingRef: "202",
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "5 L", cargoAircraft: "60 L" },
        vesselStowage: { location: "E", other: [] },
      },
    ],
  },
  "UN1170-ethanol": {
    entryId: "UN1170-ethanol",
    symbols: [],
    psnPrinted: "Ethanol",
    psnAlternates: ["Ethyl alcohol", "Ethanol solutions", "Ethyl alcohol solutions"],
    italicText: null,
    hazardClass: "3",
    subsidiaryClasses: [],
    idPrefix: "UN",
    idNumber: "1170",
    pgRows: [
      {
        pg: "II",
        labelCodes: ["3"],
        specialProvisions: ["24", "IB2", "T4", "TP1"],
        exceptionsRef: "4b, 150",
        nonBulkPackagingRef: "202",
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "5 L", cargoAircraft: "60 L" },
        vesselStowage: { location: "A", other: [] },
      },
      {
        pg: "III",
        labelCodes: ["3"],
        specialProvisions: ["24", "B1", "IB3", "T2", "TP1"],
        exceptionsRef: "4b, 150",
        nonBulkPackagingRef: "203",
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "60 L", cargoAircraft: "220 L" },
        vesselStowage: { location: "A", other: [] },
      },
    ],
  },
  "UN1987-alcohols-n-o-s": {
    entryId: "UN1987-alcohols-n-o-s",
    symbols: [],
    psnPrinted: "Alcohols, n.o.s.",
    psnAlternates: [],
    italicText: null,
    hazardClass: "3",
    subsidiaryClasses: [],
    idPrefix: "UN",
    idNumber: "1987",
    pgRows: [
      {
        pg: "I",
        labelCodes: ["3"],
        specialProvisions: ["172", "T11", "TP1", "TP8", "TP27"],
        exceptionsRef: "4b",
        nonBulkPackagingRef: "201",
        bulkPackagingRef: "243",
        quantityLimits: { passengerAircraftRail: "1 L", cargoAircraft: "30 L" },
        vesselStowage: { location: "E", other: [] },
      },
      {
        pg: "II",
        labelCodes: ["3"],
        specialProvisions: ["172", "IB2", "T7", "TP1", "TP8", "TP28"],
        exceptionsRef: "4b, 150",
        nonBulkPackagingRef: "202",
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "5 L", cargoAircraft: "60 L" },
        vesselStowage: { location: "B", other: [] },
      },
      {
        pg: "III",
        labelCodes: ["3"],
        specialProvisions: ["172", "B1", "IB3", "T4", "TP1", "TP29"],
        exceptionsRef: "4b, 150",
        nonBulkPackagingRef: "203",
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "60 L", cargoAircraft: "220 L" },
        vesselStowage: { location: "A", other: [] },
      },
    ],
  },
  "UN1863-fuel-aviation-turbine-engine": {
    entryId: "UN1863-fuel-aviation-turbine-engine",
    symbols: [],
    psnPrinted: "Fuel, aviation, turbine engine",
    psnAlternates: [],
    italicText: null,
    hazardClass: "3",
    subsidiaryClasses: [],
    idPrefix: "UN",
    idNumber: "1863",
    pgRows: [
      {
        pg: "I",
        labelCodes: ["3"],
        specialProvisions: ["144", "T11", "TP1", "TP8", "TP28"],
        exceptionsRef: "150",
        nonBulkPackagingRef: "201",
        bulkPackagingRef: "243",
        quantityLimits: { passengerAircraftRail: "1 L", cargoAircraft: "30 L" },
        vesselStowage: { location: "E", other: [] },
      },
      {
        pg: "II",
        labelCodes: ["3"],
        specialProvisions: ["144", "IB2", "T4", "TP1", "TP8"],
        exceptionsRef: "150",
        nonBulkPackagingRef: "202",
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "5 L", cargoAircraft: "60 L" },
        vesselStowage: { location: "B", other: [] },
      },
      {
        pg: "III",
        labelCodes: ["3"],
        specialProvisions: ["144", "B1", "IB3", "T2", "TP1"],
        exceptionsRef: "150",
        nonBulkPackagingRef: "203",
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "60 L", cargoAircraft: "220 L" },
        vesselStowage: { location: "A", other: [] },
      },
    ],
  },
  "UN1268-petroleum-distillates-n-o-s": {
    entryId: "UN1268-petroleum-distillates-n-o-s",
    symbols: [],
    psnPrinted: "Petroleum distillates, n.o.s.",
    psnAlternates: ["Petroleum products, n.o.s."],
    italicText: null,
    hazardClass: "3",
    subsidiaryClasses: [],
    idPrefix: "UN",
    idNumber: "1268",
    pgRows: [
      {
        pg: "I",
        labelCodes: ["3"],
        specialProvisions: ["144", "T11", "TP1", "TP8"],
        exceptionsRef: "150",
        nonBulkPackagingRef: "201",
        bulkPackagingRef: "243",
        quantityLimits: { passengerAircraftRail: "1 L", cargoAircraft: "30 L" },
        vesselStowage: { location: "E", other: [] },
      },
      {
        pg: "II",
        labelCodes: ["3"],
        specialProvisions: ["144", "IB2", "T7", "TP1", "TP8", "TP28"],
        exceptionsRef: "150",
        nonBulkPackagingRef: "202",
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "5 L", cargoAircraft: "60 L" },
        vesselStowage: { location: "B", other: [] },
      },
      {
        pg: "III",
        labelCodes: ["3"],
        specialProvisions: ["144", "B1", "IB3", "T4", "TP1", "TP29"],
        exceptionsRef: "150",
        nonBulkPackagingRef: "203",
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "60 L", cargoAircraft: "220 L" },
        vesselStowage: { location: "A", other: [] },
      },
    ],
  },
  "UN1223-kerosene": {
    entryId: "UN1223-kerosene",
    symbols: [],
    psnPrinted: "Kerosene",
    psnAlternates: [],
    italicText: null,
    hazardClass: "3",
    subsidiaryClasses: [],
    idPrefix: "UN",
    idNumber: "1223",
    pgRows: [
      {
        pg: "III",
        labelCodes: ["3"],
        specialProvisions: ["144", "B1", "IB3", "T2", "TP2"],
        exceptionsRef: "150",
        nonBulkPackagingRef: "203",
        bulkPackagingRef: "242",
        quantityLimits: { passengerAircraftRail: "60 L", cargoAircraft: "220 L" },
        vesselStowage: { location: "A", other: [] },
      },
    ],
  },
  "UN1075-petroleum-gases-liquefied": {
    entryId: "UN1075-petroleum-gases-liquefied",
    symbols: [],
    psnPrinted: "Petroleum gases, liquefied",
    psnAlternates: ["Liquefied petroleum gas"],
    italicText: null,
    hazardClass: "2.1",
    subsidiaryClasses: [],
    idPrefix: "UN",
    idNumber: "1075",
    pgRows: [
      {
        pg: null,
        labelCodes: ["2.1"],
        specialProvisions: ["T50", "N95"],
        exceptionsRef: "306",
        nonBulkPackagingRef: "304",
        bulkPackagingRef: "314, 315",
        quantityLimits: { passengerAircraftRail: "Forbidden", cargoAircraft: "150 kg" },
        vesselStowage: { location: "E", other: ["40"] },
      },
    ],
  },
  "UN1978-propane": {
    entryId: "UN1978-propane",
    symbols: [],
    psnPrinted: "Propane",
    psnAlternates: [],
    italicText: "see also Petroleum gases, liquefied",
    hazardClass: "2.1",
    subsidiaryClasses: [],
    idPrefix: "UN",
    idNumber: "1978",
    pgRows: [
      {
        pg: null,
        labelCodes: ["2.1"],
        specialProvisions: ["19", "T50", "N95"],
        exceptionsRef: "306",
        nonBulkPackagingRef: "304",
        bulkPackagingRef: "314, 315",
        quantityLimits: { passengerAircraftRail: "Forbidden", cargoAircraft: "150 kg" },
        vesselStowage: { location: "E", other: ["40"] },
      },
    ],
  },
  "UN3257-elevated-temperature-liquid-n-o-s": {
    entryId: "UN3257-elevated-temperature-liquid-n-o-s",
    symbols: ["G"],
    psnPrinted: "Elevated temperature liquid, n.o.s.",
    psnAlternates: [],
    italicText: "at or above 100 C and below its flash point (including molten metals, molten salts, etc.)",
    hazardClass: "9",
    subsidiaryClasses: [],
    idPrefix: "UN",
    idNumber: "3257",
    pgRows: [
      {
        pg: "III",
        labelCodes: ["9"],
        specialProvisions: ["IB1", "T3", "TP3", "TP29"],
        exceptionsRef: null,
        nonBulkPackagingRef: null,
        bulkPackagingRef: "247",
        quantityLimits: { passengerAircraftRail: "Forbidden", cargoAircraft: "Forbidden" },
        vesselStowage: { location: "A", other: ["85"] },
      },
    ],
  },
};

describe("parseHmtSection — §172.101 HMT parser (frozen fuel slice)", () => {
  const entries = parseHmtSection(SLICE_XML);
  const byId = new Map(entries.map((e) => [e.entryId, e]));

  it("parses the whole slice into the expected number of entries", () => {
    // 16 groups: UN1203, UN1202×3, NA1993×3, UN3475, UN1170, UN1987, UN1863, UN1268, UN1223, UN1075, UN1978, UN3257.
    expect(entries.length).toBe(16);
  });

  it("every parsed entry satisfies hmtEntrySchema and has ≥1 pgRow", () => {
    for (const e of entries) {
      expect(() => hmtEntrySchema.parse(e)).not.toThrow();
      expect(e.pgRows.length).toBeGreaterThanOrEqual(1);
      expect(["UN", "NA"]).toContain(e.idPrefix);
      for (const p of e.pgRows) expect([null, "I", "II", "III"]).toContain(p.pg);
    }
  });

  it("assigns unique synthetic entryIds (a UN number is not unique)", () => {
    const ids = entries.map((e) => e.entryId);
    expect(new Set(ids).size).toBe(ids.length);
    // UN1202 appears at three alphabetical positions; NA1993 at three in this slice.
    expect(entries.filter((e) => e.idNumber === "1202").length).toBe(3);
    expect(entries.filter((e) => e.idPrefix === "NA" && e.idNumber === "1993").length).toBe(3);
  });

  it.each(Object.keys(EXPECTED))("matches the hand-verified expected entry: %s", (entryId) => {
    const got = byId.get(entryId);
    expect(got, `entry ${entryId} missing from parse output`).toBeDefined();
    expect(got).toEqual(EXPECTED[entryId]);
  });

  it("keeps 'or'-alternate legal names as separate PSNs (§172.101(c)(10))", () => {
    expect(byId.get("UN1170-ethanol")!.psnAlternates).toEqual([
      "Ethyl alcohol",
      "Ethanol solutions",
      "Ethyl alcohol solutions",
    ]);
  });

  it("stores (c)(2) italic text separately and never in the PSN", () => {
    const gasoline = byId.get("UN1203-gasoline")!;
    expect(gasoline.psnPrinted).toBe("Gasoline");
    expect(gasoline.italicText).toContain("includes gasoline mixed with ethyl alcohol");
    // "see also" cross-reference: the roman referent after it is dropped from the name.
    expect(byId.get("UN1978-propane")!.psnPrinted).toBe("Propane");
  });

  it("uses pg=null for Class 2 gases (no packing group)", () => {
    expect(byId.get("UN1075-petroleum-gases-liquefied")!.pgRows[0]!.pg).toBeNull();
    expect(byId.get("UN1978-propane")!.pgRows[0]!.pg).toBeNull();
  });

  it("refuses to parse a table without the HMT header signature", () => {
    expect(() => parseHmtSection("<TABLE><TR><TD>x</TD></TABLE>")).toThrow(/header signature|no <TABLE>/i);
  });
});
