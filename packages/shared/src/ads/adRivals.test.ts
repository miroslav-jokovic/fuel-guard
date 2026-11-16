import { describe, expect, it } from "vitest";
import { adRivals, adsCopyChoiceSchema, type AdPairingsView } from "./campaignContract.js";

const picture = (n: number, dropped: string | null = null) => ({ picture: n, attempt: 1, reference: null, focal_subject: "tractor" as const, camera_distance: "medium" as const, dropped });
const pairing = (pic: number, words: number, total: number | null, url: string | null = `https://store/${pic}-${words}`) => ({
  picture: pic, words, judged: null, total, preview: url === null ? null : { sha256: "a".repeat(64), path: `o/${pic}-${words}.png`, width: 1080, height: 1350, url },
});
const view = (over: Partial<AdPairingsView>): AdPairingsView => ({ format: "4:5", pictures: [picture(1), picture(2), picture(3)], ranked: [pairing(1, 0, 17)], chosen: 0, judge: "finishedAdJudge@1", ...over });

describe("what the review screen shows of an ad's rivals (V3)", () => {
  it("lists every pairing in rank order, marks the one that is the ad, and calls the ones within a point of the best as good", () => {
    const shown = adRivals(view({ ranked: [pairing(1, 0, 17), pairing(2, 1, 18), pairing(3, 0, 15), pairing(2, 0, null)] }));
    expect(shown.judged).toBe(true);
    expect(shown.rivals.map((r) => [r.rank, r.picture, r.words, r.total, r.chosen, r.asGood])).toEqual([
      [1, 1, 0, 17, true, true], [2, 2, 1, 18, false, true], [3, 3, 0, 15, false, false], [4, 2, 0, null, false, false],
    ]);
    expect(shown.rivals[0]!.url).toBe("https://store/1-0");
  });

  it("with nothing judged no pairing is called as good, and the screen is told the judge did not rank", () => {
    const shown = adRivals(view({ judge: null, ranked: [pairing(1, 0, null), pairing(2, 0, null)] }));
    expect(shown.judged).toBe(false);
    expect(shown.rivals.map((r) => r.asGood)).toEqual([false, false]);
  });

  it("names each picture that was made and not used, with compose's own reason, and a pairing with no image has no link", () => {
    const shown = adRivals(view({ pictures: [picture(1), picture(2, "art check: repeats_earlier_picture"), picture(3)], ranked: [pairing(1, 0, 17, null)] }));
    expect(shown.unused).toEqual([{ picture: 2, reason: "art check: repeats_earlier_picture" }]);
    expect(shown.rivals[0]!.url).toBeNull();
  });
});

describe("a person's choice may name the picture (0619)", () => {
  const copy = { en: { hook: "Home every night" }, es: { hook: "En casa cada noche" } };
  it("absent and null both mean the picture the ad has; a named picture is from one to five", () => {
    expect(adsCopyChoiceSchema.parse({ from_candidate: null, copy }).picture).toBeUndefined();
    expect(adsCopyChoiceSchema.safeParse({ from_candidate: null, copy, picture: null }).success).toBe(true);
    expect([0, 1, 5, 6, 1.5].map((picture) => adsCopyChoiceSchema.safeParse({ from_candidate: 0, copy, picture }).success)).toEqual([false, true, true, false, false]);
  });
});
