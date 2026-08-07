import { describe, expect, it } from "vitest";
import { meDriverResponseSchema } from "./driverContract.js";
import { toModuleSet, moduleEnabled } from "./entitlements.js";

const driver = {
  id: "6e9c8a1e-1b2d-4c3e-9f4a-5b6c7d8e9f0a",
  full_name: "Aaron Cole",
  status: "active",
  employee_id: null,
  phone: null,
};

/**
 * Bootstrap contract (D55). The `modules` field is the regression this file exists for: the API
 * once dropped the org_modules read in a refactor and the contract's old `.default([])` masked it —
 * every driver parsed fine and saw zero modules. These tests pin the two properties that prevent a
 * recurrence: the field is REQUIRED (missing = loud parse failure, not an empty set), and the
 * resolved set only ever contains enabled, known keys.
 */
describe("meDriverResponseSchema — modules and features are required fields", () => {
  it("REJECTS a payload with no modules key (the exact shape the regressed API produced)", () => {
    const regressed = { driver, vehicles: [], features: [] };
    expect(meDriverResponseSchema.safeParse(regressed).success).toBe(false);
  });

  it("REJECTS a payload with no features key — same regression class, same loud failure", () => {
    const missingFeatures = { driver, vehicles: [], modules: [] };
    expect(meDriverResponseSchema.safeParse(missingFeatures).success).toBe(false);
  });

  it("accepts an explicit empty entitlement set (a tenant that bought nothing optional)", () => {
    const parsed = meDriverResponseSchema.parse({ driver, vehicles: [], modules: [], features: [] });
    expect(parsed.modules).toEqual([]);
    expect(parsed.features).toEqual([]);
  });

  it("carries module rows and resolved features through with their config", () => {
    const parsed = meDriverResponseSchema.parse({
      driver,
      vehicles: [],
      modules: [{ module_key: "hazmatguard", enabled: true, config: { maxPages: 10 } }],
      features: [{ key: "hazmat.capture", enabled: true, config: {} }],
    });
    expect(parsed.modules[0]?.module_key).toBe("hazmatguard");
    expect(parsed.modules[0]?.config).toEqual({ maxPages: 10 });
    expect(parsed.features[0]?.key).toBe("hazmat.capture");
  });
});

describe("toModuleSet over the bootstrap payload", () => {
  it("resolves only enabled, known keys — a disabled or unknown row grants nothing", () => {
    const set = toModuleSet([
      { module_key: "hazmatguard", enabled: true, config: {} },
      { module_key: "training", enabled: false, config: {} },
      { module_key: "not_a_real_module", enabled: true, config: {} },
    ]);
    expect(moduleEnabled(set, "hazmatguard")).toBe(true);
    expect(moduleEnabled(set, "training")).toBe(false);
    expect(set.size).toBe(1);
  });

  it("absent list = nothing enabled (never a silent grant)", () => {
    expect(moduleEnabled(toModuleSet(undefined), "hazmatguard")).toBe(false);
    expect(moduleEnabled(undefined, "hazmatguard")).toBe(false);
  });
});
