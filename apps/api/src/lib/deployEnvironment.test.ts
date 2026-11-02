import { describe, expect, it } from "vitest";
import { simulatorGate } from "../modules/ads/platforms/simulatorGate.js";
import { FakeClock } from "../testing/fakeClock.js";
import { deployEnvironmentName, isPositivelyNonProduction } from "./deployEnvironment.js";
import { processHolderMeta } from "./schedulerLease.js";

describe("deployEnvironmentName — one expression, Railway first", () => {
  it("reads Railway's name, then AWS's, and null when neither is set or both are blank", () => {
    expect(deployEnvironmentName({ RAILWAY_ENVIRONMENT_NAME: "uat", DEPLOY_ENVIRONMENT: "production" })).toBe("uat");
    expect(deployEnvironmentName({ DEPLOY_ENVIRONMENT: "staging" })).toBe("staging");
    expect(deployEnvironmentName({})).toBeNull();
    expect(deployEnvironmentName({ DEPLOY_ENVIRONMENT: "  " })).toBeNull();
  });

  it("is what the scheduler lease's holder row records", () => {
    expect(processHolderMeta({ DEPLOY_ENVIRONMENT: "staging" }).environment).toBe("staging");
    expect(processHolderMeta({}).environment).toBeNull();
  });
});

describe("isPositivelyNonProduction / simulatorGate — fail closed", () => {
  const cases: Array<[string, Record<string, string>, boolean]> = [
    ["AWS staging (NODE_ENV is production there too)", { DEPLOY_ENVIRONMENT: "staging", NODE_ENV: "production" }, true],
    ["Railway uat", { RAILWAY_ENVIRONMENT_NAME: "uat", NODE_ENV: "production" }, true],
    ["a laptop", { NODE_ENV: "development" }, true],
    ["CI / tests", { NODE_ENV: "test" }, true],
    ["AWS production", { DEPLOY_ENVIRONMENT: "production", NODE_ENV: "production" }, false],
    ["Railway production", { RAILWAY_ENVIRONMENT_NAME: "production", NODE_ENV: "production" }, false],
    ["a name nobody listed", { DEPLOY_ENVIRONMENT: "preview-42", NODE_ENV: "development" }, false],
    ["a near miss", { DEPLOY_ENVIRONMENT: "Staging", NODE_ENV: "production" }, false],
    ["a built server with no name", { NODE_ENV: "production" }, false],
    ["Railway production beside a stray staging DEPLOY_ENVIRONMENT", { RAILWAY_ENVIRONMENT_NAME: "production", DEPLOY_ENVIRONMENT: "staging" }, false],
  ];
  it.each(cases)("%s", (_label, env, allowed) => {
    expect(isPositivelyNonProduction(env)).toBe(allowed);
    const gate = simulatorGate(env);
    expect(gate.allowed).toBe(allowed);
    if (!gate.allowed) expect(gate.reason).toMatch(/production/);
  });
});

describe("FakeClock", () => {
  it("moves only when told, by any unit, and hands out a bound now()", () => {
    const clock = new FakeClock("2026-11-30T23:00:00.000Z");
    const now = clock.now;
    expect(now().toISOString()).toBe("2026-11-30T23:00:00.000Z");
    clock.advance({ days: 1, hours: 2, minutes: 3, seconds: 4, ms: 5 });
    expect(now().toISOString()).toBe("2026-12-02T01:03:04.005Z");
  });

  it("refuses to go backwards", () => {
    const clock = new FakeClock();
    expect(() => clock.advance({ minutes: -1 })).toThrow(/backwards/);
    expect(() => clock.set("2026-11-01T00:00:00Z")).toThrow(/not at or after/);
    expect(() => new FakeClock("yesterday")).toThrow(/not an instant/);
  });
});
