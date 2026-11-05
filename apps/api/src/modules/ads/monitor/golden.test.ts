import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMonitorScenarios, type MonitorScenario } from "@silvicom/ads-golden";
import { compareMonitor, runMonitorGolden } from "../../../testing/adsMonitorGolden.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { ORG } from "../../../testing/adsWorld.js";
import { simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";

/**
 * The monitor's golden scenarios (ADS-AGENT-BUILD-WORKFLOW.md §4R, the Monitor's L3 bar). The scenarios are data
 * in `@silvicom/ads-golden` (`scenarios/monitor/`); `testing/adsMonitorGolden.ts` runs each through the real pull,
 * checks and reconcile over the simulator. Expectations come from `monitorChecks.ts` and `adsReconcile.ts`.
 */

const loaded = loadMonitorScenarios();
const byFile = (f: string): MonitorScenario => loaded.find((l) => l.file === f)!.scenario;
let fake: FakeMeta;

beforeAll(async () => {
  fake = await simulatorFakeForTests();
});
afterAll(async () => stopSimulatorForTests());

describe("ads monitor golden scenarios — every one, through the real pull, checks and reconcile", () => {
  it.each(loaded.map((l) => [l.file, l.scenario] as const))("%s", async (file, scenario) => {
    const run = await runMonitorGolden(scenario, fake, file);
    expect(compareMonitor(scenario, run)).toEqual([]);
    expectOrgScoped(run.world.rec, ORG);
  });
});

describe("ads monitor golden — the checker is not vacuous", () => {
  it("a wrong state, a pause or flag or bell the scenario left out, and a failed job each fail", async () => {
    const good = byFile("daily-cap-at-its-threshold.yaml");
    const run = await runMonitorGolden(good, fake);
    expect(compareMonitor(good, run)).toEqual([]);
    const wrong: MonitorScenario = {
      ...good,
      expect: { ...good.expect, states: { ...good.expect.states, over: "live" }, pauses: good.expect.pauses.slice(1), flags: ["run 1: over campaign status ACTIVE -> PAUSED warning"], bell: [] },
    };
    const fields = compareMonitor(wrong, run).map((f) => f.field);
    expect(fields).toEqual(expect.arrayContaining(["states.over", "pauses", "flags", "bell"]));
    expect(compareMonitor(good, { ...run, failures: ["hourly 1: - graph:token_invalid"], metaWrites: 1 }).map((f) => f.field)).toEqual(["failures", "metaWrites"]);
  });

  it("a campaign that moved without a pause the scenario names fails", async () => {
    const good = byFile("daily-cap-at-its-threshold.yaml");
    const run = await runMonitorGolden(good, fake);
    expect(compareMonitor(good, { ...run, moves: { ...run.moves, under: 1 } }).map((f) => f.field)).toEqual(["moves.under"]);
  });
});

describe("ads monitor golden — the §4R Monitor row is covered", () => {
  // The bar's clauses, one tag each: every rule, the learning hold, and every field reconcile compares. A
  // scenario retired without a replacement leaves its tag uncovered and this fails.
  const REQUIRED = [
    "monthly_cap", "daily_cap", "no_lead_spend", "cpl_max", "frequency_max", "learning",
    "missing", "status", "daily_budget", "spend_cap", "overrun", "not_ours", "clean_run",
  ];

  it("every rule and every reconcile field has at least one scenario", () => {
    const covered = new Set(loaded.flatMap((l) => l.scenario.covers));
    expect(REQUIRED.filter((t) => !covered.has(t))).toEqual([]);
  });
});
