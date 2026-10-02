import { describe, expect, it } from "vitest";
import {
  behavesLike,
  declaredEquipment,
  longParkShares,
  needsEquipmentReview,
  purchaseBatchKey,
  purchaseBatchLabel,
} from "./idleEquipmentDeclared.js";

const m = (parks: number, idlingParks: number, offParks: number) => ({ parks, idlingParks, offParks });

describe("behavesLike — long-park evidence, calibrated 2026-10-02", () => {
  it("reads 723's 0% idling / 79% off as a battery APU", () => {
    expect(behavesLike(m(82, 0, 65))).toBe("battery_apu");
  });
  it("reads 506's 88% idling as no APU", () => {
    expect(behavesLike(m(41, 36, 4))).toBe("no_apu");
  });
  it("calls a driver who shuts down some nights mixed, not either equipment", () => {
    expect(behavesLike(m(50, 10, 25))).toBe("mixed");
  });
  it("holds the battery edge: exactly 10% idling and 60% off is a battery APU, one more idling park is not", () => {
    expect(behavesLike(m(10, 1, 6))).toBe("battery_apu");
    expect(behavesLike(m(10, 2, 6))).toBe("mixed");
  });
  it("needs engine-off as well as little idling to call it a battery APU", () => {
    expect(behavesLike(m(10, 0, 5))).toBe("mixed");
  });
  it("holds the no-APU edge at 30% idling", () => {
    expect(behavesLike(m(10, 3, 0))).toBe("no_apu");
    expect(behavesLike(m(100, 29, 0))).toBe("mixed");
  });
  it("says nothing below ten long parks — 720 and 721 had one each", () => {
    expect(behavesLike(m(9, 0, 9))).toBe("not_enough_parks");
    expect(behavesLike(m(0, 0, 0))).toBe("not_enough_parks");
  });
});

describe("longParkShares", () => {
  it("rounds to whole percent and is null with no parks", () => {
    expect(longParkShares(m(3, 1, 2))).toEqual({ idlingPct: 33, offPct: 67 });
    expect(longParkShares(m(0, 0, 0))).toEqual({ idlingPct: null, offPct: null });
  });
});

describe("declaredEquipment", () => {
  it("reads apu_type first, then has_apu", () => {
    expect(declaredEquipment({ hasApu: true, apuType: "battery_hvac" })).toBe("battery_apu");
    expect(declaredEquipment({ hasApu: false, apuType: "none" })).toBe("no_apu");
    expect(declaredEquipment({ hasApu: true, apuType: "shore_power" })).toBe("other");
    expect(declaredEquipment({ hasApu: false, apuType: null })).toBe("no_apu");
    expect(declaredEquipment({ hasApu: true, apuType: null })).toBe("other");
    expect(declaredEquipment({ hasApu: null, apuType: null })).toBe("not_entered");
  });
});

describe("needsEquipmentReview — evidence raises a review, never a value", () => {
  it("flags a declared battery APU that idles like a truck without one (728)", () => {
    expect(needsEquipmentReview("battery_apu", "no_apu")).toBe(true);
  });
  it("flags a declared no-APU truck that shuts down like a battery APU (719)", () => {
    expect(needsEquipmentReview("no_apu", "battery_apu")).toBe(true);
  });
  it("flags an undeclared truck once its behaviour is definite (722)", () => {
    expect(needsEquipmentReview("not_entered", "no_apu")).toBe(true);
    expect(needsEquipmentReview("not_entered", "mixed")).toBe(false);
  });
  it("is silent when they agree, when the evidence is mixed or thin, and for equipment the fleet does not have", () => {
    expect(needsEquipmentReview("battery_apu", "battery_apu")).toBe(false);
    expect(needsEquipmentReview("no_apu", "no_apu")).toBe(false);
    expect(needsEquipmentReview("no_apu", "mixed")).toBe(false);
    expect(needsEquipmentReview("battery_apu", "not_enough_parks")).toBe(false);
    expect(needsEquipmentReview("other", "no_apu")).toBe(false);
  });
});

describe("purchaseBatchKey — make + model + model year + purchase month (Q-IE7)", () => {
  const cascadia = { make: "Freightliner", model: "Cascadia", year: 2021 };
  it("puts one order delivered over two weeks in one batch", () => {
    const a = purchaseBatchKey({ ...cascadia, purchasedAt: "2020-12-10" });
    expect(a).toBe("Freightliner|Cascadia|2021|2020-12");
    expect(purchaseBatchKey({ ...cascadia, purchasedAt: "2020-12-24" })).toBe(a);
  });
  it("separates a different month, model year or model", () => {
    const a = purchaseBatchKey({ ...cascadia, purchasedAt: "2020-12-10" });
    expect(purchaseBatchKey({ ...cascadia, purchasedAt: "2020-11-24" })).not.toBe(a);
    expect(purchaseBatchKey({ ...cascadia, year: 2020, purchasedAt: "2020-12-10" })).not.toBe(a);
    expect(purchaseBatchKey({ ...cascadia, model: "LT625", purchasedAt: "2020-12-10" })).not.toBe(a);
  });
  it("gives an on-order unit no batch", () => {
    expect(purchaseBatchKey({ make: "International", model: "LT625", year: null, purchasedAt: null })).toBeNull();
    expect(purchaseBatchKey({ ...cascadia, purchasedAt: null })).toBeNull();
  });
  it("labels it in the page's words with an MM/YYYY month", () => {
    expect(purchaseBatchLabel("Freightliner|Cascadia|2021|2020-12")).toBe("Freightliner Cascadia 2021, bought 12/2020");
    expect(purchaseBatchLabel(null)).toBeNull();
  });
});
