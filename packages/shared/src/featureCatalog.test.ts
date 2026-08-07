import { describe, expect, it } from "vitest";
import type { ModuleSet } from "./entitlements.js";
import {
  FEATURE_CATALOG,
  FEATURE_KEYS,
  featureEnabled,
  isVersionBelow,
  minAppVersion,
  odometerMode,
  resolveFeatures,
  takeoverAllowed,
  toFeatureMap,
} from "./featureCatalog.js";

const mods = (...keys: string[]): ModuleSet => new Set(keys) as ModuleSet;
const resolve = (
  modules: ModuleSet,
  org: Parameters<typeof resolveFeatures>[1] = [],
  over: Parameters<typeof resolveFeatures>[2] = [],
) => toFeatureMap(resolveFeatures(modules, org, over));

describe("resolveFeatures — the one resolution rule", () => {
  it("released core features default ON with no rows (empty table preserves today's behavior)", () => {
    const f = resolve(mods());
    expect(featureEnabled(f, "tab.score")).toBe(true);
    expect(featureEnabled(f, "duty.takeover")).toBe(true);
  });

  it("a module feature is OFF without the entitlement, regardless of org rows (prerequisite rule)", () => {
    const f = resolve(mods(), [{ feature_key: "hazmat.capture", enabled: true, config: {} }]);
    expect(featureEnabled(f, "hazmat.capture")).toBe(false);
  });

  it("entitled + default → ON; an explicit org row turns it off (D-PM1: hide Loads until ready)", () => {
    expect(featureEnabled(resolve(mods("hazmatguard")), "hazmat.capture")).toBe(true);
    const hidden = resolve(mods("dispatch"), [{ feature_key: "tab.loads", enabled: false, config: {} }]);
    expect(featureEnabled(hidden, "tab.loads")).toBe(false);
    expect(featureEnabled(resolve(mods("dispatch")), "tab.loads")).toBe(true);
  });

  it("a per-driver override narrows an org-enabled feature; it can never widen past the org/module gate", () => {
    const narrowed = resolve(mods("hazmatguard"), [], [{ feature_key: "hazmat.capture", enabled: false }]);
    expect(featureEnabled(narrowed, "hazmat.capture")).toBe(false);
    // Override says ON but the org row says OFF → stays OFF (enable-overrides don't bypass the org).
    const noWiden = resolve(
      mods("hazmatguard"),
      [{ feature_key: "hazmat.capture", enabled: false, config: {} }],
      [{ feature_key: "hazmat.capture", enabled: true }],
    );
    expect(featureEnabled(noWiden, "hazmat.capture")).toBe(false);
  });

  it("unreleased features resolve OFF even when entitled and org-enabled (D-PM5)", () => {
    const f = resolve(mods("navigation", "training"), [
      { feature_key: "nav.preview", enabled: true, config: {} },
      { feature_key: "training", enabled: true, config: {} },
    ]);
    expect(featureEnabled(f, "nav.preview")).toBe(false);
    expect(featureEnabled(f, "training")).toBe(false);
  });

  it("released module features (messages, notifications — Phases 6/7) resolve ON when entitled", () => {
    const f = resolve(mods("messages", "notifications"));
    expect(featureEnabled(f, "messages")).toBe(true);
    expect(featureEnabled(f, "notifications")).toBe(true);
    // …and OFF without the entitlement, as ever.
    expect(featureEnabled(resolve(mods()), "messages")).toBe(false);
  });

  it("unknown org/override keys are ignored; every catalog key is present in the output", () => {
    const out = resolveFeatures(mods(), [{ feature_key: "not_a_feature", enabled: true, config: {} }], [
      { feature_key: "also_fake", enabled: true },
    ]);
    expect(out.map((f) => f.key).sort()).toEqual([...FEATURE_KEYS].sort());
  });

  it("core.app is always enabled — the ops channel cannot be switched off, only configured", () => {
    const f = resolve(mods(), [{ feature_key: "core.app", enabled: false, config: { minVersion: "2.0.0" } }]);
    expect(featureEnabled(f, "core.app")).toBe(true);
    expect(minAppVersion(f)).toBe("2.0.0");
  });
});

describe("behavior-config readers (fail-safe on core surfaces)", () => {
  it("odometer: catalog default optional; org config drives it; disabled row = off; no data = optional", () => {
    expect(odometerMode(resolve(mods()))).toBe("optional");
    expect(
      odometerMode(resolve(mods(), [{ feature_key: "duty.odometer", enabled: true, config: { mode: "required" } }])),
    ).toBe("required");
    expect(
      odometerMode(resolve(mods(), [{ feature_key: "duty.odometer", enabled: false, config: {} }])),
    ).toBe("off");
    expect(odometerMode(undefined)).toBe("optional");
  });

  it("take-over: on by default and with no data (first boot must not break the duty flow)", () => {
    expect(takeoverAllowed(resolve(mods()))).toBe(true);
    expect(takeoverAllowed(undefined)).toBe(true);
    expect(
      takeoverAllowed(resolve(mods(), [{ feature_key: "duty.takeover", enabled: false, config: {} }])),
    ).toBe(false);
  });
});

describe("isVersionBelow (update gate, fails open on bad input)", () => {
  it("orders dotted numerics correctly", () => {
    expect(isVersionBelow("1.2.3", "1.2.4")).toBe(true);
    expect(isVersionBelow("1.2.3", "1.2.3")).toBe(false);
    expect(isVersionBelow("1.10.0", "1.9.0")).toBe(false);
    expect(isVersionBelow("2.0", "2.0.1")).toBe(true);
  });

  it("fails open on absent or malformed values — never lock a driver out on a parse bug", () => {
    expect(isVersionBelow(null, "1.0.0")).toBe(false);
    expect(isVersionBelow("1.0.0", null)).toBe(false);
    expect(isVersionBelow("abc", "1.0.0")).toBe(false); // malformed current → open
    expect(isVersionBelow("1.0.0", "latest")).toBe(false); // malformed min → open
  });
});

describe("catalog invariants (D-PM8 governance)", () => {
  it("every key has a def whose key matches, with label + description", () => {
    for (const key of FEATURE_KEYS) {
      const def = FEATURE_CATALOG[key];
      expect(def.key).toBe(key);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });
});
