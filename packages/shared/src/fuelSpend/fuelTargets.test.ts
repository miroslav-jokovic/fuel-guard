import { describe, it, expect } from "vitest";
import {
  varianceToTarget,
  fuelPolicyFromSettings,
  DEFAULT_FUEL_POLICY,
  NO_FUEL_TARGETS,
} from "./policyExceptions.js";

/**
 * C8's contract half. D-FUI10: an exception count without a target is not a management number — but a
 * target the product invented is worse than none, so the assertions below are mostly about what does
 * NOT get defaulted, and about the one sign convention that stops a ceiling being read as a floor.
 */

describe("grading a figure against its target", () => {
  // A floor: more is better. Positive delta means met with room.
  it("grades a floor, with a positive delta when it is met", () => {
    expect(varianceToTarget(93, 90, "floor")).toEqual({ target: 90, actual: 93, delta: 3, met: true });
    expect(varianceToTarget(78, 90, "floor")).toEqual({ target: 90, actual: 78, delta: -12, met: false });
  });

  // A ceiling: LESS is better, and the delta keeps the same meaning rather than flipping. `actual -
  // target` would read as "good" for on-network share and "bad" for avoided-state gallons, and a
  // reader who forgot which they were looking at would get the colour backwards.
  it("grades a ceiling with the same sign convention, so positive always means good", () => {
    expect(varianceToTarget(400, 500, "ceiling")).toEqual({ target: 500, actual: 400, delta: 100, met: true });
    expect(varianceToTarget(650, 500, "ceiling")).toEqual({ target: 500, actual: 650, delta: -150, met: false });
  });

  it("counts exactly hitting the target as met, in both directions", () => {
    expect(varianceToTarget(90, 90, "floor")?.met).toBe(true);
    expect(varianceToTarget(500, 500, "ceiling")?.met).toBe(true);
  });

  // The ordinary case until somebody fills the form in. Null means "render as it rendered before
  // C8" — not zero, and emphatically not "missed".
  it("returns nothing when there is no target, rather than reporting a miss", () => {
    expect(varianceToTarget(78, null, "floor")).toBeNull();
    expect(varianceToTarget(78, undefined, "ceiling")).toBeNull();
  });

  it("returns nothing when the figure itself is unknown", () => {
    expect(varianceToTarget(null, 90, "floor")).toBeNull();
    expect(varianceToTarget(Number.NaN, 90, "floor")).toBeNull();
  });
});

describe("reading targets off the settings row", () => {
  // The distinction the mapper has to keep: for the LISTS, null means "never configured" and the
  // default applies. For a TARGET there is no default to apply, so null stays null.
  it("never invents a target for a carrier that has not set one", () => {
    expect(fuelPolicyFromSettings(null).targets).toEqual(NO_FUEL_TARGETS);
    expect(fuelPolicyFromSettings({}).targets).toEqual(NO_FUEL_TARGETS);
    expect(DEFAULT_FUEL_POLICY.targets).toEqual(NO_FUEL_TARGETS);
  });

  it("still applies the list defaults, so the two rules do not get confused for each other", () => {
    const p = fuelPolicyFromSettings({});
    expect(p.avoidStates).toEqual(DEFAULT_FUEL_POLICY.avoidStates);
    expect(p.targets.onNetworkPct).toBeNull();
  });

  // PostgREST returns `numeric` as a STRING. A target left as "90" compares false against every
  // number, so the figure would silently render ungraded rather than wrong — the quiet failure.
  it("coerces the numeric strings PostgREST returns", () => {
    const p = fuelPolicyFromSettings({
      target_on_network_pct: "90",
      target_discount_capture_pct: "75.5",
      target_avoided_state_gal: "500",
    });
    expect(p.targets).toEqual({ onNetworkPct: 90, discountCapturePct: 75.5, avoidedStateGal: 500 });
  });

  it("reads an unparseable or empty value as no target rather than as NaN", () => {
    const p = fuelPolicyFromSettings({ target_on_network_pct: "", target_avoided_state_gal: "abc" });
    expect(p.targets.onNetworkPct).toBeNull();
    expect(p.targets.avoidedStateGal).toBeNull();
  });

  it("keeps a target of zero, which is a real ceiling and not an unset one", () => {
    // "No gallons at all in an avoided state" is the strictest possible policy and a legal thing to
    // ask for. Falsy-checking the value would silently turn it into no target.
    expect(fuelPolicyFromSettings({ target_avoided_state_gal: 0 }).targets.avoidedStateGal).toBe(0);
  });
});
