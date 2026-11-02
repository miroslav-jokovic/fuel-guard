import { describe, expect, it } from "vitest";
import { loadScenarios } from "./load.js";
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
