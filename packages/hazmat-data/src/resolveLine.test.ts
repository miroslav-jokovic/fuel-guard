import { describe, expect, it } from "vitest";
import { loadDataset } from "./index";
import {
  buildDatasetIndex,
  normalizePsnForMatch,
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
  it("prefixless id present in BOTH UN and NA → id_prefix_ambiguous", () => {
    // 1993 exists as UN1993 (flammable liquids) AND NA1993 (combustible/diesel/fuel oil).
    expect(resolve({ idText: "1993", psn: "Diesel fuel" })).toMatchObject({ ok: false, reason: "id_prefix_ambiguous" });
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
  it("UN1230 Methanol (I-variant + D-variant) collapses to a unique canonical entry", () => {
    const r = resolve({ idText: "UN1230", psn: "Methanol", hazardClass: "3", pg: "II" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entryId).toBe("UN1230-methanol"); // canonical = lowest entryId among symbol variants
  });
  it("UN1202 with NO psn is ambiguous — three different products share the id (not D/I variants)", () => {
    expect(resolve({ idText: "UN1202" })).toMatchObject({ ok: false, reason: "psn_ambiguous" });
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
