import { describe, expect, it } from "vitest";
import { swipeDroppedWords, swipeEmptyWords, swipeReadingLines, swipeTitle } from "./adsSwipeWords";

describe("swipeTitle", () => {
  it("a page is its address without the scheme, the www and a trailing slash; a picture is its note", () => {
    expect(swipeTitle({ kind: "page", url: "https://www.carrier.com/jobs/", note: null })).toBe("carrier.com/jobs");
    expect(swipeTitle({ kind: "picture", url: null, note: "Seen on Facebook" })).toBe("Seen on Facebook");
    expect(swipeTitle({ kind: "picture", url: null, note: null })).toBe("A competitor's ad");
  });
});

describe("swipeReadingLines", () => {
  it("a page's kept facts carry their topic and the quote they were checked against", () => {
    expect(swipeReadingLines({ kind: "page", reading: [{ topic: "sign_on", sentence: "Pays a $5,000 sign-on bonus.", quote: "$5,000 sign-on" }] }))
      .toEqual([{ key: "fact0", label: "Sign-on bonus", value: "Pays a $5,000 sign-on bonus.", quote: "$5,000 sign-on" }]);
  });

  it("a picture says what it leads with, shows and offers, and its words as read", () => {
    const lines = swipeReadingLines({ kind: "picture", reading: { hook_family: "pay_first", scene_family: "cab_pov", words: ["$0.70 CPM", "Home weekly"], summary: "Pays by the mile and home every week." } });
    expect(lines.map((l) => `${l.label}: ${l.value}`)).toEqual([
      "Leads with: pay first", "Shows: from the cab", "Offers: Pays by the mile and home every week.", "Its words, as read: $0.70 CPM / Home weekly",
    ]);
  });

  it("an entry not yet read has no lines", () => {
    expect(swipeReadingLines({ kind: "page", reading: null })).toEqual([]);
  });
});

describe("swipeDroppedWords", () => {
  it("names how many facts the check left out, and why, with the figure it caught", () => {
    expect(swipeDroppedWords([
      { index: 0, reason: "quote_not_on_page" }, { index: 2, reason: "figure_not_in_quote", figure: "0.70" },
    ])).toBe("2 facts not kept: 1 because its quote is not on the page, 1 because it gave a figure (0.70) its quote does not.");
  });

  it("nothing dropped says nothing", () => {
    expect(swipeDroppedWords([])).toBeNull();
  });
});

describe("swipeEmptyWords", () => {
  it("a read page with nothing kept says so, so it is not mistaken for one still being read", () => {
    expect(swipeEmptyWords({ state: "read", kind: "page", reading: [], last_error: null })).toBe("Read, but nothing on it could be kept as a fact.");
    expect(swipeEmptyWords({ state: "waiting", kind: "page", reading: null, last_error: null })).toBe("Being read. This list updates by itself.");
    expect(swipeEmptyWords({ state: "unreadable", kind: "page", reading: null, last_error: "The page answered 403." })).toBe("The page answered 403.");
  });
});
