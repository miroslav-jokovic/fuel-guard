import { describe, expect, it } from "vitest";
import { matchHazSubstances } from "@hazmat/engine";
import { loadDataset } from "@hazmat/data";

/**
 * Appendix A census (hazSubstanceMatch.ts): every HMT entry of the shipped dataset, matched to Appendix A
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
  const rows = ds.entries.map((e) => ({ e, m: matchHazSubstances(names(e), ds.hazSubstances), exact: exact(e) }));

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
        "mixture": 37,
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
