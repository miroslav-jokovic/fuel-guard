import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSegregationGrid } from "./parseSegregation.js";
import { segregationCellSchema, type SegregationCell } from "../src/schema.js";

const XML = readFileSync(fileURLToPath(new URL("./fixtures/section-177-848.xml", import.meta.url)), "utf8");
const cells = parseSegregationGrid(XML);
const at = (r: string, c: string): SegregationCell | undefined => cells.find((x) => x.rowClass === r && x.colClass === c);

describe("parseSegregationGrid — §177.848(d)", () => {
  it("parses the class×class grid into non-blank cells only, all schema-valid", () => {
    expect(cells.length).toBe(173);
    for (const c of cells) expect(() => segregationCellSchema.parse(c)).not.toThrow();
  });

  it("uses only the X / O / * grid values (no stray characters from the wrong table)", () => {
    expect([...new Set(cells.map((c) => c.value))].sort()).toEqual(["*", "O", "X"]);
  });

  it("covers the 18 canonical classes on both axes, including the two 2.3 zones", () => {
    const rowClasses = new Set(cells.map((c) => c.rowClass));
    const colClasses = new Set(cells.map((c) => c.colClass));
    expect(colClasses.has("2.3 gas zone A")).toBe(true);
    expect(colClasses.has("2.3 gas Zone B")).toBe(true);
    expect(colClasses.has("6.1 liquids PG I zone A")).toBe(true);
    expect(colClasses.has("8 liquids only")).toBe(true);
    // rows and columns describe the same class set
    expect([...rowClasses].sort()).toEqual([...colClasses].sort());
  });

  it("returns the known regulatory values for representative pairs", () => {
    expect(at("3", "5.1")?.value).toBe("O"); // flammable liquid ↔ oxidizer: keep apart
    expect(at("3", "1.1 1.2")?.value).toBe("X"); // flammable liquid ↔ mass-explosive: not together
    expect(at("5.1", "3")?.value).toBe("O"); // symmetric restriction present
  });

  it("refuses a non-segregation table (wrong header signature)", () => {
    const notGrid =
      "<TABLE><TR><TD>Compatibility group</TD><TD>A</TD></TR><TR><TD>A</TD><TD>X</TD></TR></TABLE>";
    expect(() => parseSegregationGrid(notGrid)).toThrow(/segregation grid|Class or division/i);
  });
});
