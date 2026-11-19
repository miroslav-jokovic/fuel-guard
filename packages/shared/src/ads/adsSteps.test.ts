import { describe, expect, it } from "vitest";
import { ADS_AUTHORITY } from "./adsPolicy.js";
import { AD_STEP_KEYS, AD_STEPS, CAMPAIGN_EVENT_ACT, modeOpen } from "./adsSteps.js";
import { CAMPAIGN_EVENTS, CAMPAIGN_TRANSITIONS } from "./campaignMachine.js";
import { ADS_SETTINGS_UNSET } from "./settingsContract.js";

describe("the campaign machine answers to the authority table (V5, Q-APX21)", () => {
  it("the machine lets nobody act whom the authority table forbids", () => {
    const wrong: string[] = [];
    for (const t of CAMPAIGN_TRANSITIONS) {
      const act = CAMPAIGN_EVENT_ACT[t.event];
      if (act === null) {
        if (t.by.some((b) => b !== "platform")) wrong.push(`${t.from} ${t.event}: a platform fact chosen by ${t.by.join("/")}`);
        continue;
      }
      const allowed = ADS_AUTHORITY[act] as readonly string[];
      for (const who of t.by) if (!allowed.includes(who)) wrong.push(`${t.from} ${t.event} by ${who}: ${act} is ${allowed.join("/")}'s`);
    }
    expect(wrong).toEqual([]);
  });

  it("every event the machine knows is bound to an act or named a platform fact", () => {
    expect(Object.keys(CAMPAIGN_EVENT_ACT).sort()).toEqual([...CAMPAIGN_EVENTS].sort());
  });

  it("launching stays an approver's, and approving a plan or an ad a person's", () => {
    expect([ADS_AUTHORITY[CAMPAIGN_EVENT_ACT.launch!], ADS_AUTHORITY[CAMPAIGN_EVENT_ACT.plan_approved!], ADS_AUTHORITY[CAMPAIGN_EVENT_ACT.creatives_approved!]])
      .toEqual([["approver"], ["person"], ["person"]]);
  });
});

describe("the steps and their modes", () => {
  it("are the steps Q-APX21 ruled, in order, and none of them moves budget between ads", () => {
    expect(AD_STEPS.map((s) => s.key)).toEqual([...AD_STEP_KEYS]);
    expect(AD_STEP_KEYS).toEqual(["start_campaign", "approve_plan", "approve_ad", "launch", "replace_tired_ad", "lower_budget"]);
  });

  it("a locked mode is locked by the authority table, not by its words", () => {
    for (const s of AD_STEPS) for (const m of s.modes) {
      expect(modeOpen(m), `${s.key} ${m.mode}`).toBe(m.opens_when === undefined);
    }
  });

  it("the mode in force is one the step offers, and an open one", () => {
    for (const settings of [ADS_SETTINGS_UNSET, { ...ADS_SETTINGS_UNSET, creative_refresh: { ...ADS_SETTINGS_UNSET.creative_refresh, retire: true } }]) {
      for (const s of AD_STEPS) {
        const m = s.modes.find((x) => x.mode === s.modeIn(settings));
        expect(m && modeOpen(m), `${s.key}`).toBe(true);
      }
    }
  });

  it("replacing a tired ad reads the switch that already chose it, rather than holding a second copy", () => {
    const step = AD_STEPS.find((s) => s.key === "replace_tired_ad")!;
    expect(step.modeIn(ADS_SETTINGS_UNSET)).toBe("manual");
    expect(step.modeIn({ ...ADS_SETTINGS_UNSET, creative_refresh: { ...ADS_SETTINGS_UNSET.creative_refresh, retire: true } })).toBe("assisted");
  });
});
