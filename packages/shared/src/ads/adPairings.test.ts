import { describe, expect, it } from "vitest";
import { FINISHED_AD_CRITERIA } from "./finishedAd.js";
import { MAX_PICTURES_PER_CREATIVE, PAIRING_TIE_MARGIN, adPairingsSchema, asGoodCount, finishedAdTotal, rankPairings } from "./adPairings.js";
import { ADS_SETTINGS_UNSET, adsBudgetsSchema } from "./settingsContract.js";

const p = (picture: number, words: number, total: number | null) => ({ picture, words, total });
const order = (pairs: Array<ReturnType<typeof p>>) => rankPairings(pairs).map((x) => `${x.picture}/${x.words}:${x.total ?? "-"}`);
const scores = (n: number) => Object.fromEntries(FINISHED_AD_CRITERIA.map((c) => [c, { reason: "Fixture reason.", score: n }])) as never;

describe("ranking the pairings of one ad (V3; Q-APX7)", () => {
  it("the margin is the judge's measured movement: one point of twenty", () => {
    expect(PAIRING_TIE_MARGIN).toBe(1);
  });

  it("a pairing two points ahead leads, whatever its words rank", () => {
    expect(order([p(1, 0, 16), p(2, 2, 18), p(3, 1, 16)])).toEqual(["2/2:18", "1/0:16", "3/1:16"]);
  });

  it("one point is not a difference: within it the craft judge's words rank decides, then the order the pictures were made in", () => {
    expect(order([p(2, 1, 18), p(1, 0, 17), p(3, 0, 17), p(1, 2, 18)])).toEqual(["1/0:17", "3/0:17", "2/1:18", "1/2:18"]);
  });

  it("behind the leaders the order is by total, high first, ties by words then picture", () => {
    expect(order([p(1, 0, 12), p(2, 0, 15), p(3, 1, 15), p(1, 1, 18), p(3, 0, 14)])).toEqual(["1/1:18", "2/0:15", "3/1:15", "3/0:14", "1/0:12"]);
  });

  it("a pairing the judge did not score comes after every scored one, in the order it was made", () => {
    expect(order([p(2, 1, null), p(1, 0, null), p(3, 0, 10)])).toEqual(["3/0:10", "1/0:-", "2/1:-"]);
  });

  it("with nothing judged the first is the first picture under the best-ranked words — the ad made before V3", () => {
    expect(order([p(3, 2, null), p(2, 0, null), p(1, 1, null), p(1, 0, null)])[0]).toBe("1/0:-");
  });

  it("is a new list: the pairs handed in are not reordered", () => {
    const pairs = [p(2, 0, 10), p(1, 0, 18)];
    rankPairings(pairs);
    expect(pairs.map((x) => x.picture)).toEqual([2, 1]);
  });
});

describe("how many pairings are as good as the best", () => {
  it("counts the head of a ranked list within one point of the first, and stops at the first that is not", () => {
    expect(asGoodCount(rankPairings([p(1, 0, 17), p(2, 0, 18), p(3, 0, 16), p(1, 1, 18)]))).toBe(3);
    expect(asGoodCount(rankPairings([p(1, 0, 18), p(2, 0, 16)]))).toBe(1);
    expect(asGoodCount(rankPairings([p(1, 0, 18), p(2, 0, null)]))).toBe(1);
  });

  it("is zero when nothing was judged: an unjudged order is nobody's opinion", () => {
    expect(asGoodCount(rankPairings([p(1, 0, null), p(2, 0, null)]))).toBe(0);
    expect(asGoodCount([])).toBe(0);
  });
});

describe("the stored pairings (0619)", () => {
  const picture = (n: number, dropped: string | null = null) => ({ picture: n, attempt: 1, reference: "a".repeat(64), focal_subject: "tractor", camera_distance: "medium", dropped });
  const pairing = (pic: number, words: number, n: number | null) => ({ picture: pic, words, judged: n === null ? null : scores(n), total: n === null ? null : n * 4, preview: null });
  const body = (over: Record<string, unknown> = {}) => ({ format: "4:5", pictures: [picture(1), picture(2)], ranked: [pairing(1, 0, 4), pairing(2, 0, 3)], chosen: 0, judge: "finishedAdJudge@1", ...over });

  it("holds the pictures made, the ranked pairings and which became the ad", () => {
    expect(adPairingsSchema.safeParse(body()).success).toBe(true);
    expect(adPairingsSchema.safeParse(body({ judge: null, ranked: [pairing(1, 0, null)] })).success).toBe(true);
  });

  it("the total kept beside the scores is the four added", () => {
    expect(finishedAdTotal(scores(4))).toBe(16);
  });

  it("refuses a chosen index outside the list, a pairing listed twice, and a pairing on a picture that was dropped or never made", () => {
    const why = (b: unknown) => adPairingsSchema.safeParse(b).error?.issues[0]?.message;
    expect(why(body({ chosen: 2 }))).toBe("chosen names a pairing that is not in the list");
    expect(why(body({ ranked: [pairing(1, 0, 4), pairing(1, 0, 3)] }))).toBe("a pairing is listed twice");
    expect(why(body({ pictures: [picture(1), picture(2, "visual check failed after 2 attempt(s)")] }))).toBe("a pairing names a picture that was not made, or one that was dropped");
    expect(why(body({ ranked: [pairing(3, 0, 4)] }))).toBe("a pairing names a picture that was not made, or one that was dropped");
  });

  it("a dropped picture is kept in the list with its reason, so a reviewer sees it was made", () => {
    expect(adPairingsSchema.safeParse(body({ pictures: [picture(1), picture(2), picture(3, "art check: repeats_earlier_picture")] })).success).toBe(true);
  });
});

describe("how many pictures an ad is chosen from (budgets.pictures_per_creative)", () => {
  const { pictures_per_creative: _unset, ...before } = ADS_SETTINGS_UNSET.budgets;

  it("a settings version saved before V3 parses and makes three, as unset settings do", () => {
    expect(adsBudgetsSchema.parse(before).pictures_per_creative).toBe(3);
    expect(ADS_SETTINGS_UNSET.budgets.pictures_per_creative).toBe(3);
  });

  it("is from one — the ad as it was made before V3 — to the most the stored pairings and a person's choice can name", () => {
    const ok = (n: number) => adsBudgetsSchema.safeParse({ ...before, pictures_per_creative: n }).success;
    expect([0, 1, MAX_PICTURES_PER_CREATIVE, MAX_PICTURES_PER_CREATIVE + 1].map(ok)).toEqual([false, true, true, false]);
    expect(MAX_PICTURES_PER_CREATIVE).toBe(5);
  });
});
