import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { FINISHED_AD_CRITERIA } from "@silvicom/shared";
import AdsFinishedAdOpinion from "./AdsFinishedAdOpinion.vue";

/** The second opinion on the review card (P1-7, Q-AD76): beside the checks, worded as an opinion, or why it did not run. */
const scores = (s: number) => Object.fromEntries(FINISHED_AD_CRITERIA.map((c) => [c, { reason: `because ${c}`, score: s }]));

describe("AdsFinishedAdOpinion", () => {
  it("shows each format's four scores with the judge's line, and says it never stops an ad", () => {
    const w = mount(AdsFinishedAdOpinion, { props: { checks: { visual: { ok: true }, finished_ad: { ran: true, by_format: { "4:5": scores(2) } } } } });
    expect(w.find("[data-test=finished-ad-opinion]").text()).toContain("never stops an ad");
    const items = w.findAll('[data-test="finished-ad-4:5"] [data-test=finished-ad-item]');
    expect(items).toHaveLength(4);
    expect(items[0]!.element.textContent).toBe("2/5 · The one subject reads at a glance, at phone size — because subject_legible");
  });

  it("says why it did not run", () => {
    const w = mount(AdsFinishedAdOpinion, { props: { checks: { finished_ad: { ran: false, not_run: "agent_off" } } } });
    expect(w.find("[data-test=finished-ad-not-run]").text()).toBe("It did not run: it is switched off in Ads control.");
  });

  it("shows nothing for a creative made before the judge, or one with no checks yet", () => {
    expect(mount(AdsFinishedAdOpinion, { props: { checks: { copy: { ok: true } } } }).find("[data-test=finished-ad-opinion]").exists()).toBe(false);
    expect(mount(AdsFinishedAdOpinion, { props: { checks: null } }).find("[data-test=finished-ad-opinion]").exists()).toBe(false);
  });
});
