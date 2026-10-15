import { describe, expect, it } from "vitest";
import { INSPECTION_EXPIRY_WARNING_DAYS } from "./annualInspectionContract.js";
import { isRunningTruck, matchesVehicleCheck, seatedDriverIds, VEHICLE_CHECKS, VEHICLE_CHECK_LABELS } from "./fleetChecks.js";

const TODAY = "2026-10-12";
const truck = (over: Partial<{ assigned_driver_id: string | null; dot_annual_inspection_expires_at: string | null; registration_expires_at: string | null; winding_down: boolean | null }> = {}) => ({
  assigned_driver_id: "d1",
  dot_annual_inspection_expires_at: "2027-06-01",
  registration_expires_at: "2027-06-01",
  ...over,
});

describe("isRunningTruck", () => {
  it("is an active truck McLeod is not winding down — silence counts as running", () => {
    expect(isRunningTruck({ status: "active", winding_down: null })).toBe(true);
    expect(isRunningTruck({ status: "active" })).toBe(true);
    expect(isRunningTruck({ status: "active", winding_down: false })).toBe(true);
    expect(isRunningTruck({ status: "active", winding_down: true })).toBe(false);
    expect(isRunningTruck({ status: "maintenance", winding_down: false })).toBe(false);
    expect(isRunningTruck({ status: "ordered" })).toBe(false);
  });
});

describe("matchesVehicleCheck", () => {
  it("does not call a truck being wound down a truck without a driver; it has its own check", () => {
    const sold = truck({ assigned_driver_id: null, winding_down: true });
    expect(matchesVehicleCheck(sold, "no_driver", TODAY)).toBe(false);
    expect(matchesVehicleCheck(sold, "winding_down", TODAY)).toBe(true);
    expect(matchesVehicleCheck(truck({ assigned_driver_id: null, winding_down: null }), "no_driver", TODAY)).toBe(true);
    expect(matchesVehicleCheck(truck({ winding_down: null }), "winding_down", TODAY)).toBe(false);
  });

  it("finds a truck nobody is assigned to", () => {
    expect(matchesVehicleCheck(truck({ assigned_driver_id: null }), "no_driver", TODAY)).toBe(true);
    expect(matchesVehicleCheck(truck(), "no_driver", TODAY)).toBe(false);
  });

  it("calls yesterday overdue and today due, on calendar days", () => {
    expect(matchesVehicleCheck(truck({ registration_expires_at: "2026-10-11" }), "registration_overdue", TODAY)).toBe(true);
    expect(matchesVehicleCheck(truck({ registration_expires_at: "2026-10-12" }), "registration_overdue", TODAY)).toBe(false);
    expect(matchesVehicleCheck(truck({ registration_expires_at: "2026-10-12" }), "registration_due", TODAY)).toBe(true);
  });

  it("uses the equipment window inspectionExpiry uses, and not one of its own", () => {
    // The last day inside the window is due; the day after is current. Moving the constant moves both.
    const edge = new Date(Date.UTC(2026, 9, 12 + INSPECTION_EXPIRY_WARNING_DAYS)).toISOString().slice(0, 10);
    const after = new Date(Date.UTC(2026, 9, 13 + INSPECTION_EXPIRY_WARNING_DAYS)).toISOString().slice(0, 10);
    expect(matchesVehicleCheck(truck({ dot_annual_inspection_expires_at: edge }), "inspection_due", TODAY)).toBe(true);
    expect(matchesVehicleCheck(truck({ dot_annual_inspection_expires_at: after }), "inspection_due", TODAY)).toBe(false);
  });

  it("counts a missing date as not on file, never as overdue or fine", () => {
    const blank = truck({ dot_annual_inspection_expires_at: null, registration_expires_at: null });
    expect(matchesVehicleCheck(blank, "inspection_missing", TODAY)).toBe(true);
    expect(matchesVehicleCheck(blank, "inspection_overdue", TODAY)).toBe(false);
    expect(matchesVehicleCheck(blank, "registration_missing", TODAY)).toBe(true);
    expect(matchesVehicleCheck(blank, "registration_due", TODAY)).toBe(false);
  });

  it("keeps the two papers apart", () => {
    const lapsedPlate = truck({ registration_expires_at: "2026-01-01" });
    expect(matchesVehicleCheck(lapsedPlate, "registration_overdue", TODAY)).toBe(true);
    expect(matchesVehicleCheck(lapsedPlate, "inspection_overdue", TODAY)).toBe(false);
  });

  it("treats an unknown check as no filter, because it arrives from a URL", () => {
    expect(matchesVehicleCheck(truck(), "banana", TODAY)).toBe(true);
  });

  it("labels every check", () => {
    for (const c of VEHICLE_CHECKS) expect(VEHICLE_CHECK_LABELS[c]).toBeTruthy();
  });
});

describe("seatedDriverIds", () => {
  it("names drivers on any truck that is not retired, and not the last driver of a retired one", () => {
    const ids = seatedDriverIds([
      { assigned_driver_id: "a", status: "active" },
      { assigned_driver_id: "b", status: "maintenance" },
      { assigned_driver_id: "c", status: "retired" },
      { assigned_driver_id: null, status: "active" },
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });

  it("counts a team's second driver as holding the truck, but not on a retired one", () => {
    const ids = seatedDriverIds([
      { assigned_driver_id: "feagin", co_driver_id: "sital", status: "active" },
      { assigned_driver_id: null, co_driver_id: "gone", status: "retired" },
    ]);
    expect([...ids].sort()).toEqual(["feagin", "sital"]);
  });
});
