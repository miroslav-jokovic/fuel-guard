import { describe, expect, it } from "vitest";
import { loadDataset } from "./index";
import {
  buildDatasetIndex,
  normalizePsnForMatch,
  parseHmtRef,
  parsePrintedClass,
  resolveHmtLine,
  PSN_NORMALIZER_VERSION,
  type ResolveLineInput,
} from "./resolveLine";

/**
 * resolveHmtLine() — verified against the REAL shipped dataset (2026.07.1). The load-bearing cases are the
 * adversarial near-miss pairs the plan calls out: the algorithm must NEVER fuzzy-pick a look-alike product.
 */
const index = buildDatasetIndex(loadDataset());
const resolve = (input: Partial<ResolveLineInput>) =>
  resolveHmtLine(index, { idText: null, psn: null, hazardClass: null, pg: null, ...input });

describe("resolveHmtLine — happy paths", () => {
  it("resolves gasoline by id+psn+class+pg", () => {
    const r = resolve({ idText: "UN1203", psn: "Gasoline", hazardClass: "3", pg: "II" });
    expect(r).toMatchObject({ ok: true, hmtRef: "UN1203-gasoline#II", entryId: "UN1203-gasoline", pg: "II" });
    if (r.ok) expect(r.findings).toEqual([]);
  });

  it("resolves by id alone when the id maps to exactly one entry", () => {
    expect(resolve({ idText: "UN1203" })).toMatchObject({ ok: true, entryId: "UN1203-gasoline" });
  });

  it("infers the prefix when only one key space has the id (1203 → UN)", () => {
    expect(resolve({ idText: "1203", psn: "Gasoline" })).toMatchObject({ ok: true, entryId: "UN1203-gasoline" });
  });

  it("resolves an 'or'-alternate name (Gas oil → the UN1202 gas-oil entry)", () => {
    expect(resolve({ idText: "UN1202", psn: "Gas oil", pg: "III" })).toMatchObject({ ok: true, entryId: "UN1202-gas-oil" });
  });

  it("resolves via a listed alternate (Petroleum products, n.o.s. → UN1268)", () => {
    expect(resolve({ idText: "UN1268", psn: "Petroleum products, n.o.s.", pg: "II" }))
      .toMatchObject({ ok: true, entryId: "UN1268-petroleum-distillates-n-o-s", pg: "II" });
  });

  it("folds n.o.s. spelling variants (NOS ≡ n.o.s.)", () => {
    expect(resolve({ idText: "UN1268", psn: "Petroleum distillates, NOS", pg: "III" }))
      .toMatchObject({ ok: true, entryId: "UN1268-petroleum-distillates-n-o-s" });
  });
});

describe("resolveHmtLine — the adversarial near-miss pairs (NO fuzzy picks)", () => {
  it("UN1206 Heptanes resolves; the SAME id with Hexanes fails psn_no_match (never picks 1208)", () => {
    expect(resolve({ idText: "UN1206", psn: "Heptanes", hazardClass: "3", pg: "II" }))
      .toMatchObject({ ok: true, entryId: "UN1206-heptanes" });
    const wrong = resolve({ idText: "UN1206", psn: "Hexanes", pg: "II" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason).toBe("psn_no_match");
  });

  it("transposition trap: UN1203 + Methanol → psn_no_match (never silently becomes UN1230)", () => {
    const r = resolve({ idText: "UN1203", psn: "Methanol", pg: "II" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("psn_no_match");
  });

  it("UN1267 crude vs UN1268 distillates resolve to their own entries", () => {
    expect(resolve({ idText: "UN1267", psn: "Petroleum crude oil", pg: "I" }))
      .toMatchObject({ ok: true, entryId: "UN1267-petroleum-crude-oil", pg: "I" });
    expect(resolve({ idText: "UN1268", psn: "Petroleum distillates, n.o.s.", pg: "II" }))
      .toMatchObject({ ok: true, entryId: "UN1268-petroleum-distillates-n-o-s", pg: "II" });
  });
});

describe("resolveHmtLine — id failures", () => {
  it("no digits → id_missing", () => {
    expect(resolve({ idText: "Gasoline", psn: "Gasoline" })).toMatchObject({ ok: false, reason: "id_missing" });
    expect(resolve({ idText: null })).toMatchObject({ ok: false, reason: "id_missing" });
  });
  it("prefixless id present in BOTH UN and NA with no name → id_prefix_ambiguous", () => {
    // 1993 exists as UN1993 (flammable liquids) AND NA1993 (combustible/diesel/fuel oil).
    expect(resolve({ idText: "1993" })).toMatchObject({ ok: false, reason: "id_prefix_ambiguous" });
  });
  it("prefixless id in BOTH UN and NA: the printed name picks the one key space that holds it", () => {
    expect(resolve({ idText: "1993", psn: "Diesel fuel", pg: "III" })).toMatchObject({ ok: true, entryId: "NA1993-diesel-fuel" });
    // The owner's BOL of 2026-10-19: "1760, Corrosive liquid N.O.S. (alkali metal salt), 8, II" is UN1760 —
    // NA1760 is "Compounds, cleaning liquid".
    const r = resolve({ idText: "1760", psn: "Corrosive liquid N.O.S. (alkali metal salt)", hazardClass: "8", pg: "II" });
    expect(r).toMatchObject({ ok: true, hmtRef: expect.stringMatching(/^UN1760-/) });
  });
  it("prefixless id whose name neither key space holds → psn_no_match listing both blocks", () => {
    const r = resolve({ idText: "1993", psn: "Methanol" });
    expect(r).toMatchObject({ ok: false, reason: "psn_no_match" });
    if (!r.ok) expect(new Set(r.candidates!.map((c) => c.entryId.slice(0, 2)))).toEqual(new Set(["UN", "NA"]));
  });
  it("unknown id → id_not_found", () => {
    expect(resolve({ idText: "UN9999", psn: "Nothing" })).toMatchObject({ ok: false, reason: "id_not_found" });
  });
});

describe("resolveHmtLine — PG handling", () => {
  it("multi-PG entry with no PG on the paper → pg_required_ambiguous", () => {
    expect(resolve({ idText: "UN1268", psn: "Petroleum distillates, n.o.s." }))
      .toMatchObject({ ok: false, reason: "pg_required_ambiguous" });
  });
  it("multi-PG entry: the paper's PG selects the row", () => {
    expect(resolve({ idText: "UN1268", psn: "Petroleum distillates, n.o.s.", pg: "III" }))
      .toMatchObject({ ok: true, pg: "III", hmtRef: "UN1268-petroleum-distillates-n-o-s#III" });
  });
  it("single-PG entry with no PG on the paper → resolves + pg_missing finding", () => {
    const r = resolve({ idText: "UN1203", psn: "Gasoline" });
    expect(r).toMatchObject({ ok: true, pg: "II" });
    if (r.ok) expect(r.findings).toContain("pg_missing");
  });
  it("single-PG entry with a WRONG PG → resolves to the authoritative PG + pg_mismatch", () => {
    const r = resolve({ idText: "UN1203", psn: "Gasoline", pg: "III" });
    expect(r).toMatchObject({ ok: true, pg: "II" });
    if (r.ok) expect(r.findings).toContain("pg_mismatch");
  });
  it("Class 2 gas carries no PG; a PG on the paper → resolves pg=null + pg_present_on_no_pg_entry", () => {
    const r = resolve({ idText: "UN1978", psn: "Propane", pg: "II" });
    expect(r).toMatchObject({ ok: true, pg: null, entryId: "UN1978-propane" });
    if (r.ok) expect(r.findings).toContain("pg_present_on_no_pg_entry");
  });
});

describe("resolveHmtLine — class handling", () => {
  it("plain class must match", () => {
    expect(resolve({ idText: "UN1203", psn: "Gasoline", hazardClass: "8" }))
      .toMatchObject({ ok: false, reason: "class_mismatch" });
  });
  it("Combustible liquid satisfies a Class-3 PG III entry ONLY with the offeror election", () => {
    const withElection = resolve({ idText: "NA1993", psn: "Diesel fuel", hazardClass: "Combustible liquid", pg: "III", reclassedCombustible: true });
    expect(withElection).toMatchObject({ ok: true, entryId: "NA1993-diesel-fuel" });
    const without = resolve({ idText: "NA1993", psn: "Diesel fuel", hazardClass: "Combustible liquid", pg: "III" });
    expect(without).toMatchObject({ ok: false, reason: "class_mismatch" });
  });
});

describe("resolveHmtLine — D/I symbol variants + name discipline", () => {
  // The two Methanol rows are not symbol-only variants once column (6) is read (D-PC1, 2026-10-26): the I row
  // carries a 6.1 subsidiary label, the D row does not (the domestic exception). The printed class picks the
  // row, exactly, and says so — "3" is the D row's own printing, "3 (6.1)" the I row's (§172.202(a)(3)).
  it("UN1230 Methanol: '3' is the D row, '3 (6.1)' the I row, each chosen by the printed class", () => {
    const domestic = resolve({ idText: "UN1230", psn: "Methanol", hazardClass: "3", pg: "II" });
    expect(domestic).toMatchObject({ ok: true, entryId: "UN1230-methanol#2", findings: ["row_chosen_by_class"] });
    const international = resolve({ idText: "UN1230", psn: "Methanol", hazardClass: "3 (6.1)", pg: "II" });
    expect(international).toMatchObject({ ok: true, entryId: "UN1230-methanol", findings: ["row_chosen_by_class"] });
  });
  it("UN2922 'Corrosive liquids, toxic, n.o.s.' resolves printed as 8 (6.1), 8(6.1), CLASS 8 (6.1) and 8 alone; never with a subsidiary the table does not list", () => {
    for (const cls of ["8 (6.1)", "8(6.1)", "CLASS 8 (6.1)", "Class 8(6.1)", "8"]) {
      expect(resolve({ idText: "UN2922", psn: "Corrosive liquids, toxic, n.o.s.", hazardClass: cls, pg: "III" }), cls).toMatchObject({ ok: true, entryId: "UN2922-corrosive-liquids-toxic-n-o-s" });
    }
    expect(resolve({ idText: "UN2922", psn: "Corrosive liquids, toxic, n.o.s.", hazardClass: "8 (3)", pg: "III" })).toMatchObject({ ok: false, reason: "class_mismatch" });
    expect(resolve({ idText: "UN2922", psn: "Corrosive liquids, toxic, n.o.s.", hazardClass: "6.1 (8)", pg: "III" })).toMatchObject({ ok: false, reason: "class_mismatch" });
  });
  it("UN1202 with NO psn is ambiguous — three different products share the id (not D/I variants)", () => {
    expect(resolve({ idText: "UN1202" })).toMatchObject({ ok: false, reason: "psn_ambiguous" });
  });
});

describe("resolveHmtLine — class punctuation (D-PC2): the classes are the table's, the parentheses the audit's", () => {
  const line = (hazardClass: string) => resolve({ idText: "UN2924", psn: "Flammable liquids, corrosive, n.o.s.", hazardClass, pg: "II" });

  it("resolves UN2924 printed '3, 8', '3/8', '3 8', 'CLASS 3, 8' and an unclosed '3 (8' as 3 (8), saying the parentheses are missing", () => {
    for (const cls of ["3, 8", "3,8", "3/8", "3 8", "CLASS 3, 8", "Class 3, Class 8", "3 (8"]) {
      expect(line(cls), cls).toMatchObject({ ok: true, entryId: "UN2924-flammable-liquids-corrosive-n-o-s", findings: ["subsidiary_not_in_parentheses"] });
    }
  });

  it("keeps the parenthesised printings exact: '3 (8)', '3(8)', '3, (8)' and 'Class 3 (Division 8)' carry no finding", () => {
    for (const cls of ["3 (8)", "3(8)", "3, (8)", "Class 3 (Division 8)", "3"]) {
      const r = line(cls);
      expect(r, cls).toMatchObject({ ok: true, entryId: "UN2924-flammable-liquids-corrosive-n-o-s" });
      expect(r.ok ? r.findings : r.reason, cls).toEqual([]);
    }
  });

  it("refuses a subsidiary the table does not list in every punctuation, never as a form defect", () => {
    for (const cls of ["3, 6.1", "3/6.1", "3 6.1", "3 (6.1)", "3 (8, 6.1)", "3, 8, 6.1", "6.1, 8"]) {
      expect(line(cls), cls).toMatchObject({ ok: false, reason: "class_mismatch" });
    }
  });

  it("parsePrintedClass reads the primary, the subsidiaries and whether §172.202(a)(3)'s form was kept, and refuses what is not a class", () => {
    expect(parsePrintedClass("Class 6.1, (8, 3)")).toEqual({ primary: "6.1", subsidiaries: ["8", "3"], parenthesised: true });
    expect(parsePrintedClass("1.3C (6.1)")).toEqual({ primary: "1.3c", subsidiaries: ["6.1"], parenthesised: true });
    expect(parsePrintedClass("3 8")).toEqual({ primary: "3", subsidiaries: ["8"], parenthesised: false });
    expect(parsePrintedClass("3 (8")).toEqual({ primary: "3", subsidiaries: ["8"], parenthesised: false });
    expect(parsePrintedClass(" Division 1.4S ")).toEqual({ primary: "1.4s", subsidiaries: [], parenthesised: true });
    for (const bad of ["Combustible liquid", "3 ()", "3 8)", "flammable", "PG II", ""]) expect(parsePrintedClass(bad), bad).toBeNull();
  });
});

describe("resolveHmtLine — rows that share one name (Q-RC3, D-RC4)", () => {
  it("the printed class picks the row, and says it did: ammonia 2.2 is the domestic row, 2.3 the other", () => {
    const d = resolve({ idText: "UN1005", psn: "Ammonia, anhydrous", hazardClass: "2.2" });
    expect(d).toMatchObject({ ok: true, entryId: "UN1005-ammonia-anhydrous#2" });
    if (d.ok) expect(d.findings).toContain("row_chosen_by_class");
    expect(resolve({ idText: "UN1005", psn: "Ammonia, anhydrous", hazardClass: "2.3" })).toMatchObject({ ok: true, entryId: "UN1005-ammonia-anhydrous" });
    expect(resolve({ idText: "UN1950", psn: "AEROSOLS", hazardClass: "2.1" })).toMatchObject({ ok: true, entryId: "UN1950-aerosols#2" });
  });
  it("refuses when nothing printed tells the rows apart, or the class fits none of them", () => {
    expect(resolve({ idText: "UN1005", psn: "Ammonia, anhydrous" })).toMatchObject({ ok: false, reason: "psn_ambiguous" });
    expect(resolve({ idText: "UN1005", psn: "Ammonia, anhydrous", hazardClass: "3" })).toMatchObject({ ok: false, reason: "class_mismatch" });
    expect(resolve({ idText: "UN2790", psn: "Acetic acid solution", hazardClass: "8" })).toMatchObject({ ok: false, reason: "psn_ambiguous" });
  });
  it("the printed PG picks the row when the class cannot, and says it did", () => {
    const r = resolve({ idText: "UN2790", psn: "Acetic acid solution", hazardClass: "8", pg: "III" });
    expect(r).toMatchObject({ ok: true, entryId: "UN2790-acetic-acid-solution#2", pg: "III" });
    if (r.ok) expect(r.findings).toContain("row_chosen_by_pg");
  });
  it("a row whose own name was printed outranks one listing it as an alternate (UN2037 Gas cartridges)", () => {
    const r = resolve({ idText: "UN2037", psn: "Gas cartridges", hazardClass: "2.1" });
    // The 2.2 row lists "gas cartridges" too, so the class did choose — and says so.
    expect(r).toMatchObject({ ok: true, entryId: "UN2037-gas-cartridges" });
  });
});

describe("resolveHmtLine — normalizer + parenthetical discipline", () => {
  it("strips a trailing parenthetical ONLY on a G-entry (technical name), keeps it otherwise", () => {
    // UN1993 'Flammable liquids, n.o.s.' carries G → an appended technical name is stripped for the match.
    expect(resolve({ idText: "UN1993", psn: "Flammable liquids, n.o.s. (contains ethanol)", pg: "II" }))
      .toMatchObject({ ok: true, entryId: "UN1993-flammable-liquids-n-o-s" });
    // NA1993 'Fuel oil' has NO G → the parenthetical is load-bearing and NOT stripped, so it won't match.
    expect(resolve({ idText: "NA1993", psn: "Fuel oil (No. 2)", pg: "III" })).toMatchObject({ ok: false, reason: "psn_no_match" });
    // The plain printed name still matches.
    expect(resolve({ idText: "NA1993", psn: "Fuel oil", pg: "III" })).toMatchObject({ ok: true, entryId: "NA1993-fuel-oil" });
  });

  it("folds singular/plural on any word, not only the last (\"FLAMMABLE LIQUID, N.O.S.\" is UN1993's name)", () => {
    // The table prints "Flammable liquids, n.o.s." — the last token is "nos", so a last-word-only fold missed it.
    expect(resolve({ idText: "UN1993", psn: "FLAMMABLE LIQUID, N.O.S. (ISOPROPYL ALCOHOL)", hazardClass: "3", pg: "III" }))
      .toMatchObject({ ok: true, entryId: "UN1993-flammable-liquids-n-o-s", pg: "III" });
    expect(resolve({ idText: "UN1760", psn: "CORROSIVE LIQUID, N.O.S. (PHOSPHORIC ACID, DODECYLBENZENE SULFONIC ACID)", hazardClass: "8", pg: "II" }))
      .toMatchObject({ ok: true, hmtRef: expect.stringMatching(/^UN1760-.*#II$/) });
    // Still blocked on the id: the singular of another number's name is no match.
    expect(resolve({ idText: "UN1993", psn: "Corrosive liquid, n.o.s.", pg: "II" })).toMatchObject({ ok: false, reason: "psn_no_match" });
  });

  it("strips leading shipping-paper modifiers (RQ / Waste / HOT)", () => {
    expect(resolve({ idText: "UN1203", psn: "RQ, Gasoline" })).toMatchObject({ ok: true, entryId: "UN1203-gasoline" });
    expect(resolve({ idText: "UN1203", psn: "Waste Gasoline" })).toMatchObject({ ok: true, entryId: "UN1203-gasoline" });
  });

  it("normalizer is versioned + reported", () => {
    expect(resolve({ idText: "UN1203", psn: "Gasoline" }).normalizerVersion).toBe(PSN_NORMALIZER_VERSION);
    expect(normalizePsnForMatch("Petroleum distillates, N.O.S.", false)).toBe("petroleum distillates nos");
  });
});

describe("resolveHmtLine — performance (blocking makes it O(1) per line)", () => {
  it("resolves 5000 lines fast (hash blocking, no table scan) — catches an O(n) regression", () => {
    // Coarse Date.now() timing (no node types in this package). 5000 O(1) resolutions finish in a few ms;
    // a regression to a table scan (5000 × ~2,479 entries) would blow well past this generous bound.
    const t0 = Date.now();
    for (let i = 0; i < 5000; i++) resolve({ idText: "UN1203", psn: "Gasoline", pg: "II" });
    expect(Date.now() - t0).toBeLessThan(750);
  });
});

describe("parseHmtRef — the ref resolveHmtLine builds", () => {
  it("splits at the last '#': an entry id may hold one (UN1950-aerosols#2), and safety-permit / security-plan read it", () => {
    expect(parseHmtRef("UN1950-aerosols#2#none")).toEqual({ entryId: "UN1950-aerosols#2", pg: null });
    expect(parseHmtRef("UN2790-acetic-acid-solution#2#III")).toEqual({ entryId: "UN2790-acetic-acid-solution#2", pg: "III" });
    const r = resolve({ idText: "UN1950", psn: "Aerosols", hazardClass: "2.1" });
    if (!r.ok) throw new Error(r.reason);
    expect(parseHmtRef(r.hmtRef)).toEqual({ entryId: r.entryId, pg: r.pg });
  });
});
