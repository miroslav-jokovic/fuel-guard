import { describe, expect, it } from "vitest";
import { parseErgIdIndex, verifyErg, guidePage, ERG_FUEL_IDS } from "./erg.js";
import type { ErgEntry } from "../src/schema.js";

/**
 * FIXTURE — a verbatim slice of `pdftotext -layout` output from ERG2024-Eng-Web-a.pdf (the yellow
 * ID Number Index). It exercises every real quirk: two physical columns, a `— —` no-ID row, a
 * wrapped name continuation, a "P" polymerization guide, alternate-name duplicates, and a
 * multi-guide ID (1057 → 115 and 128).
 */
const FIXTURE = [
  "ID Guide       Name of Material              ID Guide       Name of Material",
  "No. No.                                      No. No.",
  "",
  "— — 112    Ammonium nitrate-fuel oil         1022 126   Chlorotrifluoromethane",
  "             mixtures",
  "                                             1022 126   Refrigerant gas R-13",
  "— — 112    Blasting agent, n.o.s.",
  "                                             1023 119   Coal gas, compressed",
  "1001 116   Acetylene, dissolved              1028 126   Dichlorodifluoromethane",
  "1003 122   Air, refrigerated liquid          1028 126   Refrigerant gas R-12",
  "              (cryogenic liquid)",
  "1005 125   Ammonia, anhydrous                1030 115   1,1-Difluoroethane",
  "1005 125   Anhydrous ammonia",
  "1010 116P Butadienes, stabilized             1075 115    Propylene",
  "1057 115   Lighter refills containing",
  "1057 128   Lighters, non-pressurized",
].join("\n");

const EXPECTED: ErgEntry[] = [
  { idNumber: "1001", guideNumber: "116" },
  { idNumber: "1003", guideNumber: "122" },
  { idNumber: "1005", guideNumber: "125" },
  { idNumber: "1010", guideNumber: "116P" },
  { idNumber: "1022", guideNumber: "126" },
  { idNumber: "1023", guideNumber: "119" },
  { idNumber: "1028", guideNumber: "126" },
  { idNumber: "1030", guideNumber: "115" },
  { idNumber: "1057", guideNumber: "115" },
  { idNumber: "1057", guideNumber: "128" },
  { idNumber: "1075", guideNumber: "115" },
];

describe("parseErgIdIndex", () => {
  it("parses the real two-column index slice exactly", () => {
    expect(parseErgIdIndex(FIXTURE)).toEqual(EXPECTED);
  });

  it("skips '— —' no-ID rows (Ammonium nitrate-fuel oil / Blasting agent absent)", () => {
    const ids = parseErgIdIndex(FIXTURE).map((e) => e.idNumber);
    expect(ids).not.toContain("112");
  });

  it("keeps the polymerization 'P' faithfully; guidePage strips it", () => {
    const butadienes = parseErgIdIndex(FIXTURE).find((e) => e.idNumber === "1010")!;
    expect(butadienes.guideNumber).toBe("116P");
    expect(guidePage(butadienes)).toBe("116");
  });

  it("collapses alternate names but keeps genuine multi-guide IDs", () => {
    const rows = parseErgIdIndex(FIXTURE);
    expect(rows.filter((e) => e.idNumber === "1005")).toHaveLength(1); // alt names → one
    expect(rows.filter((e) => e.idNumber === "1057")).toHaveLength(2); // 115 + 128 → two
  });
});

describe("verifyErg", () => {
  it("reports missing fuel IDs and multi-guide IDs", () => {
    const v = verifyErg(EXPECTED);
    // The fixture only contains 1075 of the fuel set → the rest are 'missing' here (by design).
    expect(v.missingFuelIds).not.toContain("1075");
    expect(v.missingFuelIds.length).toBe(ERG_FUEL_IDS.length - 1);
    expect(v.multiGuide["1057"]).toEqual(["115", "128"]);
  });

  it("passes cleanly when every fuel ID is present", () => {
    const withAllFuel: ErgEntry[] = ERG_FUEL_IDS.map((id) => ({ idNumber: id, guideNumber: "128" }));
    const v = verifyErg(withAllFuel);
    expect(v.ok).toBe(true);
    expect(v.missingFuelIds).toEqual([]);
  });
});
