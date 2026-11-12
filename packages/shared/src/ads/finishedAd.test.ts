import { describe, expect, it } from "vitest";
import { adCreativeChecksSchema } from "./creativeChecks.js";
import { FINISHED_AD_CRITERIA, finishedAdOpinion, finishedAdScoresSchema } from "./finishedAd.js";

const scores = (s: number) => Object.fromEntries(FINISHED_AD_CRITERIA.map((c) => [c, { reason: `r ${c}`, score: s }]));

describe("the finished-ad judge's answer and what review shows of it (P1-7, Q-AD76)", () => {
  it("an answer is four criteria, each a reason and a whole score from 1 to 5, and nothing else", () => {
    expect(finishedAdScoresSchema.safeParse(scores(3)).success).toBe(true);
    expect(finishedAdScoresSchema.safeParse({ ...scores(3), hierarchy_reads: { reason: "r ok", score: 6 } }).success).toBe(false);
    expect(finishedAdScoresSchema.safeParse({ ...scores(3), hierarchy_reads: { reason: "r ok", score: 2.5 } }).success).toBe(false);
    const { looks_like_kit: _, ...three } = scores(3);
    expect(finishedAdScoresSchema.safeParse(three).success).toBe(false);
    expect(finishedAdScoresSchema.safeParse({ ...scores(3), extra: { reason: "r ok", score: 3 } }).success).toBe(false);
  });

  it("a creative composed before the judge existed shows nothing; one where it did not run says why, in words", () => {
    expect(finishedAdOpinion(undefined)).toBeNull();
    expect(finishedAdOpinion({ ran: false, not_run: "agent_off" })).toEqual({ ran: false, why: "it is switched off in Ads control" });
    expect(finishedAdOpinion({ ran: false, not_run: "budget_exhausted (tokens_monthly)" })).toEqual({ ran: false, why: "this month's model budget is spent" });
    expect(finishedAdOpinion({ ran: false, not_run: "failed (off_schema)" })).toEqual({ ran: false, why: "its answer could not be read" });
    expect(finishedAdOpinion({ ran: false, not_run: "failed (provider_529)" })).toEqual({ ran: false, why: "the call failed" });
    expect(finishedAdOpinion("nonsense")).toEqual({ ran: false, why: "its answer could not be read" });
  });

  it("a judged creative shows each format's four scores in criteria order, with the label and the judge's own line", () => {
    const o = finishedAdOpinion({ ran: true, prompt_version: "finishedAdJudge@1", by_format: { "4:5": scores(4), "1:1": scores(2) } });
    expect(o?.ran).toBe(true);
    if (!o?.ran) return;
    expect(o.formats.map((f) => f.format)).toEqual(["4:5", "1:1"]);
    expect(o.formats[1]!.items.map((i) => [i.criterion, i.score])).toEqual(FINISHED_AD_CRITERIA.map((c) => [c, 2]));
    expect(o.formats[0]!.items[0]).toMatchObject({ label: "The one subject reads at a glance, at phone size", reason: "r subject_legible" });
  });

  it("the checks the review screen reads hold the key, so a judged creative's checks still parse", () => {
    expect(adCreativeChecksSchema.safeParse({ copy: { ok: true }, finished_ad: { ran: true, by_format: { "4:5": scores(3) } } }).success).toBe(true);
    expect(adCreativeChecksSchema.safeParse({ finished_ad: { ran: "yes" } }).success).toBe(false);
  });
});
