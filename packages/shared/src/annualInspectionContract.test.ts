import { describe, expect, it } from "vitest";
import { INSPECTION_ITEMS, defaultInspectionItems } from "./annualInspectionCatalogue.js";
import {
  deriveInspectionOutcome,
  inspectionCreateSchema,
  inspectionDateSchema,
  nextInspectionDueDate,
  type InspectionItemAnswer,
} from "./annualInspectionContract.js";

const ON = "2026-06-16";

/** A complete, passing set of answers for a tractor — the baseline each case perturbs. */
const passing = (): InspectionItemAnswer[] =>
  defaultInspectionItems("tractor").map((s) => ({ key: s.key, result: s.result }));

const issueCodes = (r: ReturnType<typeof deriveInspectionOutcome>): string[] =>
  r.ok ? [] : r.issues.map((i) => i.code);

describe("deriveInspectionOutcome — D-AVI3, the certification nobody can type", () => {
  it("passes a vehicle whose every component is ok or na", () => {
    const r = deriveInspectionOutcome(passing(), "tractor", ON);
    expect(r.ok && r.outcome).toBe("pass");
    expect(r.ok && r.openDefects).toEqual([]);
  });

  it("fails on one unrepaired defect, and names it", () => {
    const answers = passing().map((a) =>
      a.key === "brake.hose" ? { ...a, result: "needs_repair" as const } : a,
    );
    const r = deriveInspectionOutcome(answers, "tractor", ON);
    expect(r.ok && r.outcome).toBe("fail");
    expect(r.ok && r.openDefects).toEqual(["brake.hose"]);
  });

  it("passes once that defect carries a repair date, and remembers it was one", () => {
    const answers = passing().map((a) =>
      a.key === "brake.hose" ? { ...a, result: "needs_repair" as const, repairedAt: "2026-06-17" } : a,
    );
    const r = deriveInspectionOutcome(answers, "tractor", ON);
    expect(r.ok && r.outcome).toBe("pass");
    expect(r.ok && r.repairedDefects).toEqual(["brake.hose"]);
    expect(r.ok && r.openDefects).toEqual([]);
  });

  it("repaired the same day counts — a defect found and fixed on the spot is repaired", () => {
    const answers = passing().map((a) =>
      a.key === "wheels.fasteners" ? { ...a, result: "needs_repair" as const, repairedAt: ON } : a,
    );
    const r = deriveInspectionOutcome(answers, "tractor", ON);
    expect(r.ok && r.outcome).toBe("pass");
  });

  it("refuses a repair dated before the inspection — that repair belongs to another visit", () => {
    const answers = passing().map((a) =>
      a.key === "brake.hose" ? { ...a, result: "needs_repair" as const, repairedAt: "2026-06-15" } : a,
    );
    expect(issueCodes(deriveInspectionOutcome(answers, "tractor", ON)))
      .toContain("repair_date_before_inspection");
  });

  it("refuses a repair date on a component that did not need repair", () => {
    const answers = passing().map((a) =>
      a.key === "brake.hose" ? { ...a, repairedAt: "2026-06-17" } : a,
    );
    expect(issueCodes(deriveInspectionOutcome(answers, "tractor", ON)))
      .toContain("repair_date_without_defect");
  });
});

describe("deriveInspectionOutcome — D-AVI5, a blank is not a result", () => {
  it("refuses a payload missing one component, and names the component", () => {
    const answers = passing().filter((a) => a.key !== "tires.steer_axle");
    const r = deriveInspectionOutcome(answers, "tractor", ON);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.issues).toContainEqual({
      code: "missing_result",
      itemKeys: ["tires.steer_axle"],
    });
  });

  it("refuses an empty payload rather than treating silence as na", () => {
    const r = deriveInspectionOutcome([], "tractor", ON);
    expect(r.ok).toBe(false);
    const missing = r.ok === false && r.issues.find((i) => i.code === "missing_result");
    expect(missing && missing.itemKeys).toHaveLength(INSPECTION_ITEMS.length);
  });

  it("refuses an item the catalogue does not know", () => {
    const answers = [...passing(), { key: "brake.warp_core", result: "ok" as const }];
    expect(issueCodes(deriveInspectionOutcome(answers, "tractor", ON))).toContain("unknown_item");
  });

  it("refuses the same component answered twice", () => {
    const answers = [...passing(), { key: "brake.hose", result: "needs_repair" as const }];
    expect(issueCodes(deriveInspectionOutcome(answers, "tractor", ON))).toContain("duplicate_item");
  });

  it("refuses to certify a part the equipment cannot have", () => {
    // A tractor's rear impact guard marked `ok` is a statement about something that is not there.
    const answers = passing().map((a) =>
      a.key === "rear_impact_guard.present" ? { ...a, result: "ok" as const } : a,
    );
    expect(issueCodes(deriveInspectionOutcome(answers, "tractor", ON)))
      .toContain("inapplicable_not_na");
  });

  it("reports every problem at once, so the inspector fixes the form in one pass", () => {
    const answers = passing()
      .filter((a) => a.key !== "brake.hose")
      .concat([{ key: "not.a.component", result: "ok" }]);
    const codes = issueCodes(deriveInspectionOutcome(answers, "tractor", ON));
    expect(codes).toContain("missing_result");
    expect(codes).toContain("unknown_item");
  });
});

describe("deriveInspectionOutcome — trailers are a different vehicle, not a flag", () => {
  it("passes a trailer whose rear impact guard is ok", () => {
    const answers = defaultInspectionItems("trailer").map((s) => ({ key: s.key, result: s.result }));
    const r = deriveInspectionOutcome(answers, "trailer", ON);
    expect(r.ok && r.outcome).toBe("pass");
  });

  it("fails a trailer on a missing rear impact guard — the item a tractor cannot even answer", () => {
    const answers = defaultInspectionItems("trailer").map((s) =>
      s.key === "rear_impact_guard.present"
        ? { key: s.key, result: "needs_repair" as const }
        : { key: s.key, result: s.result },
    );
    const r = deriveInspectionOutcome(answers, "trailer", ON);
    expect(r.ok && r.outcome).toBe("fail");
    expect(r.ok && r.openDefects).toEqual(["rear_impact_guard.present"]);
  });
});

describe("nextInspectionDueDate — §396.17(a), twelve months, no clock", () => {
  it("adds a year to the sample's date", () => {
    expect(nextInspectionDueDate("2026-06-16")).toBe("2027-06-16");
  });

  it("clamps 29 February rather than rolling into March", () => {
    expect(nextInspectionDueDate("2028-02-29")).toBe("2029-02-28");
  });

  it("keeps a 31-day month intact", () => {
    expect(nextInspectionDueDate("2026-01-31")).toBe("2027-01-31");
    expect(nextInspectionDueDate("2026-12-31")).toBe("2027-12-31");
  });

  it("is the strict reading — never later than a §396.23 end-of-month programme would allow", () => {
    const due = nextInspectionDueDate("2026-06-16");
    expect(due <= "2027-06-30").toBe(true);
  });
});

describe("inspectionDateSchema — a real calendar date, because the expiry rests on it", () => {
  it("accepts a real date", () => {
    expect(inspectionDateSchema.safeParse("2026-06-16").success).toBe(true);
    expect(inspectionDateSchema.safeParse("2028-02-29").success).toBe(true);
  });

  it("rejects a well-shaped date that does not exist", () => {
    expect(inspectionDateSchema.safeParse("2026-02-31").success).toBe(false);
    expect(inspectionDateSchema.safeParse("2026-13-01").success).toBe(false);
    expect(inspectionDateSchema.safeParse("2027-02-29").success).toBe(false);
  });

  it("rejects the shapes a date input actually posts when it goes wrong", () => {
    for (const bad of ["", "16/06/2026", "2026-6-16", "2026-06-16T00:00:00Z"]) {
      expect(inspectionDateSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("inspectionCreateSchema", () => {
  const valid = {
    id: "11111111-1111-4111-8111-111111111111",
    subjectType: "tractor",
    subjectId: "22222222-2222-4222-8222-222222222222",
    inspectorId: "33333333-3333-4333-8333-333333333333",
    inspectedOn: ON,
  };

  it("accepts a complete draft", () => {
    expect(inspectionCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a subject type the equipment tables do not have", () => {
    expect(inspectionCreateSchema.safeParse({ ...valid, subjectType: "driver" }).success).toBe(false);
  });

  it("requires a client-generated id, so a retried submit cannot create a second report", () => {
    const { id: _drop, ...withoutId } = valid;
    expect(inspectionCreateSchema.safeParse(withoutId).success).toBe(false);
  });
});
