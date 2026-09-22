import { describe, it, expect } from "vitest";
import {
  IN_SERVICE_VEHICLE_STATUSES,
  isInServiceVehicleStatus,
  VEHICLE_STATUSES,
  APP_NAME,
  DRIVER_STATUSES,
  EMPLOYED_DRIVER_STATUSES,
  MPG_FUEL_TYPES,
  RULE_IDS,
  USER_ROLES,
  USER_ROLE_LABELS,
  isApplicantStatus,
  runAllRules,
} from "./index.js";

describe("shared constants", () => {
  it("exposes the app name", () => {
    expect(APP_NAME).toBe("Silvicom 360");
  });

  it("defines the nine user roles (incl. the department roles, recruiter, accountant and technician)", () => {
    // The count is asserted on purpose: every role is a Postgres enum value that CANNOT be dropped
    // (no ALTER TYPE ... DROP VALUE), so adding one is a one-way door and should not pass unnoticed.
    expect(USER_ROLES).toHaveLength(9); // accountant 2026-08-27 (0266, D-SEP7); technician 2026-08-31 (0279, D-AVI11) — both one-way doors
    expect(USER_ROLES).toContain("admin");
    expect(USER_ROLES).toContain("dispatcher");
    expect(USER_ROLES).toContain("safety_manager");
    expect(USER_ROLES).toContain("accountant");
    expect(USER_ROLES).toContain("recruiter");
    expect(USER_ROLES).toContain("technician");
  });

  it("gives every role a picker label — an unlabelled role is invisible to whoever assigns it", () => {
    for (const role of USER_ROLES) {
      expect(USER_ROLE_LABELS[role], role).toBeTruthy();
    }
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

/**
 * The vocabulary, not a spelling of it. `vehicle_status` gained `ordered` in 0353 and had carried
 * `maintenance` since 0001 without a single row ever holding one, so both literal spellings in the
 * product were already wrong in opposite directions — `= "active"` dropping shop trucks out of the
 * §396.17 inspection roster, `!== "retired"` admitting 53 trucks the carrier has not taken delivery
 * of into the idle denominators (D-FC11).
 */
describe("IN_SERVICE_VEHICLE_STATUSES", () => {
  it("counts a truck in the shop as part of the operating fleet", () => {
    // The whole reason the predicate is not `= "active"`: a shop truck is inspected, insured,
    // financed and counted. 12 of this carrier's trucks sit here.
    expect(IN_SERVICE_VEHICLE_STATUSES).toContain("maintenance");
    expect(isInServiceVehicleStatus("maintenance")).toBe(true);
  });

  it("excludes both ends — not yet delivered, and gone", () => {
    expect(IN_SERVICE_VEHICLE_STATUSES).not.toContain("ordered");
    expect(IN_SERVICE_VEHICLE_STATUSES).not.toContain("retired");
    expect(isInServiceVehicleStatus("ordered")).toBe(false);
    expect(isInServiceVehicleStatus("retired")).toBe(false);
  });

  it("is derived from the enum, so a value added later is a decision and not a leak", () => {
    // Pins the INCLUSION property rather than the current membership: were this rewritten as an
    // exclusion (`s !== "retired"`), `ordered` would silently rejoin — which is exactly the failure
    // EMPLOYED_DRIVER_STATUSES records for FleetReadiness, and exactly what 53 rows were about to do.
    for (const s of IN_SERVICE_VEHICLE_STATUSES) expect(VEHICLE_STATUSES).toContain(s);
    expect(IN_SERVICE_VEHICLE_STATUSES.length).toBe(VEHICLE_STATUSES.length - 2);
  });

  it("refuses a status it has never heard of, and null", () => {
    expect(isInServiceVehicleStatus("in_shop")).toBe(false);
    expect(isInServiceVehicleStatus(null)).toBe(false);
    expect(isInServiceVehicleStatus(undefined)).toBe(false);
  });
});
