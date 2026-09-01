import { describe, expect, it } from "vitest";
import {
  INSPECTION_GROUPS,
  INSPECTION_ITEMS,
  INSPECTION_ITEM_COUNT,
  INSPECTION_SUBJECT_TYPES,
  defaultInspectionItems,
  defaultInspectionResult,
  inspectionItem,
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

  describe("the sample the tractor column was transcribed from", () => {
    it("matches unit 654's report of 2026-06-16, mark for mark", () => {
      // Pinned against the real page rather than my transcription of it: if a default moves, this
      // says which one and against what.
      const sample: Record<string, string> = {
        "brake.electric": "na", "brake.hydraulic": "na", "brake.vacuum": "na",
        "coupling.fifth_wheel": "ok", "coupling.pintle_hooks": "na", "coupling.saddle_mounts": "na",
        "exhaust.bus_discharge": "na", "safe_loading.intermodal_securement": "na",
        "frame.adjustable_axle": "na", "tires.speed_restricted": "na",
        "wheels.lock_or_side_ring": "na", "wheels.welds": "na",
        "motorcoach_seats.secure": "na", "rear_impact_guard.present": "na",
        "windshield.glazing": "ok", "wipers.operable": "ok", "tires.steer_axle": "ok",
      };
      for (const [key, expected] of Object.entries(sample)) {
        expect(defaultInspectionResult(inspectionItem(key)!, "tractor"), key).toBe(expected);
      }
    });

    it("matches trailer 535968's report of 2026-08 on the steering group", () => {
      for (const item of INSPECTION_ITEMS.filter((i) => i.group === 7)) {
        expect(defaultInspectionResult(item, "trailer"), item.key).toBe("na");
        expect(defaultInspectionResult(item, "tractor"), item.key).toBe("ok");
      }
    });
  });

  describe("both default columns are transcribed from real filled forms", () => {
    it("gives every component an answer in all three columns", () => {
      for (const item of INSPECTION_ITEMS) {
        for (const col of ["tractor", "trailerReefer", "trailerDry"] as const) {
          expect(item.defaults[col], `${item.key}/${col}`).toMatch(/^(ok|needs_repair|na)$/);
        }
      }
    });

    it("differs on exactly the eighteen components the two forms differ on", () => {
      // Tractor 654 (2026-06-16) vs trailer 535968 (2026-08). If this number moves, somebody has
      // changed a default by hand rather than by measuring another form.
      const differing = INSPECTION_ITEMS.filter((i) => i.defaults.tractor !== i.defaults.trailerReefer);
      expect(differing).toHaveLength(18);
    });

    it("keeps the reefer surprises that reasoning would have got wrong", () => {
      // This is a REEFER fleet: a trailer has an engine and a fuel tank, so the office marks these
      // Ok. An earlier version inferred the trailer column from which parts a trailer "has" and was
      // wrong on all of them — the plan carried it as §6 Q6 until the second form turned up.
      for (const key of [
        "exhaust.no_leaks_at_cab", "exhaust.no_burn_risk",
        "fuel.no_visible_leak", "fuel.filler_cap", "fuel.tank_secure",
        "brake.air_compressor", "brake.tractor_protection_valve",
      ]) {
        expect(inspectionItem(key)!.defaults.trailerReefer, key).toBe("ok");
      }
    });

    it("and the ones that go the other way", () => {
      for (const key of ["coupling.drawbar_eye", "coupling.safety_devices", "coupling.fifth_wheel"]) {
        expect(inspectionItem(key)!.defaults.trailerReefer, key).toBe("na");
      }
      expect(inspectionItem("rear_impact_guard.present")!.defaults.trailerReefer).toBe("ok");
      expect(inspectionItem("frame.adjustable_axle")!.defaults.trailerReefer).toBe("ok");
      expect(inspectionItem("tires.steer_axle")!.defaults.trailerReefer).toBe("na");
    });
  });

  describe("a dry van is not a reefer, and the fleet is mostly not reefers", () => {
    it("opens a dry van's engine and fuel system on N/A", () => {
      // Measured 2026-08-31: 46 reefers, 13 dry vans and 152 with no type recorded, out of 211. The
      // sample form is a reefer, so applying it whole would open a dry van's exhaust and fuel on Ok
      // — an inspection of an engine and a tank it does not have.
      for (const key of ["exhaust.no_leaks_at_cab", "exhaust.no_burn_risk", "fuel.no_visible_leak", "fuel.filler_cap", "fuel.tank_secure"]) {
        expect(defaultInspectionResult(inspectionItem(key)!, "trailer", true), key).toBe("ok");
        expect(defaultInspectionResult(inspectionItem(key)!, "trailer", false), key).toBe("na");
      }
    });

    it("changes nothing else between the two kinds of trailer", () => {
      const moved = INSPECTION_ITEMS.filter((i) => i.defaults.trailerReefer !== i.defaults.trailerDry);
      expect(moved.map((i) => i.key).sort()).toEqual([
        "exhaust.no_burn_risk", "exhaust.no_leaks_at_cab",
        "fuel.filler_cap", "fuel.no_visible_leak", "fuel.tank_secure",
      ]);
    });

    it("treats anything that is not a known reefer as a dry van", () => {
      // The owner's rule: 46 reefers, everything else a dry van. The roster says exactly that —
      // `is_reefer` is 46 true, 165 false and never null — so there is no third state to guess at.
      for (const notAReefer of [false, undefined, null]) {
        expect(
          defaultInspectionResult(inspectionItem("fuel.tank_secure")!, "trailer", notAReefer),
          String(notAReefer),
        ).toBe("na");
      }
      expect(defaultInspectionResult(inspectionItem("fuel.tank_secure")!, "trailer", true)).toBe("ok");
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
