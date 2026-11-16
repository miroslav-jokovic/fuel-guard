import { describe, expect, it } from "vitest";
import { META_FEED_TEXT, feedImageOf, feedTextNotes, platformText } from "./platformText.js";

const SLOTS = { primary_text: "primary_text", headline: "headline" };

describe("the words Meta is handed beside the image", () => {
  it("are the two slots the preset names, whatever else the copy holds", () => {
    expect(platformText({ hook: "On the image", cta: "Apply", primary_text: "Above the picture.", headline: "Under it" }, SLOTS)).toEqual({ primary_text: "Above the picture.", headline: "Under it" });
    expect(platformText({ a: "First", b: "Second" }, { primary_text: "b", headline: "a" })).toEqual({ primary_text: "Second", headline: "First" });
  });

  it("are nothing when the preset names no slots, the copy is missing, or either text is", () => {
    expect(platformText({ primary_text: "x", headline: "y" }, null)).toBeNull();
    expect(platformText(undefined, SLOTS)).toBeNull();
    expect(platformText({ primary_text: "x" }, SLOTS)).toBeNull();
    expect(platformText({ primary_text: "", headline: "y" }, SLOTS)).toBeNull();
  });
});

describe("the image a feed ad shows", () => {
  const assets = [{ format: "1:1" as const, language: "en", id: 1 }, { format: "4:5" as const, language: "en", id: 2 }, { format: "1:1" as const, language: "es", id: 3 }, { format: "9:16" as const, language: "es", id: 4 }];
  it("is 4:5 when the creative has one in that language, else 1:1, and never 9:16", () => {
    expect(feedImageOf(assets, "en")?.id).toBe(2);
    expect(feedImageOf(assets, "es")?.id).toBe(3);
    expect(feedImageOf(assets.filter((a) => a.format === "9:16"), "es")).toBeNull();
  });
});

describe("what a reviewer is told against Meta's recommendations for the feed", () => {
  const text = (primary: number, headline: number) => ({ primary_text: "p".repeat(primary), headline: "h".repeat(headline) });
  it("says nothing when both texts are inside them, at the edges too", () => {
    expect(feedTextNotes(text(META_FEED_TEXT.primary_min_chars, META_FEED_TEXT.headline_chars))).toEqual([]);
    expect(feedTextNotes(text(META_FEED_TEXT.primary_max_chars, 1))).toEqual([]);
  });

  it("names each text that runs past its figure, with the count and the figure", () => {
    expect(feedTextNotes(text(151, 28))).toEqual([
      'The text above the picture is 151 characters. Meta recommends 50 to 150, and shows only the start of a longer one until a person taps "See more".',
      "The headline under the picture is 28 characters. Meta recommends 27; a longer one may be cut.",
    ]);
    expect(feedTextNotes(text(49, 10))).toEqual(["The text above the picture is 49 characters. Meta recommends 50 to 150."]);
  });

  it("counts characters, not code units: an accented or astral character is one", () => {
    expect(feedTextNotes({ primary_text: "ñ".repeat(150), headline: "😀".repeat(27) })).toEqual([]);
  });
});
