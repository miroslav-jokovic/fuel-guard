import { describe, expect, it } from "vitest";
import {
  INSPECTION_GROUPS,
  INSPECTION_ITEMS,
  INSPECTION_ITEM_COUNT,
  INSPECTION_SUBJECT_TYPES,
  defaultInspectionItems,
  defaultInspectionResult,
  inspectionItem,
  isInspectionItemApplicable,
} from "./annualInspectionCatalogue.js";

describe("annual inspection catalogue", () => {
  it("has 56 components — the sample's 57th mark is a stray on a wrapped label", () => {
    expect(INSPECTION_ITEM_COUNT).toBe(56);
  });

  it("keys are unique, because a report is a map from key to result", () => {
    const keys = INSPECTION_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every item cites the regulation it comes from", () => {
    for (const item of INSPECTION_ITEMS) {
      expect(item.cfr, item.key).toMatch(/App\. A ¶\d+/);
    }
  });

  it("every item belongs to one of the fifteen Appendix A groups", () => {
    const numbers = new Set(INSPECTION_GROUPS.map((g) => g.number));
    expect(numbers.size).toBe(15);
    for (const item of INSPECTION_ITEMS) expect(numbers.has(item.group), item.key).toBe(true);
  });

  it("items are in printed order — group numbers never go backwards", () => {
    const groups = INSPECTION_ITEMS.map((i) => i.group);
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
  });

  it("every group has at least one item, so no printed section is unanswerable", () => {
    for (const g of INSPECTION_GROUPS) {
      expect(INSPECTION_ITEMS.some((i) => i.group === g.number), `group ${g.number}`).toBe(true);
    }
  });

  it("a fleetDefault is only ever declared for a subject the item applies to", () => {
    // Otherwise the catalogue would carry an editable default for something that is locked `na`,
    // which reads as a decision and is in fact dead data.
    for (const item of INSPECTION_ITEMS) {
      for (const subject of INSPECTION_SUBJECT_TYPES) {
        if (item.fleetDefault?.[subject] !== undefined) {
          expect(isInspectionItemApplicable(item, subject), `${item.key}/${subject}`).toBe(true);
        }
      }
    }
  });

  describe("applicability DEFAULTS the answer, it does not lock it (owner ruling, 2026-08-31)", () => {
    it("opens a tractor's rear impact guard on na and a trailer's on ok", () => {
      const guard = inspectionItem("rear_impact_guard.present")!;
      expect(defaultInspectionResult(guard, "tractor")).toBe("na");
      expect(defaultInspectionResult(guard, "trailer")).toBe("ok");
    });

    it("opens the power-unit items na on a trailer — the same form, different marks", () => {
      // Truck and trailer share one form and one decal; the difference is the unit number and which
      // boxes are marked. So these OPEN as N/A rather than being unanswerable.
      for (const key of ["coupling.fifth_wheel", "steering.wheel_free_play", "windshield.glazing"]) {
        expect(defaultInspectionResult(inspectionItem(key)!, "trailer"), key).toBe("na");
      }
    });

    it("opens motorcoach seats na on both — a trucking carrier operates neither", () => {
      const seats = inspectionItem("motorcoach_seats.secure")!;
      for (const subject of INSPECTION_SUBJECT_TYPES) {
        expect(defaultInspectionResult(seats, subject), subject).toBe("na");
      }
    });

    it("still records which items normally exist where, because the default reads it", () => {
      expect(isInspectionItemApplicable(inspectionItem("coupling.fifth_wheel")!, "tractor")).toBe(true);
      expect(isInspectionItemApplicable(inspectionItem("coupling.fifth_wheel")!, "trailer")).toBe(false);
    });
  });

  describe("fleetDefault is the editable kind of na", () => {
    it("opens hydraulic and vacuum brakes na on air-braked equipment, but leaves them editable", () => {
      for (const key of ["brake.hydraulic", "brake.vacuum", "brake.electric"]) {
        const item = inspectionItem(key)!;
        expect(defaultInspectionResult(item, "tractor"), key).toBe("na");
        // Editable: a future unit with hydraulic brakes must be answerable.
        expect(isInspectionItemApplicable(item, "tractor"), key).toBe(true);
      }
    });

    it("opens sliding subframes na on a tractor and ok on a trailer", () => {
      const axle = inspectionItem("frame.adjustable_axle")!;
      expect(defaultInspectionResult(axle, "tractor")).toBe("na");
      expect(defaultInspectionResult(axle, "trailer")).toBe("ok");
    });
  });

  describe("defaultInspectionItems seeds a complete draft (D-AVI13)", () => {
    for (const subject of INSPECTION_SUBJECT_TYPES) {
      it(`covers every component for a ${subject}, with nothing missing and nothing extra`, () => {
        const seeded = defaultInspectionItems(subject);
        expect(seeded).toHaveLength(INSPECTION_ITEM_COUNT);
        expect(seeded.map((s) => s.key)).toEqual(INSPECTION_ITEMS.map((i) => i.key));
      });
    }

    it("matches the filled sample the office produced for tractor 654 on 2026-06-16", () => {
      // The 26 marks in the form's left column, read off the measured coordinates in the plan's §1.
      const seeded = new Map(defaultInspectionItems("tractor").map((s) => [s.key, s.result]));
      const sample: Record<string, string> = {
        "brake.service_brakes": "ok", "brake.parking_system": "ok", "brake.drums_rotors": "ok",
        "brake.hose": "ok", "brake.tubing": "ok", "brake.low_pressure_warning": "ok",
        "brake.tractor_protection_valve": "ok", "brake.air_compressor": "ok",
        "brake.electric": "na", "brake.hydraulic": "na", "brake.vacuum": "na",
        "brake.antilock": "ok", "brake.automatic_adjusters": "ok",
        "coupling.fifth_wheel": "ok", "coupling.pintle_hooks": "na", "coupling.drawbar_eye": "ok",
        "coupling.drawbar_tongue": "na", "coupling.safety_devices": "ok", "coupling.saddle_mounts": "na",
        "exhaust.no_leaks_at_cab": "ok", "exhaust.bus_discharge": "na", "exhaust.no_burn_risk": "ok",
        "fuel.no_visible_leak": "ok", "fuel.filler_cap": "ok", "fuel.tank_secure": "ok",
        "lighting.all_operable": "ok",
        "safe_loading.parts_secured": "ok", "safe_loading.front_end_structure": "ok",
        "safe_loading.intermodal_securement": "na",
        "suspension.axle_positioning": "ok", "suspension.spring_assembly": "ok",
        "suspension.torque_radius_tracking": "ok",
        "frame.members": "ok", "frame.tire_wheel_clearance": "ok", "frame.adjustable_axle": "na",
        "tires.steer_axle": "ok", "tires.all_other": "ok", "tires.speed_restricted": "na",
        "wheels.lock_or_side_ring": "na", "wheels.wheels_and_rims": "ok", "wheels.fasteners": "ok",
        "wheels.welds": "na",
        "windshield.glazing": "ok", "wipers.operable": "ok",
        "motorcoach_seats.secure": "na", "rear_impact_guard.present": "na",
      };
      for (const [key, expected] of Object.entries(sample)) {
        expect(seeded.get(key), key).toBe(expected);
      }
      // Every steering component the sample marked ok.
      for (const item of INSPECTION_ITEMS.filter((i) => i.group === 7)) {
        expect(seeded.get(item.key), item.key).toBe("ok");
      }
    });
  });
});
