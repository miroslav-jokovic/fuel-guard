import { describe, expect, it } from "vitest";
import type { FileItemState } from "./fileEngine.js";
import { isRunningTruck, matchesVehicleCheck, paperStanding, seatedDriverIds, VEHICLE_CHECKS, VEHICLE_CHECK_LABELS } from "./fleetChecks.js";
import type { UnitFileCell } from "./unitFileContract.js";

const truck = (over: Partial<{ assigned_driver_id: string | null; winding_down: boolean | null }> = {}) => ({
  assigned_driver_id: "d1",
  ...over,
});
/** One item of a truck's file, as `/api/compliance/unit-files` serves it. */
const cell = (key: string, state: FileItemState, goodUntil: string | null, dateOnly: UnitFileCell["dateOnly"] = null): UnitFileCell => ({
  key, group: key === "registration" ? "registration" : "inspections", state, goodUntil, evidenceDate: null, expiryUnknown: false, dateOnly, paperOnFile: null, fleetWide: false, documentId: state === "missing" ? null : "doc-1",
});
const file = (...items: UnitFileCell[]) => ({ items });
const NOTHING = file(cell("registration", "missing", null), cell("annual_inspection", "missing", null));

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
    expect(matchesVehicleCheck(sold, "no_driver", undefined)).toBe(false);
    expect(matchesVehicleCheck(sold, "winding_down", undefined)).toBe(true);
    expect(matchesVehicleCheck(truck({ assigned_driver_id: null, winding_down: null }), "no_driver", undefined)).toBe(true);
    expect(matchesVehicleCheck(truck({ winding_down: null }), "winding_down", undefined)).toBe(false);
  });

  it("finds a truck nobody is assigned to", () => {
    expect(matchesVehicleCheck(truck({ assigned_driver_id: null }), "no_driver", undefined)).toBe(true);
    expect(matchesVehicleCheck(truck(), "no_driver", undefined)).toBe(false);
  });

  it("reads the filed paper's own state before McLeod's date (D-UF3)", () => {
    // McLeod still types last year's date; the new registration on file is good till next June.
    const renewed = file(cell("registration", "current", "2027-06-01"), cell("annual_inspection", "current", "2027-06-01"));
    expect(matchesVehicleCheck(truck(), "registration_overdue", renewed)).toBe(false);
    const lapsed = file(cell("registration", "expired", "2026-10-11"), cell("annual_inspection", "current", "2027-06-01"));
    expect(matchesVehicleCheck(truck(), "registration_overdue", lapsed)).toBe(true);
    expect(matchesVehicleCheck(truck(), "registration_date_only", lapsed)).toBe(false);
  });

  it("falls back to McLeod's date when no paper is filed, so the counts do not jump, and says it is date only", () => {
    const typed = file(
      cell("registration", "missing", null, { goodUntil: "2026-10-11", state: "expired" }),
      cell("annual_inspection", "missing", null, { goodUntil: "2026-10-20", state: "expiring" }),
    );
    expect(matchesVehicleCheck(truck(), "registration_overdue", typed)).toBe(true);
    expect(matchesVehicleCheck(truck(), "registration_missing", typed)).toBe(false);
    expect(matchesVehicleCheck(truck(), "registration_date_only", typed)).toBe(true);
    expect(matchesVehicleCheck(truck(), "inspection_due", typed)).toBe(true);
    expect(matchesVehicleCheck(truck(), "inspection_overdue", typed)).toBe(false);
  });

  it("counts no paper and no date as its own line, never as overdue or fine", () => {
    expect(matchesVehicleCheck(truck(), "inspection_missing", NOTHING)).toBe(true);
    expect(matchesVehicleCheck(truck(), "inspection_overdue", NOTHING)).toBe(false);
    expect(matchesVehicleCheck(truck(), "inspection_date_only", NOTHING)).toBe(false);
    expect(matchesVehicleCheck(truck(), "registration_missing", NOTHING)).toBe(true);
    expect(matchesVehicleCheck(truck(), "registration_due", NOTHING)).toBe(false);
  });

  it("keeps the two papers apart", () => {
    const lapsedPlate = file(cell("registration", "expired", "2026-01-01"), cell("annual_inspection", "current", "2027-06-01"));
    expect(matchesVehicleCheck(truck(), "registration_overdue", lapsedPlate)).toBe(true);
    expect(matchesVehicleCheck(truck(), "inspection_overdue", lapsedPlate)).toBe(false);
  });

  it("answers no to a paper check while the truck's file is not loaded, rather than guessing", () => {
    for (const c of VEHICLE_CHECKS.filter((k) => k.startsWith("inspection_") || k.startsWith("registration_"))) {
      expect(matchesVehicleCheck(truck(), c, undefined)).toBe(false);
    }
  });

  it("treats an unknown check as no filter, because it arrives from a URL", () => {
    expect(matchesVehicleCheck(truck(), "banana", NOTHING)).toBe(true);
    expect(matchesVehicleCheck(truck(), "registration_banana", NOTHING)).toBe(true);
  });

  it("labels every check", () => {
    for (const c of VEHICLE_CHECKS) expect(VEHICLE_CHECK_LABELS[c]).toBeTruthy();
  });
});

describe("paperStanding", () => {
  it("names which source answered", () => {
    expect(paperStanding(cell("registration", "expiring", "2026-10-30"))).toEqual({ goodUntil: "2026-10-30", state: "expiring", source: "paper" });
    expect(paperStanding(cell("registration", "missing", null, { goodUntil: "2027-01-01", state: "current" }))).toEqual({ goodUntil: "2027-01-01", state: "current", source: "date_only" });
    expect(paperStanding(cell("registration", "missing", null))).toEqual({ goodUntil: null, state: "missing", source: "none" });
    expect(paperStanding(undefined).source).toBe("none");
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
