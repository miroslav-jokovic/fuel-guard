import { describe, expect, it } from "vitest";
import { callerCanManage, callerCanView } from "./auth.js";
import { fileSectionFor } from "./fileSections.js";

describe("fileSectionFor (D-UF5)", () => {
  it("puts a truck's and a trailer's papers in equipment, and a driver's in roster", () => {
    expect(fileSectionFor("tractor", "registration")).toBe("equipment");
    expect(fileSectionFor("trailer", "lease")).toBe("equipment");
    expect(fileSectionFor("driver", "medical_card")).toBe("roster");
  });

  it("puts the fleet's insurance and IFTA on the organization in equipment, and every other organization paper in roster", () => {
    expect(fileSectionFor("organization", "insurance")).toBe("equipment");
    expect(fileSectionFor("organization", "ifta")).toBe("equipment");
    expect(fileSectionFor("organization", "phmsa_registration")).toBe("roster");
    expect(fileSectionFor("organization", null)).toBe("roster");
  });

  it("lets a technician read a truck's paper and not a driver's, and a recruiter the reverse — read from the matrix", () => {
    const can = (role: "technician" | "recruiter", subject: string) => callerCanView(role, fileSectionFor(subject, "other"), null);
    expect(can("technician", "tractor")).toBe(true);
    expect(can("technician", "driver")).toBe(false);
    expect(can("recruiter", "tractor")).toBe(false);
    expect(can("recruiter", "driver")).toBe(true);
  });

  it("lets a fleet manager file a trailer paper and keeps a safety manager, who only views equipment, from filing one", () => {
    expect(callerCanManage("fleet_manager", fileSectionFor("trailer", "registration"), null)).toBe(true);
    expect(callerCanManage("safety_manager", fileSectionFor("trailer", "registration"), null)).toBe(false);
    expect(callerCanManage("safety_manager", fileSectionFor("driver", "medical_card"), null)).toBe(true);
  });
});
