import { describe, expect, it } from "vitest";
import { loadDataset } from "@hazmat/data";
import { declaresLimitedQuantity } from "@hazmat/engine";
import { PRINTED_PACKAGE_WORDS, packageTypeFromPrinted, readingsAgree, regulatedTokens } from "@silvicom/shared";

/**
 * `readingsAgree` on a free-text cell two readers transcribed to different extents (READER-CORRECTNESS-PLAN
 * R-M2, readingExtent.ts), over every entry of the shipped table (D-RC1), both halves:
 *   - a reading that stops at the basic description agrees with one that carries the cell's commercial
 *     tail or item-code line — production read 350d2f27, Mayo Products BOL 14182, is the case;
 *   - a reading that stops short of ANY regulated element never does: every word-boundary prefix of the
 *     basic description, and every tail that adds an RQ, a Limited Quantity, a Marine Pollutant, a
 *     technical name, an inhalation hazard, HOT, a waste, a class or a packing group.
 * Shared has no node types, so this lives with the other agreement property tests in the API.
 */
const { entries } = loadDataset();
const DESC = "hazmat.lines[0].descriptionText";
const PACK = "hazmat.lines[0].packaging";
const MARKS = "hazmat.lines[0].marks";

/** Every legal basic description in the table: id, name, class with subsidiaries, PG — one per PG row. */
const DESCRIPTIONS = [...new Set(entries.filter((e) => e.hazardClass && !/forbidden/i.test(e.hazardClass)).flatMap((e) => {
  const cls = `${e.hazardClass}${e.subsidiaryClasses?.length ? ` (${e.subsidiaryClasses.join(", ")})` : ""}`;
  const pgs = (e.pgRows ?? []).map((r: { pg: string | null }) => r.pg);
  return (pgs.length ? pgs : [null]).map((pg: string | null) => `${e.idPrefix}${e.idNumber}, ${e.psnPrinted}, ${cls}${pg ? `, PG${pg}` : ""}`);
}))];

/** What a shipper prints after the description that is no part of it — the Mayo paper's own first. */
const COMMERCIAL = [", CAUSTIC SODA 50% 3600# TOTE", ", SULFURIC ACID 93% 3250# TOTE", " ITEM 40021-B", ", PO 4500498026", "; LOT 22-1187"];
/** Every regulated element a tail could carry — the reading that stops before it is not the same reading. */
const REGULATED_TAILS = [
  ", RQ", ", RQ (SODIUM HYDROXIDE)", ", LTD QTY", ", Limited Quantity", ", LTD. QTY.", ", MARINE POLLUTANT", " (XYLENE)",
  ", POISON INHALATION HAZARD", ", ZONE B", ", HOT", ", WASTE", ", RESIDUE", ", 8", ", 2.1", ", PG II", ", III",
  ", DOT-SP 20155", ", EX2009120056", ", CONTAINS TOLUENE", ", N.O.S.", ", UN1993", ", EXCEPTED QUANTITY",
  ", CARGO AIRCRAFT ONLY", ", RADIOACTIVE MATERIAL, TYPE A", ", 1.2 TBq", ", TI 0.5", ", ELEVATED TEMPERATURE",
  ", STABILIZED", ", CLASS 8", ", FLAMMABLE LIQUID",
];
const PACKAGES = ["8 3600LBTOTE", "2 DRUMS", "12 STEEL DRUMS", "1 IBC", "40 BAGS", "6 CYL"];

describe("readingsAgree on cell extent, over every table entry", () => {
  it("covers the table", () => expect(DESCRIPTIONS.length).toBeGreaterThan(2500));

  it("a reading that stops at the basic description agrees with one that carries a commercial tail", () => {
    const split: string[] = [];
    for (const d of DESCRIPTIONS) for (const t of COMMERCIAL) {
      if (!readingsAgree(DESC, d, d + t)) split.push(`${d} | ${t}`);
      if (!readingsAgree(DESC, (d + t).replace(/, (?=[^,]*$)/, "\n"), d)) split.push(`(line break) ${d} | ${t}`);
    }
    expect(split.slice(0, 10)).toEqual([]);
  });

  it("never agrees when the longer reading adds a regulated element", () => {
    const joined: string[] = [];
    for (const d of DESCRIPTIONS) for (const t of REGULATED_TAILS) {
      if (readingsAgree(DESC, d, d + t)) joined.push(`${d} | ${t}`);
      if (readingsAgree(DESC, d, `${d}${COMMERCIAL[0]}${t}`)) joined.push(`${d} | commercial then ${t}`);
    }
    expect(joined.slice(0, 10)).toEqual([]);
  });

  it("never agrees with a reading that stops inside the basic description", () => {
    const joined: string[] = [];
    for (const d of DESCRIPTIONS) {
      for (const m of d.matchAll(/,? /g)) {
        const short = d.slice(0, m.index);
        if (short && readingsAgree(DESC, short, d)) joined.push(`${JSON.stringify(short)} ⊂ ${d}`);
      }
    }
    expect(joined.slice(0, 10)).toEqual([]);
  });

  it("never agrees at a boundary that is not a field boundary, nor with an empty reading", () => {
    expect(readingsAgree(DESC, "UN1824, SODIUM HYDROXIDE, SOLUTION 8, PGII", "UN1824, SODIUM HYDROXIDE, SOLUTION 8, PGIIX")).toBe(false);
    expect(readingsAgree(DESC, "", "CAUSTIC SODA")).toBe(false);
    expect(readingsAgree(DESC, null, "UN1824")).toBe(false);
  });

  it("packaging: an item-code line agrees; another count, another type or a regulated tail does not", () => {
    for (const p of PACKAGES) {
      expect(readingsAgree(PACK, p, `${p} FG00035-3600T`)).toBe(true);
      expect(readingsAgree(PACK, p, `${p}\nFG00035-3600T`)).toBe(true);
      expect(readingsAgree(PACK, p, `${p} TOTE`)).toBe(packageTypeFromPrinted(p) === "ibc_tote");
      expect(readingsAgree(PACK, p, `${p} LTD QTY`)).toBe(false);
      expect(readingsAgree(PACK, p, `1${p}`)).toBe(false);
    }
  });

  it("packaging: a reading without the count agrees past the other's count, for every package word of the table", () => {
    const wrong: string[] = [];
    const words = PRINTED_PACKAGE_WORDS.flatMap(({ words: w, codes }) => [...w, ...codes].map((x) => x.replace(/s\?$/, "").toUpperCase()));
    for (const w of words) for (const cell of [w, `3600LB${w}`, `STEEL ${w}`]) for (const n of [1, 8, 12]) {
      const counted = `${n} ${cell}`;
      if (!packageTypeFromPrinted(cell)) continue;
      for (const [x, y] of [[cell, counted], [cell, `${counted} FG00035-3600T`], [`${cell} FG00035-3600T`, counted]]) {
        if (!readingsAgree(PACK, x, y) || !readingsAgree(PACK, y, x)) wrong.push(`split: ${x} | ${y}`);
      }
      for (const t of REGULATED_TAILS) if (readingsAgree(PACK, `${cell}${t}`, counted) || readingsAgree(PACK, cell, `${counted}${t}`)) wrong.push(`joined: ${cell} | ${counted}${t}`);
      if (readingsAgree(PACK, `${n + 1} ${cell}`, counted)) wrong.push(`joined other count: ${counted}`);
    }
    // Another type past the count, or a count-less reading that leads with a number of its own, never agrees.
    for (const [x, y] of [["DRUMS", "8 TOTES"], ["TOTES", "8 DRUMS"], ["3600 LB TOTE", "8 3600 LB TOTE"], ["TOTE", "8 3600LBTOTE"], ["", "8 TOTES"]]) {
      if (readingsAgree(PACK, x, y)) wrong.push(`joined: ${x} | ${y}`);
    }
    expect(wrong.slice(0, 10)).toEqual([]);
    expect(readingsAgree(PACK, "3600LBTOTE", "8 3600LBTOTE FG00035-3600T")).toBe(true);
  });

  it("marks: an extra mark with no regulated token agrees; an extra regulated mark never does", () => {
    expect(readingsAgree(MARKS, [], ["CAUSTIC SODA 50% 3600# TOTE"])).toBe(true);
    for (const t of REGULATED_TAILS) expect(readingsAgree(MARKS, [], [t.replace(/^[,;]? ?/, "")]), t).toBe(false);
    expect(readingsAgree(MARKS, ["RQ"], ["CAUSTIC SODA 50% 3600# TOTE"])).toBe(false);
  });

  it("the extent rule is for its three cells only: any other field compares as text", () => {
    expect(readingsAgree("hazmat.lines[0].psn", "SODIUM HYDROXIDE", "SODIUM HYDROXIDE, SOLUTION")).toBe(false);
    expect(readingsAgree("parties.consignee.name", "Indorama LLC", "Indorama LLC DALLAS")).toBe(false);
    expect(readingsAgree(undefined, "8 3600LBTOTE", "8 3600LBTOTE FG00035-3600T")).toBe(false);
  });

  it("holds every spelling the engine reads as Limited Quantity inside the regulated list", () => {
    const spellings = ["Limited Quantity", "LIMITED QUANTITY", "Ltd Qty", "LTD. QTY.", "ltd qty", "Ltd.Qty", "LTDQTY"];
    for (const s of spellings) {
      if (declaresLimitedQuantity({ marks: [s], psn: null, packaging: null })) expect(regulatedTokens(s), s).not.toEqual([]);
    }
  });
});
