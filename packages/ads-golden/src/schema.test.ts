import { describe, expect, it } from "vitest";
import { parseLeadScenario } from "./leadSchema.js";
import { loadLeadScenarios, loadMonitorScenarios, loadScenarios } from "./load.js";
import { parseMonitorScenario } from "./monitorSchema.js";
import { parseScenario } from "./schema.js";

/**
 * The package's own checks: every shipped scenario parses, and the schema refuses the mistakes that
 * would otherwise make a scenario pass for the wrong reason. Running them through the orchestrator is
 * `apps/api/src/modules/ads/orchestrator/golden.test.ts`'s job.
 */

const minimal = {
  name: "n",
  why: "w",
  covers: ["happy_path"],
  verifiedBy: "v",
  campaigns: [{ id: "c1", state: "draft" }],
  timeline: [{ settle: true }],
  expect: { states: { c1: "draft" } },
};

describe("@silvicom/ads-golden — the scenarios", () => {
  it("every scenario file parses, and names are unique", () => {
    const loaded = loadScenarios();
    expect(loaded.length).toBeGreaterThanOrEqual(12);
    expect(new Set(loaded.map((l) => l.scenario.name)).size).toBe(loaded.length);
  });

  it("a minimal scenario parses with the documented defaults", () => {
    const s = parseScenario(minimal, "minimal");
    expect(s.settings).toBe("live");
    expect(s.account_limit_cents).toBe(300_000);
    expect(s.vendor).toEqual({ compose: ["ok"], create: ["ok"], launch: ["ok"], pause: ["ok"] });
    expect(s.campaigns[0]).toMatchObject({ daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 });
  });
});

describe("@silvicom/ads-golden — the schema refuses what would make a scenario lie", () => {
  const refuses = (patch: Record<string, unknown>, why: RegExp) =>
    expect(() => parseScenario({ ...minimal, ...patch }, "bad.yaml")).toThrow(why);

  it("a campaign the scenario does not seed, named anywhere", () => {
    refuses({ timeline: [{ person: { campaign: "c9", event: "compose" } }] }, /names campaign "c9"/);
    refuses({ expect: { states: { c1: "draft", c9: "live" } } }, /names campaign "c9"/);
  });

  it("a seeded campaign whose final state is not stated", () => {
    refuses({ campaigns: [{ id: "c1", state: "draft" }, { id: "c2", state: "draft" }] }, /campaign "c2"'s final state/);
  });

  it("no provenance (the independence rule), an unknown key, a two-key timeline step", () => {
    refuses({ verifiedBy: "" }, /verifiedBy/);
    refuses({ surprise: 1 }, /surprise/);
    refuses({ timeline: [{ tick: 1, settle: true }] }, /invalid/);
  });

  it("an `absent` worker with other answers beside it", () => {
    refuses({ vendor: { compose: ["absent", "ok"] } }, /stands alone/);
  });

  it("a vendor answer outside the vocabulary", () => {
    refuses({ vendor: { launch: ["maybe"] } }, /invalid/);
  });
});

describe("@silvicom/ads-golden — the monitor scenarios", () => {
  const monitor = {
    name: "n", why: "w", covers: ["daily_cap"], verifiedBy: "v",
    campaigns: [{ id: "c1" }],
    timeline: [{ hourly_job: true }],
    expect: { states: { c1: "live" } },
  };
  const refuses = (patch: Record<string, unknown>, why: RegExp) =>
    expect(() => parseMonitorScenario({ ...monitor, ...patch }, "bad.yaml")).toThrow(why);

  it("every monitor file parses, and the orchestrator's loader never reads them", () => {
    const files = loadMonitorScenarios().map((l) => l.file);
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(loadScenarios().map((l) => l.file).filter((f) => files.includes(f))).toEqual([]);
  });

  it("a minimal scenario parses with the documented defaults", () => {
    const s = parseMonitorScenario(monitor, "minimal");
    expect(s.settings).toEqual({ monthly_cap_cents: 300_000, cpl_max_cents: 4_200, cpl_min_leads: 3, no_lead_spend_cents: 7_500, frequency_max: 4, pause_at_daily_cap: true });
    expect(s.campaigns[0]).toEqual({ id: "c1", state: "live", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, stage: "SUCCESS" });
    expect(s.expect).toEqual({ states: { c1: "live" }, pauses: [], flags: [], bell: [], failures: [] });
  });

  it("refuses what would make one pass for the wrong reason", () => {
    refuses({ timeline: [{ account_month: 1 }] }, /runs no job/);
    refuses({ timeline: [{ hourly_job: true }, { stage: { campaign: "c9", stage: "FAIL" } }] }, /names campaign "c9"/);
    refuses({ campaigns: [{ id: "c1" }, { id: "c2" }] }, /campaign "c2"'s final state/);
    refuses({ timeline: [{ hourly_job: true }, { ads_manager: { campaign: "c1", status: "PAUSED", spend_cap_cents: 1 } }] }, /one edit per step/);
    refuses({ verifiedBy: "" }, /verifiedBy/);
  });
});

describe("@silvicom/ads-golden — the lead scenarios", () => {
  const lead = { name: "n", why: "w", covers: ["webhook"], verifiedBy: "v", timeline: [{ submit: { lead: "l1" } }, { backfill: true }], expect: { stored: { l1: "backfill" } } };
  const refuses = (patch: Record<string, unknown>, why: RegExp) =>
    expect(() => parseLeadScenario({ ...lead, ...patch }, "bad.yaml")).toThrow(why);

  it("every lead file parses, and the orchestrator's loader never reads them", () => {
    const files = loadLeadScenarios().map((l) => l.file);
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(loadScenarios().map((l) => l.file).filter((f) => files.includes(f))).toEqual([]);
  });

  it("refuses a scenario that loses a lead, or names one it never submitted", () => {
    refuses({ expect: { stored: {} } }, /exactly one of/);
    refuses({ expect: { stored: { l1: "backfill" }, dropped: ["l1"] } }, /exactly one of/);
    refuses({ expect: { stored: {}, dropped: ["l1"] } }, /losing it/);
    refuses({ timeline: [{ submit: { lead: "l1", form: "other" } }, { backfill: true }] }, /cannot be stored/);
    refuses({ timeline: [{ submit: { lead: "l1" } }, { submit: { lead: "l1" } }] }, /submitted twice/);
    refuses({ timeline: [{ submit: { lead: "l1" } }, { webhook: ["l9"] }] }, /names lead "l9"/);
  });
});
