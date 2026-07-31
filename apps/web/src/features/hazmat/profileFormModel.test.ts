import { describe, expect, it } from "vitest";
import type { HazmatCargoTankProfileRow } from "@fuelguard/shared";
import {
  buildCompartments,
  buildCreateProfileRequest,
  buildUpdateProfileRequest,
  emptyProfileForm,
  equipmentToken,
  parseEquipment,
  profileFormValid,
  profileRowToForm,
  type ProfileForm,
} from "./profileFormModel";

function formWith(overrides: Partial<ProfileForm> = {}): ProfileForm {
  return { ...emptyProfileForm(), ...overrides };
}

describe("profileFormModel — cargo-tank profile form logic (plan H5)", () => {
  it("parses equipment tokens into exactly-one bindings", () => {
    expect(parseEquipment("vehicle:v1")).toEqual({ vehicleId: "v1", trailerId: null });
    expect(parseEquipment("trailer:t1")).toEqual({ vehicleId: null, trailerId: "t1" });
    expect(parseEquipment("")).toBeNull();
    expect(parseEquipment("bogus")).toBeNull();
  });

  it("builds a create request with one binding + re-indexed compartments", () => {
    const form = formWith({
      equipment: "trailer:t1",
      cargoCapacityGal: "9200",
      compartments: [{ capacityGal: "2300" }, { capacityGal: "" }, { capacityGal: "2400" }],
    });
    const req = buildCreateProfileRequest("id-1", form);
    expect(req.vehicleId).toBeNull();
    expect(req.trailerId).toBe("t1");
    expect(req.cargoCapacityGal).toBe(9200);
    // The blank row is dropped and the rest re-indexed 1..N.
    expect(req.compartments).toEqual([
      { index: 1, capacityGal: 2300 },
      { index: 2, capacityGal: 2400 },
    ]);
  });

  it("blank capacity → null (not 0)", () => {
    expect(buildCreateProfileRequest("id", formWith({ equipment: "vehicle:v1" })).cargoCapacityGal).toBeNull();
    expect(buildUpdateProfileRequest(formWith({ cargoCapacityGal: "" })).cargoCapacityGal).toBeNull();
  });

  it("buildCompartments drops invalid rows and re-indexes", () => {
    expect(buildCompartments([{ capacityGal: "abc" }, { capacityGal: "100" }])).toEqual([{ index: 1, capacityGal: 100 }]);
  });

  it("profileFormValid requires equipment", () => {
    expect(profileFormValid(emptyProfileForm())).toBe(false);
    expect(profileFormValid(formWith({ equipment: "vehicle:v1" }))).toBe(true);
  });

  it("round-trips a row through the edit form", () => {
    const row: HazmatCargoTankProfileRow = {
      id: "p1", org_id: "o1", vehicle_id: null, trailer_id: "t9",
      cargo_capacity_gal: 8000, compartments: [{ index: 1, capacityGal: 4000 }, { index: 2, capacityGal: 4000 }],
      created_at: "2026-07-31T00:00:00Z", updated_at: "2026-07-31T00:00:00Z",
    };
    expect(equipmentToken(row)).toBe("trailer:t9");
    const form = profileRowToForm(row);
    expect(form.equipment).toBe("trailer:t9");
    expect(form.cargoCapacityGal).toBe("8000");
    expect(form.compartments).toEqual([{ capacityGal: "4000" }, { capacityGal: "4000" }]);
    // rebuilding preserves the compartments
    expect(buildUpdateProfileRequest(form).compartments).toHaveLength(2);
  });
});
