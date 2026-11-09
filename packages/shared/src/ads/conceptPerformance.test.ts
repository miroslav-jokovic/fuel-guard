import { describe, expect, it } from "vitest";
import { costPerLeadCents, foldConcepts, type AdHourFact } from "./conceptPerformance.js";

const creatives = [{ id: "c1", preset_version_id: "v1" }, { id: "c2", preset_version_id: "v2" }, { id: "c3", preset_version_id: "v1b" }];
const presets = [{ version_id: "v1", key: "P1" }, { version_id: "v1b", key: "P1" }, { version_id: "v2", key: "P2" }];
const row = (creative_id: string, language: "en" | "es", spend_cents: number, leads: number, clicks = 1, impressions = 100): AdHourFact => ({ creative_id, language, spend_cents, leads, clicks, impressions });

describe("foldConcepts — what each concept did (CQ3 reader, D-AD22)", () => {
  it("sums every ad hour of a preset's creatives, across its versions, with cost per lead per preset and per language", () => {
    const out = foldConcepts([row("c1", "en", 1000, 1), row("c1", "es", 500, 0), row("c3", "en", 1500, 2), row("c2", "en", 3000, 1)], creatives, presets);
    expect(out.map((c) => c.preset_key)).toEqual(["P1", "P2"]);
    expect(out[0]).toMatchObject({ preset_version_ids: ["v1", "v1b"], creatives: 2, spend_cents: 3000, leads: 3, cost_per_lead_cents: 1000 });
    expect(out[0]!.by_language.en).toMatchObject({ spend_cents: 2500, leads: 3, cost_per_lead_cents: 833 });
    expect(out[0]!.by_language.es).toMatchObject({ spend_cents: 500, leads: 0, cost_per_lead_cents: null });
    expect(out[1]).toMatchObject({ preset_key: "P2", spend_cents: 3000, leads: 1, cost_per_lead_cents: 3000 });
  });

  it("a concept that spent and brought no lead is null on cost per lead — never zero, never 'free'", () => {
    const out = foldConcepts([row("c2", "en", 4000, 0)], creatives, presets);
    expect(out.find((c) => c.preset_key === "P2")).toMatchObject({ spend_cents: 4000, leads: 0, cost_per_lead_cents: null });
    expect(costPerLeadCents(4000, 0)).toBeNull();
    expect(costPerLeadCents(0, 0)).toBeNull();
  });

  it("a creative with no hours still has its line, at zero: a concept that never ran is not absent", () => {
    const out = foldConcepts([], creatives, presets);
    expect(out.map((c) => [c.preset_key, c.creatives, c.spend_cents])).toEqual([["P1", 2, 0], ["P2", 1, 0]]);
  });

  it("a row for a creative the campaign does not hold is dropped, not guessed into a preset", () => {
    const out = foldConcepts([row("stranger", "en", 9999, 9)], creatives, presets);
    expect(out.reduce((n, c) => n + c.spend_cents, 0)).toBe(0);
  });

  it("presets come out in key order whatever the rows' order", () => {
    const out = foldConcepts([row("c2", "en", 1, 0), row("c1", "en", 1, 0)], creatives, presets);
    expect(out.map((c) => c.preset_key)).toEqual(["P1", "P2"]);
  });
});
