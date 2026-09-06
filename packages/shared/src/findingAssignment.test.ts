import { describe, it, expect } from "vitest";
import {
  FINDING_KINDS,
  FINDING_SECTIONS,
  sectionOfFinding,
  rolesThatManageFinding,
  rolesAssignableIn,
  type FindingKind,
} from "./findingAssignment.js";
import { FUEL_EXCEPTION_KINDS } from "./fuelSpend/exceptions.js";
import { CASE_RULE_ID } from "./anomalyRules/cases.js";
import { canViewSection, rolesThatManage } from "./auth.js";

describe("the section a finding belongs to", () => {
  it("covers every kind the inbox can hold, with nothing left to a page's gate", () => {
    expect(FINDING_KINDS).toHaveLength(FUEL_EXCEPTION_KINDS.length + 1);
    for (const kind of FINDING_KINDS) {
      expect(FINDING_SECTIONS[kind as FindingKind]).toBeDefined();
    }
  });

  // The reason Q-FUI4's recorded fallback could not be taken as written. `safety_manager` works the
  // theft queue on /anomalies today; a uniform `rolesThatManage("fuel")` gate would have removed
  // that when the surfaces merged, which is a narrowing nobody ruled on.
  it("keeps a theft case with safety and the money findings with fuel", () => {
    expect(sectionOfFinding(CASE_RULE_ID)).toBe("safety");
    for (const kind of FUEL_EXCEPTION_KINDS) expect(sectionOfFinding(kind)).toBe("fuel");
  });

  it("lets the safety manager close a theft case and no fuel finding", () => {
    expect(rolesThatManageFinding(CASE_RULE_ID)).toContain("safety_manager");
    expect(rolesThatManageFinding("off_network_premium")).not.toContain("safety_manager");
  });

  // Derived, not restated: the assertion is against SECTION_ACCESS itself, so a role that gains or
  // loses `manage` moves this without anybody editing a list.
  it("derives from the matrix rather than naming roles", () => {
    for (const kind of FINDING_KINDS) {
      expect(rolesThatManageFinding(kind as FindingKind)).toEqual(
        rolesThatManage(FINDING_SECTIONS[kind as FindingKind]),
      );
    }
  });

  it("offers exactly the people who could then close it", () => {
    for (const kind of FINDING_KINDS) {
      const section = sectionOfFinding(kind as FindingKind);
      expect(rolesAssignableIn(section)).toEqual(rolesThatManageFinding(kind as FindingKind));
    }
  });

  // Q-FUI15's reason for preferring this over a general org directory: nobody had to write
  // "except drivers" anywhere for a driver to be absent from every list.
  it("offers a driver nowhere, without naming drivers", () => {
    for (const kind of FINDING_KINDS) {
      expect(rolesThatManageFinding(kind as FindingKind)).not.toContain("driver");
    }
    // Through the public helpers only: the matrix itself is module-private on purpose, and a test
    // that reached into it would be asserting the shape rather than the derivation.
    expect(canViewSection("driver", "fuel")).toBe(false);
    expect(canViewSection("driver", "safety")).toBe(false);
  });
});
