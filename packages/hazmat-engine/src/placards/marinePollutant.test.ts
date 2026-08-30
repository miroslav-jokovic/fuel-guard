import { describe, expect, it } from "vitest";
import { evaluateLoad } from "../index.js";
import { concentrationThresholdPct, findMarinePollutants, smallPackageExcepted } from "./marinePollutant.js";
import type { LoadInput } from "../types.js";

/**
 * §172.322 — the MARINE POLLUTANT mark (0.12.0).
 *
 * ⚠ The two branches worth the most scrutiny are the ones that produce NOTHING, because they are the
 * ones a from-memory implementation gets wrong in the dangerous direction — by marking loads that
 * need no mark, training people to ignore the mark:
 *
 *  · §171.4(c)(1) — a domestic highway move of a NON-BULK marine pollutant has no marine-pollutant
 *    requirement at all.
 *  · §172.322(d)(3) — a domestic BULK marine pollutant on an already-placarded vehicle needs no mark.
 *    That is the ordinary placarded tanker, i.e. most of this product's traffic.
 *
 * Research: docs/plans/hazmat-consolidation/MARINE-POLLUTANT-RESEARCH.md (eCFR verbatim).
 */
const DATASET = {
  version: "test-mp",
  provisional: false,
  entries: [
    // A marine pollutant that DOES placard: Class 3.
    { entryId: "UN1993-flam", psnPrinted: "Flammable liquid, n.o.s.", hazardClass: "3", idPrefix: "UN", idNumber: "1993", pgRows: [{ pg: "III" }] },
    // A marine pollutant that takes NO placard at all: Class 9 environmentally hazardous substance.
    { entryId: "UN3082-ehs", psnPrinted: "Environmentally hazardous substance, liquid, n.o.s.", hazardClass: "9", idPrefix: "UN", idNumber: "3082", pgRows: [{ pg: "III" }] },
    // Not on appendix B at all.
    { entryId: "UN1203-gasoline", psnPrinted: "Gasoline", hazardClass: "3", idPrefix: "UN", idNumber: "1203", pgRows: [{ pg: "II" }] },
    // The SP-441 route: recognised by identity, never by an appendix B name match.
    { entryId: "UN3082-ehs-nos", psnPrinted: "Environmentally hazardous substance, liquid, n.o.s.", hazardClass: "9", idPrefix: "UN", idNumber: "3082", pgRows: [{ pg: "III" }] },
    // Shares the ID number, different entry — SP 441 does not name it.
    { entryId: "NA3082-waste", psnPrinted: "Hazardous waste, liquid, n.o.s.", hazardClass: "9", idPrefix: "NA", idNumber: "3082", pgRows: [{ pg: "III" }] },
  ],
  placards: [
    { classOrDivision: "3", table: 2, placardName: "FLAMMABLE", designRef: "172.542", wordingOptions: [] },
    // Class 9 takes no placard domestically — "NONE" is how the dataset states that.
    { classOrDivision: "9", table: 2, placardName: "NONE", designRef: "172.504", wordingOptions: [] },
  ],
  erg: [],
  marinePollutants: [
    { nameNormalized: "flammable liquid, n.o.s.", severe: false },
    { nameNormalized: "environmentally hazardous substance, liquid, n.o.s.", severe: true },
  ],
};

const line = (over: Record<string, unknown> = {}): LoadInput["lines"][number] =>
  ({
    hmtRef: "UN1993-flam#III", reclassedCombustible: false, isLimitedQuantity: false,
    quantity: { value: 4000, unit: "gal" }, grossWeightLb: 30000, compartmentIndex: null,
    isResidueLine: false, flashPointF: 90, ethanolPct: null, packagingKind: "bulk", packageCount: null,
    ...over,
  }) as unknown as LoadInput["lines"][number];

const load = (over: Partial<LoadInput> = {}, vessel: boolean | null = null): LoadInput =>
  ({
    evaluatedAt: "2026-07-30T00:00:00Z",
    vehicle: { kind: "cargo_tank", cargoTankCapacityGal: 9000, compartments: null },
    tankState: "loaded", lines: [line()],
    claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: [] },
    portContext: { vesselConnected: vessel, imdgPapers: null },
    tripContext: { previousOrCurrentBusinessDayIds: null, carrierRelationship: "unknown" },
    policy: null, dataset: DATASET, ...over,
  }) as unknown as LoadInput;

const marks = (v: ReturnType<typeof evaluateLoad>) => v.placards.marks.map((m) => m.mark);
/**
 * `evaluateLoad` keeps only conditional/violation findings in `eligibility.blocks`, so an `info`
 * finding never leaves the engine. The channels that DO reach a reader are the mark and the trace,
 * which is what these assert against.
 */
const ruleIds = (v: ReturnType<typeof evaluateLoad>) => v.trace.filter((t) => t.fired).map((t) => t.ruleId);
const traceNote = (v: ReturnType<typeof evaluateLoad>, ruleId: string): string =>
  v.trace.find((t) => t.fired && t.ruleId === ruleId)?.note ?? "";

const VAN = { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null } as unknown as LoadInput["vehicle"];

describe("§172.322 — the branches that require nothing", () => {
  it("non-bulk on a domestic highway move needs no mark at all (§171.4(c)(1))", () => {
    const v = evaluateLoad(load({ vehicle: VAN, lines: [line({ packagingKind: "non_bulk", grossWeightLb: 30000 })] }, false));
    expect(marks(v)).not.toContain("MARINE_POLLUTANT");
    expect(ruleIds(v)).toContain("marine_pollutant_nonbulk");
  });

  it("bulk on an already-placarded domestic vehicle needs no mark (§172.322(d)(3))", () => {
    const v = evaluateLoad(load({}, false));
    // the load IS placarded…
    expect(v.placards.required.map((r) => r.placard)).toContain("FLAMMABLE");
    // …which is exactly why the mark is not required.
    expect(marks(v)).not.toContain("MARINE_POLLUTANT");
  });

  it("a material that is not on appendix B is never marked", () => {
    const v = evaluateLoad(load({ lines: [line({ hmtRef: "UN1203-gasoline#II" })] }, false));
    expect(marks(v)).not.toContain("MARINE_POLLUTANT");
  });
});

describe("§172.322 — the branch that requires the mark", () => {
  it("bulk with NO placard on the vehicle is marked (§172.322(b), (c))", () => {
    const v = evaluateLoad(load({ lines: [line({ hmtRef: "UN3082-ehs#III" })] }, false));
    expect(v.placards.required).toEqual([]); // class 9 takes no placard domestically
    expect(marks(v)).toContain("MARINE_POLLUTANT");
    const mark = v.placards.marks.find((m) => m.mark === "MARINE_POLLUTANT")!;
    expect(mark.positions).toContain("each side and each end");
    expect(mark.because.map((c) => c.cfr)).toContain("49 CFR 172.322(b)");
  });

  it("a vessel leg defeats the placarded-vehicle exception, which is expressly not for vessel", () => {
    const v = evaluateLoad(load({}, true));
    expect(v.placards.required.map((r) => r.placard)).toContain("FLAMMABLE");
    expect(marks(v)).toContain("MARINE_POLLUTANT");
  });

  it("non-bulk with a vessel leg is marked, since §171.4(c)(1) is highway-only", () => {
    const v = evaluateLoad(load({ vehicle: VAN, lines: [line({ packagingKind: "non_bulk" })] }, true));
    expect(marks(v)).toContain("MARINE_POLLUTANT");
  });
});

describe("§172.322 — the n.o.s. route (special provision 441)", () => {
  /**
   * Appendix B lists SUBSTANCES; measured against the shipped dataset only 132 of 2,479 HMT entries
   * match it by shipping name. UN3077/UN3082 are the other door, and no name match can ever find
   * them, because what makes the load a pollutant is a component the paper names in parentheses.
   */
  it("recognises UN3082 by identity even though appendix B does not name it", () => {
    const ds = { ...DATASET, marinePollutants: [] }; // appendix B deliberately empty
    const v = evaluateLoad(load({
      dataset: ds as unknown as LoadInput["dataset"],
      lines: [line({ hmtRef: "UN3082-ehs-nos#III" })],
    }, false));
    expect(marks(v)).toContain("MARINE_POLLUTANT");
  });

  it("does not extend that to NA3082, which shares the number but not the entry", () => {
    const ds = { ...DATASET, marinePollutants: [] };
    const v = evaluateLoad(load({
      dataset: ds as unknown as LoadInput["dataset"],
      lines: [line({ hmtRef: "NA3082-waste#III" })],
    }, false));
    expect(marks(v)).not.toContain("MARINE_POLLUTANT");
  });
});

describe("§172.322 — the unstated vessel leg", () => {
  it("asks only when the answer actually differs between the branches", () => {
    // bulk + placarded + vessel unknown: domestic says no mark, vessel says mark → ask.
    const asked = evaluateLoad(load({}, null));
    expect(asked.eligibility.blocks.map((b) => b.ruleId)).toContain("marine_pollutant_vessel_unknown");
  });

  it("does not ask when both branches agree — bulk with no placard is marked either way", () => {
    const v = evaluateLoad(load({ lines: [line({ hmtRef: "UN3082-ehs#III" })] }, null));
    expect(marks(v)).toContain("MARINE_POLLUTANT");
    expect(v.eligibility.blocks.map((b) => b.ruleId)).not.toContain("marine_pollutant_vessel_unknown");
  });

  it("a conditional leaves the load not auto-clearable, which is the point of asking", () => {
    const v = evaluateLoad(load({}, null));
    expect(v.eligibility.status).toBe("not_checked");
  });
});

describe("§172.322 — what the finding refuses to assume", () => {
  it("states the concentration test it cannot evaluate, in the conditional a reader actually sees", () => {
    const v = evaluateLoad(load({}, null));
    const f = v.eligibility.blocks.find((b) => b.ruleId === "marine_pollutant_vessel_unknown");
    expect(f?.message).toContain("10%");
    expect(f?.message).toContain("1%");
  });

  it("says in the trace why the mark is or is not required", () => {
    expect(traceNote(evaluateLoad(load({}, false)), "marine_pollutant")).toContain("172.322(d)(3)");
    expect(traceNote(evaluateLoad(load({ lines: [line({ hmtRef: "UN3082-ehs#III" })] }, false)), "marine_pollutant"))
      .toContain("bears no placard");
    expect(traceNote(evaluateLoad(load({ vehicle: VAN, lines: [line({ packagingKind: "non_bulk" })] }, false)), "marine_pollutant_nonbulk"))
      .toContain("171.4(c)(1)");
  });

  it("carries the severe flag into the conditional's evidence, since it changes the threshold", () => {
    const v = evaluateLoad(load({ lines: [line({ hmtRef: "UN3082-ehs#III", packagingKind: "non_bulk" })], vehicle: VAN }, null));
    const f = v.eligibility.blocks.find((b) => b.ruleId === "marine_pollutant_vessel_unknown");
    expect(JSON.stringify(f?.evidence)).toContain('"severe":true');
  });
});

/**
 * §171.8's concentration test (0.14.0).
 *
 * ⚠ The clause is "when in a SOLUTION OR MIXTURE of one or more marine pollutants" — a neat listed
 * material is a marine pollutant with no arithmetic at all. So the input is fail-closed by
 * construction: a blank field means "neat, or a mixture nobody measured", and both stay classified.
 * Only a STATED number below the threshold can take a line out, which is the one direction that
 * removes a requirement and therefore the one that has to be deliberate.
 */
describe("§171.8 — the concentration test", () => {
  const bulkUnplacarded = (pct: number | null) =>
    evaluateLoad(load({ lines: [line({ hmtRef: "UN3082-ehs#III", marinePollutantConcentrationPct: pct })] }, false));

  it("a stated concentration below the threshold is not a marine pollutant at all", () => {
    // UN3082-ehs is severe in this dataset → 1%.
    expect(marks(bulkUnplacarded(0.5))).not.toContain("MARINE_POLLUTANT");
  });

  it("a stated concentration at the threshold still is one", () => {
    expect(marks(bulkUnplacarded(1))).toContain("MARINE_POLLUTANT");
  });

  it("a blank concentration keeps the line classified — neat, or simply unmeasured", () => {
    expect(marks(bulkUnplacarded(null))).toContain("MARINE_POLLUTANT");
  });

  it("uses 10% for a listed material and 1% for a severe one", () => {
    expect(concentrationThresholdPct(false)).toBe(10);
    expect(concentrationThresholdPct(true)).toBe(1);
    // Unknown severity takes the STRICTER figure: more mixtures count, which over-displays.
    expect(concentrationThresholdPct(null)).toBe(1);
  });

  it("5% of a non-severe pollutant is out, while 5% of a severe one is in", () => {
    const nonSevere = evaluateLoad(load({ lines: [line({ marinePollutantConcentrationPct: 5 })] }, false));
    expect(marks(nonSevere)).not.toContain("MARINE_POLLUTANT"); // UN1993-flam, 10% threshold
    const severe = evaluateLoad(load({ lines: [line({ hmtRef: "UN3082-ehs#III", marinePollutantConcentrationPct: 5 })] }, false));
    expect(marks(severe)).toContain("MARINE_POLLUTANT");
  });

  it("reports the stated figure instead of apologising for having no input", () => {
    const v = evaluateLoad(load({ lines: [line({ hmtRef: "UN3082-ehs#III", marinePollutantConcentrationPct: 40 })] }, false));
    const note = v.trace.find((t) => t.fired && t.ruleId === "marine_pollutant")?.note ?? "";
    expect(note).toContain("MARINE POLLUTANT mark required");
    const finding = (v.notices ?? []).find((f) => f.ruleId === "marine_pollutant_mark_required");
    expect(finding?.message).toContain("40%");
    expect(finding?.message).not.toContain("no concentration input");
  });
});

/**
 * §172.322(d)(1) — the small-package exception (0.15.0).
 *
 * ⚠ This is the ONLY rule in this file that can REMOVE a marking requirement on a stated number, so
 * every test here is really asking the same question: can it be made to fire when it should not?
 *
 * Note what it is measured against. (d)(1) is a NET QUANTITY — the contents — and the form already
 * carries a per-package CAPACITY for the §171.8 bulk test (D-H14). They share a unit and mean
 * different things, and using the capacity here would fail OPEN: it would excuse a mark on a package
 * whose contents nobody stated.
 */
const VAN2 = { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null } as unknown as LoadInput["vehicle"];
const perPackage = (v: number, unit: "L" | "kg") => ({ value: v, unit });

describe("§172.322(d)(1) — the small-package exception", () => {
  const vesselNonBulk = (over: Record<string, unknown>) =>
    evaluateLoad(load({ vehicle: VAN2, lines: [line({ packagingKind: "non_bulk", ...over })] }, true));

  it("lifts the mark when every package holds 5 L or less", () => {
    expect(marks(vesselNonBulk({ marinePollutantPerPackage: perPackage(5, "L") }))).not.toContain("MARINE_POLLUTANT");
  });

  it("keeps it at 5.1 L — the limb is 5 L or LESS", () => {
    expect(marks(vesselNonBulk({ marinePollutantPerPackage: perPackage(5.1, "L") }))).toContain("MARINE_POLLUTANT");
  });

  it("lifts it at 5 kg for a solid, the other limb", () => {
    expect(marks(vesselNonBulk({ marinePollutantPerPackage: perPackage(5, "kg") }))).not.toContain("MARINE_POLLUTANT");
  });

  it("keeps it when nothing is stated — a blank is not a small package", () => {
    expect(marks(vesselNonBulk({ marinePollutantPerPackage: null }))).toContain("MARINE_POLLUTANT");
  });

  it("stops asking about the vessel leg once the answer cannot depend on it", () => {
    // Unstated vessel + excepted packages: highway says nothing, vessel says nothing. No question.
    const v = evaluateLoad(load({ vehicle: VAN2, lines: [line({ packagingKind: "non_bulk", marinePollutantPerPackage: perPackage(1, "L") })] }, null));
    expect(v.eligibility.blocks.map((b) => b.ruleId)).not.toContain("marine_pollutant_vessel_unknown");
    expect(marks(v)).not.toContain("MARINE_POLLUTANT");
  });

  it("marks the load when only SOME lines are excepted", () => {
    const v = evaluateLoad(load({
      vehicle: VAN2,
      lines: [
        line({ packagingKind: "non_bulk", marinePollutantPerPackage: perPackage(1, "L") }),
        line({ hmtRef: "UN3082-ehs#III", packagingKind: "non_bulk", marinePollutantPerPackage: null }),
      ],
    }, true));
    expect(marks(v)).toContain("MARINE_POLLUTANT");
  });
});

describe("§172.322(d)(1) — what it must never excuse", () => {
  /**
   * Asserted on the FLAG, not on the mark. Marking a bulk line is already guaranteed by the branch
   * structure — the exception is only consulted in the non-bulk path — so a test that checks the mark
   * passes whether or not the `!bulk` guard exists, and would have claimed to cover something it did
   * not. This reads the guard directly.
   */
  it("never sets the exception on a BULK line, which has no inner packaging and starts above 450 L", () => {
    const ds = { marinePollutants: [{ nameNormalized: "flammable liquid, n.o.s.", severe: false }] } as never;
    const bulkLine = { line: { hmtRef: "x", packagingKind: "bulk", marinePollutantPerPackage: perPackage(1, "L") }, entry: { psnPrinted: "Flammable liquid, n.o.s." } } as never;
    expect(findMarinePollutants([bulkLine], ds, false)[0]!.smallPackageExcepted).toBe(false);

    const nonBulk = { line: { hmtRef: "x", packagingKind: "non_bulk", marinePollutantPerPackage: perPackage(1, "L") }, entry: { psnPrinted: "Flammable liquid, n.o.s." } } as never;
    expect(findMarinePollutants([nonBulk], ds, false)[0]!.smallPackageExcepted).toBe(true);
  });

  it("a bulk marine pollutant is still marked, small per-package figure or not", () => {
    const v = evaluateLoad(load({ lines: [line({ packagingKind: "bulk", marinePollutantPerPackage: perPackage(1, "L") })] }, true));
    expect(marks(v)).toContain("MARINE_POLLUTANT");
  });

  it("never excepts a gas — (d)(1) has a liquid limb and a solid limb and no third one", () => {
    expect(smallPackageExcepted(perPackage(1, "L"), true)).toBe(false);
    expect(smallPackageExcepted(perPackage(1, "L"), false)).toBe(true);
  });

  it("treats a missing figure as no exception, never as zero", () => {
    expect(smallPackageExcepted(null, false)).toBe(false);
    expect(smallPackageExcepted(undefined, false)).toBe(false);
  });
});
