import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLeadScenarios, parseLeadScenario, type LeadScenario } from "@silvicom/ads-golden";
import { compareLeads, runLeadGolden } from "../../../testing/adsLeadGolden.js";
import { simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";

/**
 * Lead intake's golden scenarios (ADS-AGENT-BUILD-WORKFLOW.md §4R, its L3 bar: "0 lost, 0 duplicated leads over the
 * scenario set; injection text never reaches an action"). The scenarios are data in `@silvicom/ads-golden`
 * (`scenarios/leads/`); `testing/adsLeadGolden.ts` runs each through the real roads and the real sink. What the
 * imitated `ingest_lead` leaves unproven is the matrix's: `leadSchema.ts` says which proves what.
 */

const loaded = loadLeadScenarios();
const byFile = (f: string): LeadScenario => loaded.find((l) => l.file === f)!.scenario;
let fake: FakeMeta;

beforeAll(async () => {
  fake = await simulatorFakeForTests();
});
afterAll(async () => stopSimulatorForTests());

describe("ads lead golden scenarios — every one, through the real roads and the real sink", () => {
  it.each(loaded.map((l) => [l.file, l.scenario] as const))("%s", async (_file, scenario) => {
    const run = await runLeadGolden(scenario, fake);
    expect(compareLeads(scenario, run)).toEqual([]);
  });
});

describe("ads lead golden — the checker is not vacuous", () => {
  it("a lead stored twice, a lead on the wrong road, a lost ring and a stray write each fail", async () => {
    const good = byFile("webhook-brings-the-lead.yaml");
    const run = await runLeadGolden(good, fake);
    expect(compareLeads(good, run)).toEqual([]);
    expect(compareLeads(good, { ...run, stored: { l1: ["webhook", "backfill"] } }).map((f) => f.field)).toEqual(["stored"]);
    expect(compareLeads(good, { ...run, stored: { l1: ["backfill"] } }).map((f) => f.field)).toEqual(["stored"]);
    expect(compareLeads(good, { ...run, stored: {} }).map((f) => f.field)).toContain("stored");
    expect(compareLeads(good, { ...run, rung: [] }).map((f) => f.field)).toEqual(["rung"]);
    expect(compareLeads(good, { ...run, strayWrites: ["ads_campaigns"] }).map((f) => f.field)).toEqual(["strayWrites"]);
  });

  it("a scenario cannot leave a lead unaccounted for, or drop one of ours", () => {
    const base = { name: "n", why: "w", covers: ["c"], verifiedBy: "v", timeline: [{ submit: { lead: "l1" } }, { backfill: true }] };
    expect(() => parseLeadScenario({ ...base, expect: { stored: {} } }, "bad.yaml")).toThrow(/exactly one/);
    expect(() => parseLeadScenario({ ...base, expect: { stored: {}, dropped: ["l1"] } }, "bad.yaml")).toThrow(/losing it/);
  });
});

describe("ads lead golden — the §4R Lead intake row is covered", () => {
  const REQUIRED = ["webhook", "duplicate_webhook", "webhook_lost", "forged", "retry", "outage", "two_forms", "injection", "malformed_phone"];

  it("every fault has at least one scenario", () => {
    const covered = new Set(loaded.flatMap((l) => l.scenario.covers));
    expect(REQUIRED.filter((t) => !covered.has(t))).toEqual([]);
  });
});

/**
 * §4R: "0 lost, 0 duplicated". The named scenarios pin the cases worth reading. This takes one lead through EVERY
 * order of a delivery, a worker run and a backfill, up to four steps, then the hour's backfill that always comes, and
 * asserts what must hold at each. Which road wins is worked out here from the rule, the first to reach the store.
 */
describe("ads lead golden — every order of the two roads", () => {
  type Move = "webhook" | "jobs" | "backfill";
  const MOVES: Move[] = ["webhook", "jobs", "backfill"];
  const orders = (n: number): Move[][] => (n === 0 ? [[]] : orders(n - 1).flatMap((o) => MOVES.map((m) => [...o, m])));
  const all = [0, 1, 2, 3, 4].flatMap(orders);

  function expected(order: Move[]): { road: "webhook" | "backfill"; waiting: boolean } {
    let queued = false;
    let road: "webhook" | "backfill" | null = null;
    for (const m of [...order, "backfill" as const]) {
      if (m === "webhook") queued = true;
      if (m === "jobs" && queued) { road ??= "webhook"; queued = false; }
      if (m === "backfill") road ??= "backfill";
    }
    return { road: road!, waiting: queued };
  }

  it("the lead is stored once, by the road that reached the store first, whatever the order", async () => {
    expect(all.length).toBe(121);
    for (const order of all) {
      const want = expected(order);
      const scenario = parseLeadScenario({
        name: order.join(" ") || "backfill alone", why: "w", covers: ["sweep"], verifiedBy: "the rule above",
        timeline: [{ submit: { lead: "l1" } }, ...order.map((m) => (m === "webhook" ? { webhook: ["l1"] } : { [m]: true })), { backfill: true }],
        expect: { stored: { l1: want.road }, accepted: order.filter((m) => m === "webhook").length, waiting: want.waiting ? ["l1"] : [] },
      }, "sweep");
      expect(compareLeads(scenario, await runLeadGolden(scenario, fake)), order.join(" ")).toEqual([]);
    }
  });
});
