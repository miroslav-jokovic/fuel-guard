import { describe, expect, it } from "vitest";
import { classifyMarinePollutantEntry, matchAppendixNames } from "@hazmat/engine";
import { loadDataset } from "@hazmat/data";

/**
 * Appendix A census (appendixNameMatch.ts): every HMT entry of the shipped dataset, matched to Appendix A
 * by form. Until 2026-10-19 the match was exact, so "Sodium hydroxide solution", "Ammonia, anhydrous" and
 * "Acrolein, stabilized" read as NOT listed and the RQ rule passed them. The counts are pinned so a new
 * dataset cut, or a change to the form lists, has to be looked at rather than slide through; the
 * remainders nobody classified are printed by name on failure.
 */
const ds = loadDataset();
const names = (e: (typeof ds.entries)[number]) => [e.psnPrinted, ...(e.psnAlternates ?? [])].filter((n): n is string => typeof n === "string");
const exact = (e: (typeof ds.entries)[number]) =>
  ds.hazSubstances.some((h) => names(e).some((n) => n.toLowerCase().replace(/\s+/g, " ").trim() === h.nameNormalized));

describe("Appendix A by form — the whole HMT", () => {
  const rows = ds.entries.map((e) => ({ e, m: matchAppendixNames(names(e), ds.hazSubstances), exact: exact(e) }));

  it("an exact match is still a neat match (the change only ever adds)", () => {
    expect(rows.filter((r) => r.exact && r.m.neat.length === 0).map((r) => r.e.entryId)).toEqual([]);
  });

  it("pins how many entries each form reaches", () => {
    const census = {
      dataset: ds.version,
      exact: rows.filter((r) => r.exact).length,
      neatByForm: rows.filter((r) => !r.exact && r.m.neat.length > 0).length,
      mixture: rows.filter((r) => r.m.neat.length === 0 && r.m.mixture.length > 0).length,
    };
    expect(census).toMatchInlineSnapshot(`
      {
        "dataset": "2026.07.1",
        "exact": 155,
        "mixture": 49,
        "neatByForm": 52,
      }
    `);
  });

  it("the Mayo BOL's two lines and the RQ-1/RQ-100 forms are reached", () => {
    const by = (id: string) => rows.find((r) => r.e.entryId === id)!.m;
    expect(by("UN1824-sodium-hydroxide-solution").mixture.map((h) => h.name)).toEqual(["Sodium hydroxide"]);
    expect(by("UN1830-sulfuric-acid").neat.map((h) => h.name)).toEqual(["Sulfuric acid"]);
    expect(by("UN1005-ammonia-anhydrous").neat.map((h) => h.name)).toEqual(["Ammonia"]);
    expect(by("UN1092-acrolein-stabilized").neat.map((h) => h.name)).toEqual(["Acrolein"]);
  });
});

describe("Appendix B by form — the whole HMT", () => {
  const exactB = (e: (typeof ds.entries)[number]) =>
    ds.marinePollutants.some((m) => names(e).some((n) => n.toLowerCase().replace(/\s+/g, " ").trim() === m.nameNormalized));

  it("an exact match is still listed, with its own severity", () => {
    const lost = ds.entries.filter((e) => exactB(e) && !classifyMarinePollutantEntry(e, ds.marinePollutants).listed);
    expect(lost.map((e) => e.entryId)).toEqual([]);
  });

  it("UN2315 Polychlorinated biphenyls, liquid is a SEVERE marine pollutant", () => {
    const pcb = ds.entries.find((e) => e.entryId === "UN2315-polychlorinated-biphenyls-liquid")!;
    expect(classifyMarinePollutantEntry(pcb, ds.marinePollutants)).toEqual({ listed: true, severe: true });
  });

  it("a different compound that opens with a listed name is not listed by it", () => {
    for (const id of ["UN2548-chlorine-pentafluoride", "UN1749-chlorine-trifluoride", "UN1300-turpentine-substitute"]) {
      const e = ds.entries.find((x) => x.entryId === id)!;
      expect(matchAppendixNames(names(e), ds.marinePollutants), id).toEqual({ neat: [], mixture: [] });
    }
  });

  it("pins how many entries Appendix B reaches by form", () => {
    const rows = ds.entries.map((e) => ({ exact: exactB(e), m: matchAppendixNames(names(e), ds.marinePollutants) }));
    expect({
      dataset: ds.version,
      exact: rows.filter((r) => r.exact).length,
      neatByForm: rows.filter((r) => !r.exact && r.m.neat.length > 0).length,
      mixture: rows.filter((r) => r.m.neat.length === 0 && r.m.mixture.length > 0).length,
    }).toMatchInlineSnapshot(`
      {
        "dataset": "2026.07.1",
        "exact": 132,
        "mixture": 6,
        "neatByForm": 7,
      }
    `);
  });
});

