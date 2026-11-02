import { describe, expect, it } from "vitest";
import { loadScenarios, type GoldenScenario } from "@silvicom/ads-golden";
import { compareGolden, runGolden, type GoldenRun } from "../../../testing/adsGolden.js";

/**
 * The orchestrator's golden scenarios (step 7d; ADS-AGENT-BUILD-WORKFLOW.md §4R — the Orchestrator's
 * L2 faults and its L3 bar "golden scenarios green"). The scenarios are data in `@silvicom/ads-golden`;
 * `testing/adsGolden.ts` runs each through the real tick, runner, transitions and budget guard.
 */

const loaded = loadScenarios();
const byFile = (f: string): GoldenScenario => loaded.find((l) => l.file === f)!.scenario;

describe("ads golden scenarios — every one, through the real orchestrator", () => {
  it.each(loaded.map((l) => [l.file, l.scenario] as const))("%s", async (file, scenario) => {
    const run = await runGolden(scenario, file);
    expect(compareGolden(scenario, run)).toEqual([]);
  });
});

describe("ads golden — the checker is not vacuous", () => {
  it("a wrong final state, a missing ledger line and a wrong vendor count each fail", async () => {
    const good = byFile("happy-path-draft-to-live.yaml");
    const run = await runGolden(good);
    expect(compareGolden(good, run)).toEqual([]);
    const wrong: GoldenScenario = {
      ...good,
      expect: {
        ...good.expect,
        states: { c1: "paused" },
        ledger: { c1: good.expect.ledger.c1!.slice(0, -1) },
        vendor: { ...good.expect.vendor, launch: 2 },
      },
    };
    expect(compareGolden(wrong, run).map((f) => f.field)).toEqual(["states.c1", "ledger.c1", "vendor.launch"]);
  });
});

describe("ads golden — the §4R Orchestrator row is covered", () => {
  // The L2 column of §4R's Orchestrator row, one tag each, plus the walk itself. A scenario retired
  // without a replacement leaves its tag uncovered and this fails. "Kill switch in EVERY state" is
  // runner.test.ts's enumeration ("never launches; launching and live go to pausing; …"); the
  // scenarios carry it through time.
  const REQUIRED = ["happy_path", "crash", "delivered_twice", "two_campaigns", "kill_switch", "approval_missing", "budget_exhausted", "settings_changed"];

  it("every required fault has at least one scenario", () => {
    const covered = new Set(loaded.flatMap((l) => l.scenario.covers));
    expect(REQUIRED.filter((t) => !covered.has(t))).toEqual([]);
  });
});

/**
 * §4R: "Process killed after every side effect (each state × each vendor call) then restarted" and
 * "0 duplicate vendor creates across all crash points". The named crash scenarios pin three points
 * with their whole ledgers; this sweep takes the happy path, counts its writes, and kills the process
 * at EACH one in turn. The outcome may differ by crash point — a lost launch answer ends paused, by
 * design — so it asserts what must hold at every one of them.
 */
describe("ads golden — a crash at every write of the happy path", () => {
  const happy = byFile("happy-path-draft-to-live.yaml");

  /** The campaign's succeeded moves chain from where it started to where it is: no move claimed that did not happen. */
  function movesChain(run: GoldenRun, start: string): string[] {
    const problems: string[] = [];
    let at = start;
    for (const line of run.ledger.c1!) {
      const m = /^(\w+) -(\w+)-> (\w+) succeeded$/.exec(line);
      if (!m) continue;
      if (m[1] !== at) problems.push(`"${line}" starts from ${m[1]}, but the campaign was in ${at}`);
      at = m[3]!;
    }
    const open = run.ledger.c1!.filter((l) => / -\w+-> \w+ started$/.test(l));
    // A crash between the move and its completion leaves that one row open until the next move settles it.
    if (open.length > 1) problems.push(`${open.length} transitions left open: ${open.join("; ")}`);
    const endsAt = open.length === 1 ? /-> (\w+) started$/.exec(open[0]!)![1]! : at;
    if (endsAt !== run.states.c1) problems.push(`the ledger ends in ${endsAt}, the campaign is ${run.states.c1}`);
    return problems;
  }

  it("the clean run is what the scenario says, and writes to both tables", async () => {
    const run = await runGolden(happy);
    expect(compareGolden(happy, run)).toEqual([]);
    expect(run.errors).toEqual([]);
    expect(run.world.writesTo("ads_campaigns")).toBeGreaterThanOrEqual(7);
    expect(run.world.writesTo("ads_actions")).toBeGreaterThanOrEqual(16);
  });

  for (const table of ["ads_campaigns", "ads_actions"] as const) {
    it(`killed at each write to ${table}: one launch at most, one object created, the step's key reused, the ledger true`, async () => {
      const clean = await runGolden(happy);
      const total = clean.world.writesTo(table);
      const seen: string[] = [];
      for (let nth = 1; nth <= total; nth += 1) {
        const crashed: GoldenScenario = { ...happy, timeline: [{ crash: { table, nth } }, ...happy.timeline] };
        const run = await runGolden(crashed);
        const at = `${table} write ${nth}`;
        expect(run.errors.length, `${at}: the crash happened`).toBeGreaterThanOrEqual(1);
        expect(run.vendor.launch, at).toBeLessThanOrEqual(1);
        expect(run.vendor.creates, at).toBe(1);
        expect(run.composeKeys, at).toBe(1);
        expect(movesChain(run, "draft"), at).toEqual([]);
        // Live, or — when the launch's own answer was the write that died — paused, never anything else.
        expect(["live", "paused"], at).toContain(run.states.c1);
        if (run.states.c1 === "paused") expect(run.ledger.c1, at).toContain("launch started");
        seen.push(run.states.c1!);
      }
      expect(seen).toHaveLength(total);
      expect(seen).toContain("live");
    });
  }
});
