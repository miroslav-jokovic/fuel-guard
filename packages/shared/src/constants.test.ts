import { describe, it, expect } from "vitest";
import {
  APP_NAME,
  DRIVER_STATUSES,
  EMPLOYED_DRIVER_STATUSES,
  MPG_FUEL_TYPES,
  RULE_IDS,
  USER_ROLES,
  isApplicantStatus,
  runAllRules,
} from "./index.js";

describe("shared constants", () => {
  it("exposes the app name", () => {
    expect(APP_NAME).toBe("Silvicom 360");
  });

  it("defines the eight user roles (incl. the department roles, the recruiter and the accountant)", () => {
    // The count is asserted on purpose: every role is a Postgres enum value that CANNOT be dropped
    // (no ALTER TYPE ... DROP VALUE), so adding one is a one-way door and should not pass unnoticed.
    expect(USER_ROLES).toHaveLength(8); // accountant added 2026-08-27 (0266, D-SEP7) — deliberately, one-way door and all
    expect(USER_ROLES).toContain("admin");
    expect(USER_ROLES).toContain("dispatcher");
    expect(USER_ROLES).toContain("safety_manager");
    expect(USER_ROLES).toContain("accountant");
    expect(USER_ROLES).toContain("recruiter");
  });

  /**
   * `applicant` is the state BEFORE employment, not a kind of employment (HIRING-PLAN.md D-HIRE5).
   * Every roster and headcount surface reads EMPLOYED_DRIVER_STATUSES rather than excluding it by
   * name, so the next status added is a decision somebody makes rather than a leak somebody finds.
   */
  it("separates the applicant from the employed statuses", () => {
    expect(DRIVER_STATUSES).toContain("applicant");
    expect(EMPLOYED_DRIVER_STATUSES).not.toContain("applicant");
    expect([...EMPLOYED_DRIVER_STATUSES].sort()).toEqual(["active", "inactive", "on_leave", "terminated"]);
    expect(isApplicantStatus("applicant")).toBe(true);
    expect(isApplicantStatus("active")).toBe(false);
    expect(isApplicantStatus(null)).toBe(false);
  });

  it("gates MPG rules to diesel + gasoline only (audit H1)", () => {
    expect(MPG_FUEL_TYPES).toEqual(["diesel", "gasoline"]);
  });

  it("declares all anomaly rule ids", () => {
    expect(RULE_IDS).toHaveLength(29);
    expect(RULE_IDS).toContain("reefer_exceeds_capacity");
    expect(RULE_IDS).toContain("reefer_overfuel_rate");
    expect(RULE_IDS).toContain("reefer_fuel_diversion");
    expect(RULE_IDS).toContain("fuel_while_driver_home");
    expect(RULE_IDS).toContain("odometer_entry_suspect");
  });
});

describe("runAllRules stub", () => {
  it("returns no anomalies until Phase 5 implements the rules", () => {
    const result = runAllRules({
      txn: {
        id: "t1",
        vehicleId: "v1",
        driverId: "d1",
        fueledAt: "2026-06-01T12:00:00Z",
        odometer: 1000,
        gallons: 50,
        pricePerGal: 3.9,
        totalCost: 195,
      },
      vehicle: { id: "v1", fuelType: "diesel", tankCapacityGal: 120, baselineMpg: 6.4 },
      previousTxn: null,
      recentTxns: [],
      thresholds: {
        mpgDropPct: 15,
        capacityTolerancePct: 5,
        rapidRefuelHours: 4,
        maxPlausibleMph: 85,
        costMinPerGal: null,
        costMaxPerGal: null,
        disabledRules: [],
      },
      operatingHours: { start: "05:00", end: "20:00", tz: "America/Chicago" },
    });
    expect(result).toEqual([]);
  });
});
