import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHmtSection } from "./parseHmt.js";
import {
  NOT_A_CHEMICAL,
  deriveNamesChemicalGroup,
  groupFlagDiffs,
  headWords,
  inGroupFlagScope,
  nameNamesChemicalGroup,
  withNamesChemicalGroup,
} from "./namesChemicalGroup.js";
import { hmtEntrySchema, parseDataset } from "../src/schema.js";
import { loadDataset } from "../src/index.js";

// Real rows: the committed §172.101 capture (eCFR 2026-07-28) that 2026.07.1 and 2026.08.0 were cut from.
const entries = parseHmtSection(readFileSync(new URL("./fixtures/section-172-101.xml", import.meta.url), "utf8"));
const row = (id: string, psn: string) => {
  const e = entries.find((x) => x.idNumber === id && x.psnPrinted === psn);
  if (!e) throw new Error(`fixture has no ${id} ${psn}`);
  return e;
};
const flag = (id: string, psn: string) => deriveNamesChemicalGroup(row(id, psn));

describe("namesChemicalGroup — §172.203(k)(2)(iii)/(iv), derived from the entry's own name", () => {
  it("'Flammable liquids, n.o.s.' (UN1993, G) names no chemical: every head word is a hazard or form word", () => {
    expect(row("1993", "Flammable liquids, n.o.s.").symbols).toContain("G");
    expect(headWords("Flammable liquids, n.o.s.")).toEqual(["flammable", "liquids"]);
    expect(flag("1993", "Flammable liquids, n.o.s.")).toBe(false);
  });

  it("'Alcohols, n.o.s.' (UN1987) names its group — and is not a G entry, so (k) never asks for a name", () => {
    expect(row("1987", "Alcohols, n.o.s.").symbols).not.toContain("G");
    expect(flag("1987", "Alcohols, n.o.s.")).toBe(true);
  });

  it("'Petroleum distillates, n.o.s.' (UN1268, not G) counts as naming its group: 'petroleum' is no hazard, form or use word", () => {
    expect(row("1268", "Petroleum distillates, n.o.s.").psnAlternates).toEqual(["Petroleum products, n.o.s."]);
    expect(flag("1268", "Petroleum distillates, n.o.s.")).toBe(true);
  });

  it("names an element or group: arsenic, isocyanates, organometallic", () => {
    expect(flag("1556", "Arsenic compounds, liquid, n.o.s.")).toBe(true);
    expect(entries.filter((e) => /^Isocyanates, /.test(e.psnPrinted)).map(deriveNamesChemicalGroup)).toEqual([true, true, true]);
    expect(entries.filter((e) => /^Organometallic substance/.test(e.psnPrinted)).every((e) => deriveNamesChemicalGroup(e) === true)).toBe(true);
  });

  it("names none: class names, a use (pesticide) and a generic noun (compounds)", () => {
    expect(flag("3101", "Organic peroxide type B, liquid")).toBe(false);
    expect(flag("2902", "Pesticides, liquid, toxic, n.o.s.")).toBe(false);
    expect(flag("1993", "Compounds, tree killing, liquid")).toBe(false);
    expect(flag("3082", "Environmentally hazardous substance, liquid, n.o.s.")).toBe(false);
    expect(flag("1760", "Corrosive liquids, n.o.s")).toBe(false);
  });

  it("an 'Articles containing …' head is the class wording it repeats, not a chemical", () => {
    const articles = entries.filter((e) => /^Articles containing/.test(e.psnPrinted));
    expect(articles.length).toBeGreaterThan(10);
    expect(articles.every((e) => deriveNamesChemicalGroup(e) === false)).toBe(true);
  });

  it("is true when ANY legal name names a group (UN1353 'Fibers' or '… nitrocellulose, n.o.s')", () => {
    const e = entries.find((x) => x.idNumber === "1353")!;
    expect([nameNamesChemicalGroup(e.psnPrinted), deriveNamesChemicalGroup(e)]).toEqual([false, true]);
  });

  it("leaves every entry outside G / n.o.s. without the field", () => {
    expect(flag("1203", "Gasoline")).toBeUndefined();
    expect(inGroupFlagScope(row("1203", "Gasoline"))).toBe(false);
    const out = withNamesChemicalGroup(entries);
    expect(out.find((e) => e.psnPrinted === "Gasoline")).not.toHaveProperty("namesChemicalGroup");
  });

  it("pins the whole table: 470 entries in scope, 125 flagged true; of 415 G entries, 82 true", () => {
    const out = withNamesChemicalGroup(entries);
    expect(out.filter((e) => e.namesChemicalGroup !== undefined)).toHaveLength(470);
    expect(out.filter((e) => e.namesChemicalGroup === true)).toHaveLength(125);
    const g = out.filter((e) => e.symbols.includes("G"));
    expect([g.length, g.filter((e) => e.namesChemicalGroup).length]).toEqual([415, 82]);
    for (const e of out) expect(() => hmtEntrySchema.parse(e)).not.toThrow();
  });

  it("every not-a-chemical word is used by some in-scope head of the current table (the vocabulary cannot rot)", () => {
    const used = new Set(entries.filter(inGroupFlagScope).flatMap((e) => [e.psnPrinted, ...e.psnAlternates].flatMap(headWords)));
    expect([...NOT_A_CHEMICAL].filter((w) => !used.has(w))).toEqual([]);
  });

  it("the two-source check reports a flag that differs between two parses of a row", () => {
    const a = row("1993", "Flammable liquids, n.o.s.");
    expect(groupFlagDiffs(a, a)).toEqual([]);
    expect(groupFlagDiffs(a, { ...a, psnPrinted: "Arsenic compounds, liquid, n.o.s." })).toEqual([{ field: "namesChemicalGroup", sourceA: false, sourceB: true }]);
  });

  it("is optional in the schema: datasets cut before it still load and keep their checksums", () => {
    for (const v of ["2026.07.1", "2026.08.0"]) {
      const ds = loadDataset(v);
      expect(ds.entries.some((e) => "namesChemicalGroup" in e)).toBe(false);
      expect(() => parseDataset(ds)).not.toThrow();
    }
  });
});
