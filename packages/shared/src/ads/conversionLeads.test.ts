import { describe, expect, it } from "vitest";
import { conversionLeadsReadiness, stageRates } from "./conversionLeads.js";
import type { LeadSourceOutcome } from "./leadOutcomes.js";

/** V7e: Meta's Conversion Leads requirements, each measured on our own rows; the switch is never offered. */
const NOW = new Date("2026-11-20T15:00:00.000Z");
const day = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
let n = 0;
const lead = (arrivedDaysAgo: number, reached: LeadSourceOutcome["reached"] = {}): LeadSourceOutcome => ({
  lead_id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, channel: "meta", campaign_id: "c", platform_ad_ref: "1",
  arrived_at: day(arrivedDaysAgo), reached,
});
const many = (k: number, f: () => LeadSourceOutcome) => Array.from({ length: k }, f);
const check = (v: ReturnType<typeof conversionLeadsReadiness>, key: string) => v.checks.find((c) => c.key === key)!;
const ON = { enabled: true, dataset_id: "770000000000001" };

describe("conversionLeadsReadiness", () => {
  it("is never offered, and Q-AD17 is always not answered", () => {
    const v = conversionLeadsReadiness({ now: NOW, recent: [], cohort: [], covered: new Set(), feed: ON });
    expect(v.offered).toBe(false);
    expect(check(v, "employment").met).toBeNull();
  });

  it("volume: 200 in the last 30 days meets it, 199 does not", () => {
    const at = (k: number) => check(conversionLeadsReadiness({ now: NOW, recent: many(k, () => lead(3)), cohort: [], covered: new Set(), feed: ON }), "volume").met;
    expect([at(199), at(200)]).toEqual([false, true]);
  });

  it("feed: on with a dataset, and only then", () => {
    const f = (feed: { enabled: boolean; dataset_id: string | null }) => check(conversionLeadsReadiness({ now: NOW, recent: [], cohort: [], covered: new Set(), feed }), "feed").met;
    expect([f(ON), f({ enabled: false, dataset_id: "1" }), f({ enabled: true, dataset_id: null })]).toEqual([true, false, false]);
  });

  it("coverage: leads with an accepted event over the last 30 days' leads; 60 % meets it; no lead is not measurable", () => {
    const recent = many(10, () => lead(2));
    const cov = (k: number) => check(conversionLeadsReadiness({ now: NOW, recent, cohort: [], covered: new Set(recent.slice(0, k).map((l) => l.lead_id)), feed: ON }), "coverage");
    expect([cov(5).met, cov(6).met]).toEqual([false, true]);
    expect(cov(6).measured).toContain("6 of 10");
    expect(check(conversionLeadsReadiness({ now: NOW, recent: [], cohort: [], covered: new Set(), feed: ON }), "coverage").met).toBeNull();
  });

  it("a covered id of another lead does not count", () => {
    const v = conversionLeadsReadiness({ now: NOW, recent: [lead(1)], cohort: [], covered: new Set(["someone-else"]), feed: ON });
    expect(check(v, "coverage").measured).toContain("0 of 1");
  });

  it("stage: a stage reached within 28 days by 1–40 % of the cohort meets it; later than 28 days does not count", () => {
    const cohort = [
      lead(40, { qualified: day(40 - 28) }), // exactly 28 days later: counts
      lead(40, { qualified: day(40 - 29) }), // 29 days later: does not
      ...many(8, () => lead(40)),
    ];
    const rates = stageRates(cohort);
    expect(rates.find((r) => r.stage === "qualified")).toMatchObject({ reached: 1, of: 10, rate: 0.1, in_range: true });
    const v = conversionLeadsReadiness({ now: NOW, recent: [], cohort, covered: new Set(), feed: ON });
    expect(check(v, "stage")).toMatchObject({ met: true });
    expect(check(v, "stage").measured).toContain("qualified 10 %");
  });

  it("stage: every lead reaching it (100 %) or none (0 %) is out of range; no cohort is not measurable", () => {
    const all = stageRates(many(5, () => lead(40, { contacted: day(39) })));
    expect(all.find((r) => r.stage === "contacted")!.in_range).toBe(false);
    expect(all.find((r) => r.stage === "hired")!.in_range).toBe(false);
    expect(check(conversionLeadsReadiness({ now: NOW, recent: [], cohort: [], covered: new Set(), feed: ON }), "stage").met).toBeNull();
    expect(stageRates([])[0]).toMatchObject({ rate: null, in_range: null });
  });

  it("the bounds are inclusive: exactly 1 % and exactly 40 % are in range", () => {
    const at = (reached: number, of: number) => stageRates([...many(reached, () => lead(40, { hired: day(39) })), ...many(of - reached, () => lead(40))]).find((r) => r.stage === "hired")!.in_range;
    expect([at(1, 100), at(40, 100), at(41, 100)]).toEqual([true, true, false]);
  });
});
