import { describe, expect, it } from "vitest";
import {
  expandQualificationSeed,
  filterAgainstExisting,
  qualificationSeedSchema,
} from "./complianceSeed.js";

/** H-CS — the bulk seeding expander. Every output must be a shape the single-entry path accepts. */
const ORG = "11111111-1111-4111-8111-0000000000aa";
const DRIVER = "22222222-2222-4222-8222-0000000000bb";
let n = 0;
const makeId = () => `33333333-3333-4333-8333-${String(++n).padStart(12, "0")}`;

const seed = (over: Record<string, unknown> = {}) =>
  qualificationSeedSchema.parse({
    drivers: [{ driverId: DRIVER, cdlExpiresAt: "2028-05-01", medicalExpiresAt: "2027-02-01", endorsements: ["X"], trainingCompletedAt: "2026-06-01", trainingProviderName: "JJ Keller" }],
    org: { phmsaRegistrationExpiresAt: "2027-06-30", financialResponsibilityExpiresAt: "2027-01-01" },
    ...over,
  });

describe("expandQualificationSeed", () => {
  it("one full driver row → cdl + medical + endorsement + FOUR §172.704(a) training records", () => {
    const out = expandQualificationSeed(seed({ org: null }), ORG, makeId);
    const kinds = out.map((e) => e.request.kind);
    expect(kinds.filter((k) => k === "hazmat_training")).toHaveLength(4);
    const trainingTypes = new Set(out.filter((e) => e.request.kind === "hazmat_training").map((e) => e.request.trainingType));
    expect(trainingTypes).toEqual(new Set(["general_awareness", "function_specific", "safety", "security_awareness"]));
    expect(kinds).toContain("cdl");
    expect(kinds).toContain("medical_card");
    const endo = out.find((e) => e.request.kind === "endorsement")!;
    expect(endo.request.qualifier).toBe("X");
    expect(endo.request.expiresAt ?? null).toBeNull(); // §10.4 null rule — inherits the CDL expiry
    // Every training record satisfies the §172.704(d) fields the single-entry schema demands.
    for (const t of out.filter((e) => e.request.kind === "hazmat_training")) {
      expect(t.request.trainingProviderName).toBe("JJ Keller");
      expect(t.request.trainingCertified).toBe(true);
      expect(t.request.issuedAt).toBe("2026-06-01");
    }
  });

  it("blank fields seed NOTHING for that kind — never a guessed expiry", () => {
    const out = expandQualificationSeed(
      seed({ drivers: [{ driverId: DRIVER, medicalExpiresAt: "2027-02-01", endorsements: [] }], org: null }),
      ORG, makeId,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.request.kind).toBe("medical_card");
  });

  it("org half → phmsa_registration + financial_responsibility on the organization subject", () => {
    const out = expandQualificationSeed(seed({ drivers: [] }), ORG, makeId);
    expect(out.map((e) => [e.request.kind, e.request.subjectType, e.request.subjectId])).toEqual([
      ["phmsa_registration", "organization", ORG],
      ["financial_responsibility", "organization", ORG],
    ]);
  });

  it("training without a provider is rejected at the schema door (§172.704(d))", () => {
    expect(() =>
      qualificationSeedSchema.parse({ drivers: [{ driverId: DRIVER, trainingCompletedAt: "2026-06-01" }] }),
    ).toThrow(/provider/);
  });
});

describe("filterAgainstExisting (skipExisting)", () => {
  it("skips kinds the subject already holds — including per-letter endorsements and per-type training", () => {
    const out = expandQualificationSeed(seed({ org: null }), ORG, makeId);
    const existing = [
      { subject_type: "driver", subject_id: DRIVER, kind: "cdl", qualifier: null, training_type: null },
      { subject_type: "driver", subject_id: DRIVER, kind: "hazmat_training", qualifier: null, training_type: "safety" },
    ];
    const { toInsert, skipped } = filterAgainstExisting(out, existing);
    expect(skipped.map((e) => e.request.kind).sort()).toEqual(["cdl", "hazmat_training"]);
    expect(toInsert.map((e) => e.request.kind).filter((k) => k === "hazmat_training")).toHaveLength(3);
    // A held H endorsement would NOT skip the seeded X — different letters are different facts.
    const { toInsert: withH } = filterAgainstExisting(out, [
      { subject_type: "driver", subject_id: DRIVER, kind: "endorsement", qualifier: "H", training_type: null },
    ]);
    expect(withH.some((e) => e.request.kind === "endorsement" && e.request.qualifier === "X")).toBe(true);
  });
});
