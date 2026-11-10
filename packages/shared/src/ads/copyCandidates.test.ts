import { describe, expect, it } from "vitest";
import { CRAFT_MAX_TOTAL, adCandidatesSchema, craftTotal, rankCandidates, type CraftScore } from "./copyCandidates.js";

const score = (hook: number, specific: number, plain: number, spanish: number, no_filler: number, reason = "because"): CraftScore => ({ reason, scores: { hook, specific, plain, spanish, no_filler } });
const copy = (tag: string) => ({ en: { hook: tag }, es: { hook: tag } });

describe("rankCandidates — the craft judge's order (CQ4, D-AD21)", () => {
  it("orders judged candidates by total, high first; a tie keeps the Copywriter's own order", () => {
    const out = rankCandidates([
      { copy: copy("a"), judged: score(3, 3, 3, 3, 3), offered_as: 0 },
      { copy: copy("b"), judged: score(5, 5, 4, 4, 5), offered_as: 1 },
      { copy: copy("c"), judged: score(4, 4, 4, 2, 1), offered_as: 2 },
    ]);
    expect(out.map((o) => [o.copy.en.hook, o.total])).toEqual([["b", 23], ["a", 15], ["c", 15]]);
  });

  it("an unjudged candidate ranks after every judged one, in the model's order; none judged = the model's order, totals null", () => {
    const out = rankCandidates([
      { copy: copy("a"), judged: null, offered_as: 0 },
      { copy: copy("b"), judged: score(2, 2, 2, 2, 2), offered_as: 1 },
      { copy: copy("c"), judged: null, offered_as: 2 },
    ]);
    expect(out.map((o) => o.copy.en.hook)).toEqual(["b", "a", "c"]);
    const none = rankCandidates([{ copy: copy("x"), judged: null, offered_as: 1 }, { copy: copy("w"), judged: null, offered_as: 0 }]);
    expect(none.map((o) => [o.copy.en.hook, o.total])).toEqual([["w", null], ["x", null]]);
  });

  it("the total is the five scores summed, at most 25", () => {
    expect(craftTotal(score(5, 5, 5, 5, 5))).toBe(CRAFT_MAX_TOTAL);
    expect(craftTotal(score(1, 2, 3, 4, 5))).toBe(15);
  });

  it("the stored shape refuses a chosen index outside the list and a score outside 1–5", () => {
    const ranked = [{ copy: copy("a"), judged: score(3, 3, 3, 3, 3), total: 15, offered_as: 0 }];
    expect(adCandidatesSchema.safeParse({ ranked, chosen: 0, judge: "craftJudge@1", offered: 3, passed: 1 }).success).toBe(true);
    expect(adCandidatesSchema.safeParse({ ranked, chosen: 1, judge: "craftJudge@1", offered: 3, passed: 1 }).success).toBe(false);
    expect(adCandidatesSchema.safeParse({ ranked: [{ ...ranked[0], judged: score(6, 3, 3, 3, 3) }], chosen: 0, judge: null, offered: 1, passed: 1 }).success).toBe(false);
  });

  it("a set may say which better-ranked copies were passed over and why; one written before AG1 says nothing and still parses", () => {
    const one = { copy: copy("a"), judged: score(3, 3, 3, 3, 3), total: 15, offered_as: 0 };
    const ranked = [one, { ...one, copy: copy("b"), offered_as: 1 }];
    const base = { ranked, chosen: 1, judge: "craftJudge@1", offered: 2, passed: 2 };
    expect(adCandidatesSchema.safeParse(base).success).toBe(true);
    expect(adCandidatesSchema.safeParse({ ...base, passed_over: [{ index: 0, reason: "4:5, en: too_long" }] }).success).toBe(true);
    // An index outside the list, an empty reason and an unknown key are each refused.
    expect(adCandidatesSchema.safeParse({ ...base, passed_over: [{ index: 2, reason: "4:5, en: too_long" }] }).success).toBe(false);
    expect(adCandidatesSchema.safeParse({ ...base, passed_over: [{ index: 0, reason: "" }] }).success).toBe(false);
    expect(adCandidatesSchema.safeParse({ ...base, passed_over: [{ index: 0, reason: "x", by: "me" }] }).success).toBe(false);
  });
});
