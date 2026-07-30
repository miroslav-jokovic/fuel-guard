import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseHmtGovInfoSection } from "./parseHmtGovInfo.js";

const XML = readFileSync(new URL("./fixtures/govinfo/hmt-172-101.xml", import.meta.url), "utf8");
const entries = parseHmtGovInfoSection(XML);
const byId = (id: string) => entries.filter((e) => e.idNumber === id);
const find = (prefix: string, id: string, psn: string) =>
  entries.find((e) => e.idPrefix === prefix && e.idNumber === id && e.psnPrinted === psn);

describe("parseHmtGovInfoSection — official GovInfo GPO §172.101 parse", () => {
  it("parses the whole table into the same count as the eCFR parser (2479)", () => {
    expect(entries.length).toBe(2479);
  });

  it("parses Gasoline UN1203 as Class 3, PG II with the ethanol qualifier as italic (c)(2) text", () => {
    const g = find("UN", "1203", "Gasoline");
    expect(g).toBeTruthy();
    expect(g!.hazardClass).toBe("3");
    expect(g!.pgRows.map((p) => p.pg)).toEqual(["II"]);
    expect(g!.italicText).toMatch(/ethyl alcohol|10% alcohol/i);
    // §173.150 non-bulk (202) / §173.242 bulk (242) — the bulk ref the fleet uses.
    expect(g!.pgRows[0]!.bulkPackagingRef).toBe("242");
  });

  it("flattens a multi-PG entry (UN1268 Petroleum distillates) into I/II/III with the 'or'-alternate name", () => {
    const p = find("UN", "1268", "Petroleum distillates, n.o.s.");
    expect(p).toBeTruthy();
    expect(p!.pgRows.map((r) => r.pg)).toEqual(["I", "II", "III"]);
    expect(p!.psnAlternates).toContain("Petroleum products, n.o.s.");
  });

  it("parses a Class 2 gas (UN1075 LPG) with no packing group and its 'or'-alternate", () => {
    const lpg = find("UN", "1075", "Petroleum gases, liquefied");
    expect(lpg).toBeTruthy();
    expect(lpg!.hazardClass).toBe("2.1");
    expect(lpg!.pgRows.map((r) => r.pg)).toEqual([null]);
    expect(lpg!.psnAlternates).toContain("Liquefied petroleum gas");
  });

  it("keeps the three distinct UN1202 alphabetical entries (Diesel fuel / Gas oil / Heating oil, light)", () => {
    const names = byId("1202").map((e) => e.psnPrinted).sort();
    expect(names).toEqual(["Diesel fuel", "Gas oil", "Heating oil, light"]);
  });

  it("drops ID-less 'see' cross-reference rows (e.g. 'Gasoline, casinghead, see Gasoline')", () => {
    expect(entries.some((e) => /casinghead/i.test(e.psnPrinted))).toBe(false);
  });

  it("refuses XML with no HMT GPOTABLE (header-signature guard)", () => {
    expect(() => parseHmtGovInfoSection("<CFRGRANULE><SECTION></SECTION></CFRGRANULE>")).toThrow(/header signature/i);
  });
});
