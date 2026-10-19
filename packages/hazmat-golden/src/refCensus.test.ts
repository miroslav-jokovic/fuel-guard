import { describe, expect, it } from "vitest";
import { evaluateLoad, validateBol, type LoadInput } from "@hazmat/engine";
import { evaluateSafetyPermitApplicability, evaluateSecurityPlanApplicability, loadDataset, type Dataset } from "@hazmat/data";

/**
 * The ref census (READER-CORRECTNESS-PLAN RC1): the engine's and the dataset's answer for a product must not
 * depend on how its entry id is spelled. 81 entry ids of the shipped dataset hold a "#" (`UN1950-aerosols#2`),
 * the same character an `hmtRef` puts before its PG; until 2026-10-19 every reader split at the first one, and
 * UN1950 Division 2.1 (flammable) was placarded NON-FLAMMABLE GAS as its 2.2 sibling.
 *
 * Metamorphic, so no expectation is restated: the same dataset with every "#" in an id spelled "-hash-" is the
 * control, where a first-"#" split cannot go wrong. Every row of every such entry, at a bulk and a non-bulk
 * quantity, must give the same verdict, BOL description and permit/plan answer on both spellings.
 */
const dataset = loadDataset();
const MARK = "-hash-"; // in no id, name or note of the dataset (asserted below)
const control = JSON.parse(JSON.stringify(dataset).replace(/("entryId":"[^"]*)/g, (m) => m.replaceAll("#", MARK))) as Dataset;
const toControl = (entryId: string) => entryId.replaceAll("#", MARK);
const back = (v: unknown) => JSON.parse(JSON.stringify(v).replaceAll(MARK, "#"));

const hashed = dataset.entries.filter((e) => e.entryId.includes("#"));
const LOADS = [
  { packagingKind: "bulk" as const, quantity: { value: 6000, unit: "lb" as const }, grossWeightLb: 6000 },
  { packagingKind: "non_bulk" as const, quantity: { value: 1200, unit: "lb" as const }, grossWeightLb: 1200 },
  // A Limited Quantity claim reads the ref's PG row (column 8A), the one part of the ref the id does not carry.
  { packagingKind: "non_bulk" as const, quantity: { value: 100, unit: "lb" as const }, grossWeightLb: 100, packageCount: 10, isLimitedQuantity: true },
];

function load(ds: Dataset, hmtRef: string, l: (typeof LOADS)[number]): LoadInput {
  return {
    evaluatedAt: "2026-10-19T00:00:00Z",
    dataset: ds as unknown,
    vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
    tankState: "loaded",
    lines: [{ hmtRef, ...l }],
  } as unknown as LoadInput;
}

describe("the ref census — an entry id holding '#' resolves to itself everywhere (RC1)", () => {
  it("the control dataset renames every such id and nothing else", () => {
    expect(hashed.length).toBeGreaterThan(50);
    expect(JSON.stringify(dataset)).not.toContain(MARK);
    expect(new Set(control.entries.map((e) => e.entryId)).size).toBe(dataset.entries.length);
    expect(control.entries.filter((e) => e.entryId.includes("#"))).toEqual([]);
  });

  it("the engine's verdict and BOL description are the same on both spellings, for every row", () => {
    const differ: string[] = [];
    for (const e of hashed) {
      for (const row of e.pgRows) {
        const pg = row.pg ?? "none";
        for (const l of LOADS) {
          const real = load(dataset, `${e.entryId}#${pg}`, l);
          const ctrl = load(control, `${toControl(e.entryId)}#${pg}`, l);
          const verdict = (input: LoadInput) => { const v = evaluateLoad(input); return { placards: v.placards, notices: v.notices, segregation: v.segregation, eligibility: v.eligibility, bol: v.bol }; };
          if (JSON.stringify(verdict(real)) !== JSON.stringify(back(verdict(ctrl)))) differ.push(`verdict ${e.entryId}#${pg} ${l.packagingKind}`);
          if (JSON.stringify(validateBol(real)) !== JSON.stringify(back(validateBol(ctrl)))) differ.push(`bol ${e.entryId}#${pg} ${l.packagingKind}`);
        }
      }
    }
    expect(differ).toEqual([]);
  });

  it("the security-plan and safety-permit answers are the same on both spellings, for every row", () => {
    const differ: string[] = [];
    for (const e of hashed) {
      for (const row of e.pgRows) {
        const pg = row.pg ?? "none";
        for (const l of LOADS) {
          const line = (ref: string) => [{ hmtRef: ref, quantityValue: l.quantity.value, quantityUnit: l.quantity.unit, packagingKind: l.packagingKind }];
          const real = [evaluateSecurityPlanApplicability(dataset, line(`${e.entryId}#${pg}`)), evaluateSafetyPermitApplicability(dataset, line(`${e.entryId}#${pg}`))];
          const ctrl = [evaluateSecurityPlanApplicability(control, line(`${toControl(e.entryId)}#${pg}`)), evaluateSafetyPermitApplicability(control, line(`${toControl(e.entryId)}#${pg}`))];
          if (JSON.stringify(real) !== JSON.stringify(back(ctrl))) differ.push(`${e.entryId}#${pg} ${l.packagingKind}`);
        }
      }
    }
    expect(differ).toEqual([]);
  });
});
