import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { AdCandidates } from "@silvicom/shared";
import AdsCopyCandidates from "./AdsCopyCandidates.vue";

/**
 * The ranked copies on the review screen (CQ4), and what a reviewer is told when the ad is NOT the first of them
 * (AG1, D-AD26): which one it is, and that the better-ranked one did not fit on the image.
 */
const judged = (n: number) => ({ reason: "Leads with the pay.", scores: { hook: n, specific: n, plain: n, spanish: n, no_filler: n } });
const candidate = (hook: string, n: number, offered_as: number) => ({ copy: { en: { hook }, es: { hook } }, judged: judged(n), total: n * 5, offered_as });
const SET: AdCandidates = { ranked: [candidate("A long one", 5, 0), candidate("Short", 4, 1), candidate("Third", 3, 2)], chosen: 0, judge: "craftJudge@1", offered: 3, passed: 3 };
const show = (candidates: AdCandidates) => mount(AdsCopyCandidates, { props: { candidates, language: "en" } });

describe("AdsCopyCandidates — which copy became the ad", () => {
  it("the first-ranked copy is the ad: marked, with nothing called unused", () => {
    const w = show(SET);
    expect(w.find("[data-test=copy-candidates] summary").text()).toContain("Ranked by the craft judge; the first became the ad.");
    expect(w.find("[data-test=candidate-1] [data-test=chosen]").exists()).toBe(true);
    expect(w.findAll("[data-test=passed-over]")).toHaveLength(0);
  });

  it("a better-ranked copy that did not fit is shown as not used, with the overlay's reason, and the mark moves to the one that is the ad", () => {
    const w = show({ ...SET, chosen: 1, passed_over: [{ index: 0, reason: "4:5, en: too_long" }] });
    expect(w.find("summary").text()).toContain("#2 became the ad, because the ones above it do not fit on the image.");
    expect(w.find("[data-test=candidate-1] [data-test=passed-over]").text()).toBe("Not used: it does not fit on the image (4:5, en: too_long).");
    expect(w.find("[data-test=candidate-1] [data-test=chosen]").exists()).toBe(false);
    expect(w.find("[data-test=candidate-2] [data-test=chosen]").exists()).toBe(true);
    expect(w.find("[data-test=candidate-2] [data-test=passed-over]").exists()).toBe(false);
  });
});
