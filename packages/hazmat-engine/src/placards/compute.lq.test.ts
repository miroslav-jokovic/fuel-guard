import { describe, expect, it } from "vitest";
import { evaluateLoad } from "../index.js";
import type { LoadInput } from "../types.js";

/**
 * H-LQ (0.10.0) — the Limited Quantity gate. Sourced (research 2026-08-08, eCFR):
 *  · §172.500(b)(2): the placarding subpart does not apply to LQ identified per §172.203(b)/§172.315.
 *  · §173.150(b)/§173.155(b): 30 kg (66 lb) gross per package cap (the checkable half of the claim).
 *  · §172.315(a): the square-on-point LQ surface mark.
 * Fail-closed posture: any unverifiable or contradicted claim is REFUSED — the line stays fully
 * regulated and a conditional routes it to a reviewer. Refusal can only ever OVER-placard.
 */
const DATASET_WITH_8A = {
  version: "test-8a", provisional: false,
  entries: [
    {
      entryId: "UN1203-gasoline", psnPrinted: "Gasoline", hazardClass: "3", idPrefix: "UN", idNumber: "1203",
      pgRows: [{ pg: "II", exceptionsRef: "150" }],
    },
    {
      entryId: "UN1760-corrosive-liquid-n-o-s", psnPrinted: "Corrosive liquid, n.o.s.", hazardClass: "8", idPrefix: "UN", idNumber: "1760",
      pgRows: [{ pg: "II", exceptionsRef: "154" }],
    },
    {
      entryId: "UN9999-no-exceptions", psnPrinted: "No-exceptions material", hazardClass: "8", idPrefix: "UN", idNumber: "9999",
      pgRows: [{ pg: "II", exceptionsRef: null }], // column 8A prints "None"
    },
    {
      entryId: "UN1075-petroleum-gases-liquefied", psnPrinted: "Petroleum gases, liquefied", hazardClass: "2.1", idPrefix: "UN", idNumber: "1075",
      pgRows: [{ pg: null, exceptionsRef: "306" }],
    },
  ],
  placards: [
    { classOrDivision: "3", table: 2, placardName: "FLAMMABLE", designRef: "172.542", wordingOptions: [] },
    { classOrDivision: "8", table: 2, placardName: "CORROSIVE", designRef: "172.558", wordingOptions: [] },
    { classOrDivision: "2.1", table: 2, placardName: "FLAMMABLE GAS", designRef: "172.532", wordingOptions: [] },
  ],
  segregation: [{ rowClass: "3", colClass: "8", value: "O" }],
  erg: [{ idNumber: "1203", guideNumber: "128" }],
  hazSubstances: [], marinePollutants: [],
};

/** The SAME dataset minus column 8A — models every dataset cut before 2026.08.0. */
const DATASET_WITHOUT_8A = {
  ...DATASET_WITH_8A,
  version: "test-pre-8a",
  entries: DATASET_WITH_8A.entries.map((e) => ({
    ...e,
    pgRows: e.pgRows.map(({ exceptionsRef: _x, ...rest }) => rest),
  })),
};

const line = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  hmtRef: "UN1203-gasoline#II", reclassedCombustible: false, isLimitedQuantity: false,
  quantity: { value: 500, unit: "gal" }, grossWeightLb: 2000, compartmentIndex: null,
  isResidueLine: false, flashPointF: null, ethanolPct: null, packagingKind: "non_bulk", packageCount: 40,
  ...over,
});

const load = (lines: Record<string, unknown>[], dataset: unknown = DATASET_WITH_8A): LoadInput =>
  ({
    evaluatedAt: "2026-08-08T00:00:00Z",
    vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
    tankState: "loaded", lines,
    claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: [] },
    portContext: { vesselConnected: null, imdgPapers: null },
    tripContext: { previousOrCurrentBusinessDayIds: null, carrierRelationship: "unknown" },
    policy: null, dataset,
  }) as unknown as LoadInput;

const ruleIds = (v: ReturnType<typeof evaluateLoad>) => [...v.eligibility.blocks, ...v.segregation].map((f) => f.ruleId);

describe("H-LQ — accepted claims (§172.500(b)(2))", () => {
  it("an authorized LQ line takes NO placard, no aggregate, and gets the §172.315 mark — and can reach eligible", () => {
    // 40 packages × 50 lb = 2,000 lb gross: over 1,001 lb, so WITHOUT the LQ exception this load
    // placards FLAMMABLE. With it, the placarding subpart does not apply to the line at all.
    const v = evaluateLoad(load([line({ isLimitedQuantity: true })]));
    expect(v.placards.required.map((r) => r.placard)).not.toContain("FLAMMABLE");
    expect(v.placards.marks.map((m) => m.mark)).toContain("LIMITED_QUANTITY");
    // Info-tier compute findings are dropped from `blocks` by design (M5.2) — the acceptance is
    // asserted through the trace and the mark, and the ABSENCE of the refusal conditional.
    const gate = v.trace.filter((t) => t.ruleId === "lq_gate");
    expect(gate).toHaveLength(1);
    expect(gate[0]!.inputs.accepted).toBe(true);
    expect(ruleIds(v)).not.toContain("lq_claim_refused");
    expect(v.eligibility.status).toBe("eligible"); // info findings never block
  });

  it("mixed load: the LQ line leaves the aggregate — only the regular line's class placards", () => {
    const v = evaluateLoad(load([
      line({ isLimitedQuantity: true }), // 2,000 lb of LQ gasoline — excepted
      line({ hmtRef: "UN1760-corrosive-liquid-n-o-s#II", grossWeightLb: 1200, packageCount: 20 }), // regular, ≥1,001
    ]));
    const req = v.placards.required.map((r) => r.placard);
    expect(req).toContain("CORROSIVE");
    expect(req).not.toContain("FLAMMABLE");
    // No DANGEROUS option either — only ONE regular non-bulk category remains.
    expect(v.placards.optionalSubstitutions).toEqual([]);
  });

  it("the shipping paper must carry the §172.203(b) LQ notation", () => {
    const v = evaluateLoad(load([line({ isLimitedQuantity: true })]));
    expect(v.bol?.lines[0]?.additionalRequired.join(" ")).toMatch(/Limited Quantity/);
  });
});

describe("H-LQ — refused claims stay fully regulated (fail-closed)", () => {
  const expectRefused = (v: ReturnType<typeof evaluateLoad>, placard = "FLAMMABLE") => {
    expect(ruleIds(v)).toContain("lq_claim_refused");
    expect(v.placards.required.map((r) => r.placard)).toContain(placard); // placard STILL asserted
    expect(v.eligibility.status).toBe("not_checked"); // conditional blocks auto-clear
  };

  it("column 8A prints 'None' → not authorized", () => {
    expectRefused(evaluateLoad(load([line({ hmtRef: "UN9999-no-exceptions#II", isLimitedQuantity: true, grossWeightLb: 1200 })])), "CORROSIVE");
  });

  it("the dataset predates column 8A → cannot verify → refused", () => {
    expectRefused(evaluateLoad(load([line({ isLimitedQuantity: true })], DATASET_WITHOUT_8A)));
  });

  it("per-package gross over the 30 kg/66 lb cap → physically not an LQ package", () => {
    expectRefused(evaluateLoad(load([line({ isLimitedQuantity: true, grossWeightLb: 4000, packageCount: 10 })]))); // 400 lb each
  });

  it("bulk packaging → contradiction (LQ is non-bulk by definition)", () => {
    const v = evaluateLoad(load([line({ isLimitedQuantity: true, packagingKind: "bulk" })]));
    expect(ruleIds(v)).toContain("lq_claim_refused");
    expect(v.placards.required.map((r) => r.placard)).toContain("FLAMMABLE"); // bulk placards at any weight
  });

  it("a gas (§173.306 structure) → class not encoded → refused", () => {
    expectRefused(
      evaluateLoad(load([line({ hmtRef: "UN1075-petroleum-gases-liquefied#none", isLimitedQuantity: true, grossWeightLb: 1200 })])),
      "FLAMMABLE_GAS",
    );
  });

  it("no claim, no LQ machinery: the same load without the flag placards normally, no LQ findings", () => {
    const v = evaluateLoad(load([line()]));
    expect(v.placards.required.map((r) => r.placard)).toContain("FLAMMABLE");
    expect(ruleIds(v).filter((r) => r.startsWith("lq_"))).toEqual([]);
    expect(v.placards.marks.map((m) => m.mark)).not.toContain("LIMITED_QUANTITY");
  });
});
