import { describe, expect, it } from "vitest";
import { emptyShippingDocument } from "@silvicom/shared";
import { arithmeticWitness } from "./arithmeticWitness.js";

/**
 * The paper's totals as a witness (Q-DR26 L3). The numbers are the office BOLs' as read live under profile
 * 1.3.0 on 2026-10-15: 0134831 (two lines and its WEIGHT 36,446.7 beside PALLET WEIGHT 760 and TOTAL
 * 37,206.7), 0135071 (seven rows, 1,050 lb of pallets, a printed 41,677 that its own rows miss by a pound),
 * and 0136043 (NET 22,046, TARE 1,235, GROSS 23,281).
 */
type Row = { packageCount: number | null; grossWeightLb: number | null };
const row = (packageCount: number | null, grossWeightLb: number | null): Row => ({ packageCount, grossWeightLb });
const doc = (lines: Row[], freight: Partial<ReturnType<typeof emptyShippingDocument>["freight"]>, other: Row[] = []) => {
  const d = emptyShippingDocument();
  return { hazmat: { lines }, otherLines: other, freight: { ...d.freight, weightUnit: "lb" as const, ...freight } };
};
const W = (i: number) => `hazmat.lines[${i}].grossWeightLb`;
const C = (i: number) => `hazmat.lines[${i}].packageCount`;

const P0134831 = { weight: 37206.7, netWeight: 36446.7, tareWeight: 760, pieces: 99, pallets: 20 };
const L0134831 = [row(67, 30452.6), row(12, 5994.1)];
const AKZO = [row(179, 3560), row(121, 7421), row(77, 2080), row(72, 3620), row(182, 3806)];
const AKZO_OTHER = [row(178, 3659), row(23, 16480)];
const P0135071 = { weight: 41677, tareWeight: 1050, pieces: 832, pallets: 21 };

describe("arithmeticWitness — weights", () => {
  it("backs every row when the rows add up to a printed net", () => {
    const sums = arithmeticWitness(doc(L0134831, P0134831), doc(L0134831, P0134831));
    expect(sums.get(W(0))).toBe(30452.6);
    expect(sums.get(W(1))).toBe(5994.1);
  });

  it("gives a paper printing decimals a decimal's rounding, its whole-pound tare included", () => {
    // 0134831 prints PALLET WEIGHT "760.00"; the reader returns 760 — still a 0.05 lb place, not 0.5
    // 5,994.6 puts the rows 0.5 lb over the gross less tare: inside a whole pound's slack, outside 0.05 × 4
    const off = arithmeticWitness(doc([row(67, 30452.6), row(12, 5994.6)], { weight: 37206.7, tareWeight: 760 }), null);
    expect(off.has(W(1))).toBe(false);
    expect(arithmeticWitness(doc(L0134831, { weight: 37206.7, tareWeight: 760 }), null).get(W(1))).toBe(5994.1);
  });

  it("picks the one reading that makes the paper add up, when exactly one does", () => {
    const misread = [row(67, 30452.6), row(12, 5994.7)];
    const sums = arithmeticWitness(doc(misread, P0134831), doc(L0134831, P0134831));
    expect(sums.get(W(1))).toBe(5994.1);
    expect(sums.get(W(0))).toBe(30452.6);
  });

  it("picks nothing between two readings the paper's own rounding cannot tell apart", () => {
    // 0135071: rows + pallets = 41,676 against a printed 41,677; 3,808 gives 41,678 — both within rounding
    const misread = [...AKZO.slice(0, 4), row(182, 3808)];
    const sums = arithmeticWitness(doc(misread, P0135071, AKZO_OTHER), doc(AKZO, P0135071, AKZO_OTHER));
    expect(sums.has(W(4))).toBe(false);
    expect(sums.get(W(0))).toBe(3560);
    expect(sums.get("otherLines[1].grossWeightLb")).toBe(16480);
  });

  it("allows rounding of half a unit per printed term, and no more", () => {
    // 0135071's own pound: eight integer terms and the total
    expect(arithmeticWitness(doc(AKZO, P0135071, AKZO_OTHER), null).get(W(4))).toBe(3806);
    const off = { ...P0135071, weight: 41677 + 4 }; // 5 lb off: past nine half-pounds
    expect(arithmeticWitness(doc(AKZO, { ...off, netWeight: 40626 + 5, weight: null, tareWeight: null }, AKZO_OTHER), null).get(W(4))).toBeNull();
  });

  it("reads a gross as an upper bound: rows weighing less prove nothing, rows weighing more are wrong", () => {
    const lighter = arithmeticWitness(doc(L0134831, { weight: 37206.7 }), null);
    expect(lighter.size).toBe(0);
    const heavier = arithmeticWitness(doc([row(67, 30452.6), row(12, 7994.1)], { weight: 37206.7 }), null);
    expect(heavier.get(W(0))).toBeNull();
    expect(heavier.get(W(1))).toBeNull();
  });

  it("holds the rows to a printed net in both directions", () => {
    const lighter = arithmeticWitness(doc([row(67, 30452.6), row(12, 4994.1)], P0134831), null);
    expect(lighter.get(W(1))).toBeNull();
  });

  it("closes on the gross less the printed tare", () => {
    const sums = arithmeticWitness(doc(L0134831, { weight: 37206.7, tareWeight: 760 }), null);
    expect(sums.get(W(0))).toBe(30452.6);
  });

  it("picks only on totals both readers read, and flags only rows that fit neither reader's totals", () => {
    // 0135071 live: pass A read no tare, pass B 1,050 — the gross alone does not close, and no row is flagged
    const sums = arithmeticWitness(doc(AKZO, { ...P0135071, tareWeight: null }, AKZO_OTHER), doc(AKZO, P0135071, AKZO_OTHER));
    expect([...sums.keys()].filter((k) => k.endsWith("grossWeightLb"))).toEqual([]);
    const heavy = [...AKZO.slice(0, 4), row(182, 9806)]; // 26,487 lb of rows
    expect(arithmeticWitness(doc(heavy, { weight: 20000 }), doc(heavy, { weight: 20001 })).get(W(4))).toBeNull();
    const either = arithmeticWitness(doc(heavy, { weight: 20000 }), doc(heavy, { weight: 30000 }));
    expect([...either.keys()].filter((k) => k.endsWith("grossWeightLb"))).toEqual([]);
    // a net only one reader read: the other's gross alone still holds the rows under it
    const net = arithmeticWitness(doc(L0134831, { weight: 37206.7, netWeight: 30000 }), doc(L0134831, { weight: 37206.7 }));
    expect([...net.keys()].filter((k) => k.endsWith("grossWeightLb"))).toEqual([]);
  });

  it("adds the non-hazmat rows in: a mixed paper's total is all its rows", () => {
    const sums = arithmeticWitness(doc([row(10, 2000)], { netWeight: 22046 }, [row(10, 20046)]), null);
    expect(sums.get(W(0))).toBe(2000);
    expect(sums.get("otherLines[0].grossWeightLb")).toBe(20046);
  });

  it("decides whether a row only one reader saw is on the paper", () => {
    const extra = [...L0134831, row(5, 500)];
    const sums = arithmeticWitness(doc(extra, P0134831), doc([...L0134831, null as never], P0134831));
    expect(sums.get(W(2))).toBeNull();
    expect(sums.get(W(0))).toBe(30452.6);
  });

  it("says nothing when a row is loaded but has no weight, the total is in kilograms, or nothing is printed", () => {
    const weights = (m: Map<string, unknown>) => [...m.keys()].filter((k) => k.endsWith("grossWeightLb"));
    expect(weights(arithmeticWitness(doc([row(67, null), row(12, 5994.1)], P0134831), null))).toEqual([]);
    expect(weights(arithmeticWitness(doc(L0134831, { ...P0134831, weightUnit: "kg" }), null))).toEqual([]);
    expect(arithmeticWitness(doc(L0134831, {}), null).size).toBe(0);
  });

  it("backs nothing on a one-line paper, whose total is that line, and still flags one that cannot fit", () => {
    // 0135006: 8 fiber drums, 650 lb, nothing else on the paper
    const one = arithmeticWitness(doc([row(8, 650)], { weight: 650, pieces: 8 }), doc([row(8, 650)], { weight: 650, pieces: 8 }));
    expect(one.size).toBe(0);
    const heavy = arithmeticWitness(doc([row(8, 6500)], { netWeight: 650 }), null);
    expect(heavy.get(W(0))).toBeNull();
    // a template row beside it does not make a second row
    expect(arithmeticWitness(doc([row(8, 650), row(null, null)], { weight: 650 }), null).size).toBe(0);
  });

  it("leaves a dormant template row out of the sum", () => {
    const sums = arithmeticWitness(doc([...L0134831, row(null, null)], P0134831), null);
    expect(sums.get(W(0))).toBe(30452.6);
    expect(sums.has(W(2))).toBe(false);
  });

  it("refuses to enumerate past ten rows in dispute", () => {
    const a = Array.from({ length: 11 }, (_, i) => row(1, 100 + i));
    const b = Array.from({ length: 11 }, (_, i) => row(1, 200 + i));
    expect(arithmeticWitness(doc(a, { netWeight: 1155 }), doc(b, { netWeight: 1155 })).size).toBe(0);
  });
});

describe("arithmeticWitness — counts", () => {
  it("backs counts that add up to the pieces, or to the pieces less the pallets", () => {
    const sums = arithmeticWitness(doc(L0134831, P0134831), null); // 67 + 12 = 99 − 20
    expect(sums.get(C(0))).toBe(67);
    const akzo = arithmeticWitness(doc(AKZO, P0135071, AKZO_OTHER), null); // 832 = the rows
    expect(akzo.get(C(4))).toBe(182);
  });

  it("picks the count that adds up, and never flags counts that add up to nothing", () => {
    const sums = arithmeticWitness(doc([row(9, 30452.6), row(12, 5994.1)], P0134831), doc([row(67, 30452.6), row(12, 5994.1)], P0134831));
    expect(sums.get(C(0))).toBe(67);
    const nothing = arithmeticWitness(doc(L0134831, { pieces: 15 }), null);
    expect([...nothing.keys()].filter((k) => k.endsWith("packageCount"))).toEqual([]);
  });
});
