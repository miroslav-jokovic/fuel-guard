import { describe, it, expect } from "vitest";
import {
  ROAD_TEST_ITEMS,
  ROAD_TEST_ITEM_KEYS,
  roadTestPassed,
  roadTestRecordSchema,
  validateRoadTest,
  type RoadTestRecord,
} from "./roadTestContract.js";

/**
 * D2's form. ⚠ The carrier's six lines are pinned VERBATIM, typo included (D-PKT11), and the three
 * §391.31(c) adds are pinned by key (Q-RT1) — a change to either is a change to the carrier's paper.
 */
const all = (r: string) => Object.fromEntries(ROAD_TEST_ITEM_KEYS.map((k) => [k, r])) as RoadTestRecord["items"];
const base: RoadTestRecord = {
  examiner_id: "00000000-0000-4000-8000-000000000001", vehicle_id: "00000000-0000-4000-8000-000000000002",
  trailer_type: "dry_van", tested_on: "2026-09-20", miles: 15, items: all("satisfactory"),
  general_performance: "satisfactory", remarks: null, qualified_for: null,
};

describe("the items (Q-RT1)", () => {
  it("are the three §391.31(c) adds, then the carrier's six exactly as printed", () => {
    expect(ROAD_TEST_ITEMS.filter((i) => i.source === "added").map((i) => i.key))
      .toEqual(["pretrip_inspection", "placing_in_operation", "coupling_uncoupling"]);
    expect(ROAD_TEST_ITEMS.filter((i) => i.source === "carrier").map((i) => i.text)).toEqual([
      "Operating the vehicle in street traffic and while passing other vehicles.",
      "Operating the vehicle in HWY traffic and while passing other vehicles.",
      "Use of vehicle’s controls and emergency equipment.",
      "Turning the vehicle.",
      "Braking and slowing the vehicle by means other than breaking.",
      "Backing and parking the vehicles.",
    ]);
  });
});

describe("the pass rule", () => {
  it("passes only when every item AND the general performance are Satisfactory", () => {
    expect(roadTestPassed(base)).toBe(true);
    expect(roadTestPassed({ ...base, general_performance: "needs_training" })).toBe(false);
    for (const key of ROAD_TEST_ITEM_KEYS) {
      expect(roadTestPassed({ ...base, items: { ...base.items, [key]: "needs_training" } }), key).toBe(false);
    }
  });
});

describe("what a record must carry", () => {
  it("refuses a record missing an item, at the door", () => {
    const { pretrip_inspection: _drop, ...rest } = base.items;
    expect(roadTestRecordSchema.safeParse({ ...base, items: rest }).success).toBe(false);
  });

  it("refuses a trailer the fleet does not run (Q-RT4)", () => {
    expect(roadTestRecordSchema.safeParse({ ...base, trailer_type: "tanker" }).success).toBe(false);
  });

  it("refuses a future date and a mistyped year", () => {
    expect(validateRoadTest({ ...base, tested_on: "2026-09-26" }, "2026-09-25")).toHaveLength(1);
    expect(validateRoadTest({ ...base, tested_on: "1026-09-20" }, "2026-09-25")).toHaveLength(1);
    expect(validateRoadTest(base, "2026-09-25")).toEqual([]);
  });
});
