import { describe, expect, it } from "vitest";
import { matchHazSubstances } from "./hazSubstanceMatch.js";
import { DS, ok, pline, result, rline } from "./paperAudit.fixtures.js";

/**
 * Appendix A by FORM, not by exact name (hazSubstanceMatch.ts). Rows copied from dataset 2026.10.0. The
 * first case is the owner's 2026-10-19 Mayo Products BOL 14182: eight 3,600 lb totes of 50 % caustic soda
 * under "UN1824, Sodium hydroxide solution", which the exact match passed as `not_listed`.
 */
const entry = (entryId: string, psnPrinted: string, hazardClass: string, idNumber: string, pg: "I" | "II" | "III" | null) => ({
  entryId, symbols: [], psnPrinted, psnAlternates: [], hazardClass, subsidiaryClasses: [], idPrefix: "UN", idNumber,
  pgRows: [{ pg, exceptionsRef: "154" }],
});
const DS_A = {
  ...DS,
  entries: [
    ...DS.entries,
    entry("UN1824-sodium-hydroxide-solution", "Sodium hydroxide solution", "8", "1824", "II"),
    entry("UN1005-ammonia-anhydrous", "Ammonia, anhydrous", "2.2", "1005", null),
    entry("UN1092-acrolein-stabilized", "Acrolein, stabilized", "6.1", "1092", "I"),
    entry("UN1745-chlorine-pentafluoride", "Chlorine pentafluoride", "2.3", "1745", null),
  ],
  hazSubstances: [
    ...DS.hazSubstances,
    { name: "Sodium hydroxide", nameNormalized: "sodium hydroxide", rqPounds: 1000, rqKg: 454 },
    { name: "Ammonia", nameNormalized: "ammonia", rqPounds: 100, rqKg: 45.4 },
    { name: "Acrolein", nameNormalized: "acrolein", rqPounds: 1, rqKg: 0.454 },
    { name: "Chlorine", nameNormalized: "chlorine", rqPounds: 10, rqKg: 4.54 },
  ],
};
const rq = (entryId: string, psn: string, idText: string, hazardClass: string, pg: "I" | "II" | "III" | null, lb: number, count: number) =>
  result(
    {
      lines: [[
        pline({ idText, psn, hazardClass, pg, quantity: { value: lb, unit: "lb" }, packageCount: count, packaging: `${count} totes` }),
        rline(ok(entryId, pg, { matchedName: psn }), { quantityUnit: "lb", packagingKind: "bulk" }),
      ]],
      resolved: { dataset: DS_A },
    },
    "paper_rq",
  );

describe("Appendix A by form", () => {
  it("Mayo BOL 14182: caustic soda solution over the RQ is NOT a pass — the concentration decides", () => {
    const r = rq("UN1824-sodium-hydroxide-solution", "Sodium hydroxide solution", "UN1824", "8", "II", 28800, 8);
    expect(r.outcome).toBe("cannot_tell");
    expect(r.reason).toBe("concentration_unknown");
    expect(r.facts).toMatchObject({ substance: "Sodium hydroxide", rq: 1000, perPackage: 3600 });
  });

  it("a solution whose whole package is under the RQ is cleared", () => {
    const r = rq("UN1824-sodium-hydroxide-solution", "Sodium hydroxide solution", "UN1824", "8", "II", 4000, 8);
    expect([r.outcome, r.reason]).toEqual(["pass", "below_rq"]);
  });

  it("anhydrous ammonia is ammonia: a cargo tank over 100 lb with no RQ fails", () => {
    const r = rq("UN1005-ammonia-anhydrous", "Ammonia, anhydrous", "UN1005", "2.2", null, 20000, 1);
    expect([r.outcome, r.reason]).toEqual(["fail", "rq_not_printed"]);
  });

  it("stabilized acrolein is acrolein (RQ 1 lb)", () => {
    const r = rq("UN1092-acrolein-stabilized", "Acrolein, stabilized", "UN1092", "6.1", "I", 400, 1);
    expect([r.outcome, r.reason]).toEqual(["fail", "rq_not_printed"]);
  });

  it("a different compound that starts with a listed name matches nothing", () => {
    expect(matchHazSubstances(["Chlorine pentafluoride"], DS_A.hazSubstances)).toEqual({ neat: [], mixture: [] });
    const r = rq("UN1745-chlorine-pentafluoride", "Chlorine pentafluoride", "UN1745", "2.3", null, 500, 1);
    expect(r.reason).toBe("not_listed");
  });

  it("word boundaries hold: 'Sodium' does not match 'Sodium hydroxide solution' as the substance sodium", () => {
    const m = matchHazSubstances(["Sodium hydroxide solution"], [{ nameNormalized: "sodium", rqPounds: 10 }, { nameNormalized: "sodium hydroxide", rqPounds: 1000 }]);
    expect(m.neat).toEqual([]);
    expect(m.mixture.map((h) => h.nameNormalized)).toEqual(["sodium hydroxide"]);
  });
});
