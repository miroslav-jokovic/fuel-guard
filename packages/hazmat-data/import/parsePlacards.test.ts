import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePlacardTables } from "./parsePlacards.js";
import { placardSpecSchema, type PlacardSpec } from "../src/schema.js";

const XML = readFileSync(fileURLToPath(new URL("./fixtures/section-172-504.xml", import.meta.url)), "utf8");
const specs = parsePlacardTables(XML);
const find = (cat: string): PlacardSpec | undefined => specs.find((s) => s.classOrDivision === cat);

describe("parsePlacardTables — §172.504(e)", () => {
  it("parses the two tables into 8 (Table 1) + 15 (Table 2) specs", () => {
    expect(specs).toHaveLength(23);
    expect(specs.filter((s) => s.table === 1)).toHaveLength(8);
    expect(specs.filter((s) => s.table === 2)).toHaveLength(15);
    for (const s of specs) expect(() => placardSpecSchema.parse(s)).not.toThrow();
  });

  it("puts any-amount materials in Table 1 and 1,001-lb materials in Table 2", () => {
    expect(find("2.3")).toMatchObject({ table: 1, placardName: "POISON GAS", designRef: "172.540" });
    expect(find("4.3")).toMatchObject({ table: 1, placardName: "DANGEROUS WHEN WET" });
    expect(find("3")).toMatchObject({ table: 2, placardName: "FLAMMABLE", designRef: "172.542" });
    expect(find("8")).toMatchObject({ table: 2, placardName: "CORROSIVE" });
  });

  it("applies the fuel wording overlays (§172.542(c) GASOLINE, §172.544(c) FUEL OIL)", () => {
    expect(find("3")!.wordingOptions).toEqual(["GASOLINE"]);
    expect(find("Combustible liquid")).toMatchObject({ table: 2, placardName: "COMBUSTIBLE", wordingOptions: ["FUEL OIL"] });
  });

  it("strips the RADIOACTIVE footnote superscript and the CLASS 9 'see' cross-reference", () => {
    expect(find("7 (Radioactive Yellow III label only)")).toMatchObject({ table: 1, placardName: "RADIOACTIVE" });
    expect(find("9")).toMatchObject({ table: 2, placardName: "CLASS 9", designRef: "172.560" });
    for (const s of specs) expect(s.placardName).not.toMatch(/\(see/i);
  });

  it("represents 6.2 as NONE with no design ref", () => {
    expect(find("6.2")).toMatchObject({ table: 2, placardName: "NONE", designRef: null });
  });

  it("refuses a table set that lacks the safety-critical content signature", () => {
    expect(() => parsePlacardTables("<TABLE><TR><TD>a</TD><TD>b</TD><TD>c</TD></TR></TABLE>")).toThrow(
      /expected 2 .*tables/i,
    );
  });
});
