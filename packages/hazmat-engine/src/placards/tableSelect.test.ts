import { describe, expect, it } from "vitest";
import { pihRestsOnAbsence, selectPlacardRow, type TableSelectEntry } from "./tableSelect.js";

/**
 * F-P1. Divisions 6.1 and 5.2 sit in BOTH §172.504 tables, separated only by a qualifier the class
 * number does not carry. Matching on the leading numeric token found two rows, gave up, and withheld
 * the determination — so every Class 6.1 material in the Hazardous Materials Table (534 of 2,479
 * entries, the largest class in it) has never produced a placard, despite D4 listing non-PIH 6.1 as
 * in scope.
 *
 * The direction of each decision matters more than the decision: a PIH material called non-PIH is
 * under-placarded, which is the single error the engine exists to prevent (D2). So every rule here
 * either asserts PIH from evidence, or refuses.
 */

const TABLE_1_61 = { classOrDivision: "6.1 (material poisonous by inhalation (see § 171.8 of this subchapter))", table: 1 as const };
const TABLE_2_61 = { classOrDivision: "6.1 (other than material poisonous by inhalation)", table: 2 as const };
const BOTH_61 = [TABLE_1_61, TABLE_2_61];

const TABLE_1_52 = { classOrDivision: "5.2 (Organic peroxide, Type B, liquid or solid, temperature controlled)", table: 1 as const };
const TABLE_2_52 = { classOrDivision: "5.2 (Other than organic peroxide, Type B, liquid or solid, temperature controlled)", table: 2 as const };
const BOTH_52 = [TABLE_1_52, TABLE_2_52];

const entry = (psn: string, sps: string[] = []): TableSelectEntry => ({
  psnPrinted: psn,
  hazardClass: "6.1",
  pgRows: [{ specialProvisions: sps }],
});

describe("selectPlacardRow — Division 6.1", () => {
  it.each([["1", "Zone A"], ["2", "Zone B"], ["3", "Zone C"], ["4", "Zone D"]])(
    "special provision %s asserts poison-by-inhalation → Table 1 (%s)",
    (sp) => {
      const r = selectPlacardRow("6.1", entry("Acetone cyanohydrin, stabilized", [sp, "B9"]), BOTH_61);
      expect(r.ok && r.spec.table).toBe(1);
    },
  );

  // §172.102(c)(1) SP 5: "IF this material meets the definition … a shipping name must be selected
  // which identifies the inhalation hazard". It is conditional on the shipper's choice, so it settles
  // nothing. Reading it as "not PIH" would under-placard; reading it as "PIH" would over-block.
  it("special provision 5 alone is undeterminable, not a non-PIH answer", () => {
    const r = selectPlacardRow("6.1", entry("Chloropicrin mixture, n.o.s.", ["5", "T14"]), BOTH_61);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.citation).toContain("172.102(c)(1)");
  });

  it("an inhalation-hazard shipping name alone is enough for Table 1", () => {
    const r = selectPlacardRow("6.1", entry("Toxic liquid, inhalation hazard, n.o.s.", ["T14"]), BOTH_61);
    expect(r.ok && r.spec.table).toBe(1);
  });

  it("no inhalation provision and no inhalation name → Table 2, the one case that computes a placard", () => {
    const r = selectPlacardRow("6.1", entry("Aniline", ["T14", "TP2"]), BOTH_61);
    expect(r.ok && r.spec.table).toBe(2);
  });

  it("a special provision 1 alongside a 5 still asserts PIH", () => {
    const r = selectPlacardRow("6.1", entry("Methyl isocyanate", ["1", "5"]), BOTH_61);
    expect(r.ok && r.spec.table).toBe(1);
  });
});

describe("selectPlacardRow — Division 5.2", () => {
  it("Type B AND temperature controlled → Table 1", () => {
    const e: TableSelectEntry = { psnPrinted: "Organic peroxide type B, liquid, temperature controlled", hazardClass: "5.2", pgRows: [] };
    expect(selectPlacardRow("5.2", e, BOTH_52)).toMatchObject({ ok: true, spec: { table: 1 } });
  });

  it("Type B WITHOUT temperature control is Table 2 — both conditions are required", () => {
    const e: TableSelectEntry = { psnPrinted: "Organic peroxide type B, liquid", hazardClass: "5.2", pgRows: [] };
    expect(selectPlacardRow("5.2", e, BOTH_52)).toMatchObject({ ok: true, spec: { table: 2 } });
  });

  it("temperature-controlled type D is Table 2", () => {
    const e: TableSelectEntry = { psnPrinted: "Organic peroxide type D, solid, temperature controlled", hazardClass: "5.2", pgRows: [] };
    expect(selectPlacardRow("5.2", e, BOTH_52)).toMatchObject({ ok: true, spec: { table: 2 } });
  });
});

describe("selectPlacardRow — the ordinary and the unknown", () => {
  it("passes a single match straight through", () => {
    const only = [{ classOrDivision: "3", table: 2 as const }];
    expect(selectPlacardRow("3", entry("Gasoline"), only)).toMatchObject({ ok: true, spec: { table: 2 } });
  });

  it("fails closed when the class is in neither table", () => {
    expect(selectPlacardRow("99", entry("Something"), [])).toMatchObject({ ok: false });
  });

  it("fails closed on an ambiguous class it has no rule for, naming that as the reason", () => {
    const twoRows = [{ classOrDivision: "8", table: 1 as const }, { classOrDivision: "8", table: 2 as const }];
    const r = selectPlacardRow("8", entry("Some corrosive"), twoRows);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("no rule to tell them apart");
  });
});

describe("pihRestsOnAbsence — the D2 guard", () => {
  it("is true when Table 2 was chosen only because nothing said PIH", () => {
    expect(pihRestsOnAbsence("6.1", entry("Aniline", ["T14"]))).toBe(true);
  });
  it("is false when a special provision asserted PIH", () => {
    expect(pihRestsOnAbsence("6.1", entry("Acetone cyanohydrin, stabilized", ["2"]))).toBe(false);
  });
  it("is false when the shipping name asserted PIH", () => {
    expect(pihRestsOnAbsence("6.1", entry("Toxic liquid, inhalation hazard, n.o.s."))).toBe(false);
  });
  it("does not apply outside 6.1", () => {
    expect(pihRestsOnAbsence("3", entry("Gasoline"))).toBe(false);
  });
});
