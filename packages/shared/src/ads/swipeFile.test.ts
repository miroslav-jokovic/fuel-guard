import { describe, expect, it } from "vitest";
import { evidencePackSchema } from "./campaignPlan.js";
import { checkPageReading, figuresIn, normaliseForQuote, pageEvidence, pictureEvidence, type PageReading } from "./swipeFile.js";

// A competitor's job page as the fetch hands it on: lines broken where HTML broke them, typographic quotes kept.
const PAGE = `Regional Class A Driver – Flatbed
Earn up to $0.68 per mile,   home every weekend.
New 2025 Peterbilt 579s. “Our drivers come first.” $5,000 sign-on bonus after 90 days.
Requires 1 year of verifiable OTR experience.`;

const reading = (items: PageReading["items"]): PageReading => ({ items });

describe("checkPageReading", () => {
  it("keeps an item whose quote is on the page and whose figures are in its quote, across line breaks and curly quotes", () => {
    const out = checkPageReading(reading([
      { topic: "pay", sentence: "They pay up to $0.68 per mile.", quote: "Earn up to $0.68 per mile, home every weekend." },
      { topic: "other", sentence: "They say their drivers come first.", quote: '"Our drivers come first."' },
      { topic: "sign_on", sentence: "A $5,000 sign-on bonus is paid after 90 days.", quote: "$5,000 sign-on bonus after 90 days" },
    ]), PAGE);
    expect(out.dropped).toEqual([]);
    expect(out.kept).toHaveLength(3);
  });

  it("drops a quote the page does not hold — a paraphrase, an invention, or a planted page's own instruction reworded", () => {
    const out = checkPageReading(reading([
      { topic: "pay", sentence: "They pay up to $0.68 per mile.", quote: "Earn as much as $0.68 per mile" },
      { topic: "benefits", sentence: "They offer full health insurance.", quote: "full health insurance from day one" },
    ]), PAGE);
    expect(out.kept).toEqual([]);
    expect(out.dropped).toEqual([{ index: 0, reason: "quote_not_on_page" }, { index: 1, reason: "quote_not_on_page" }]);
  });

  it("drops an item whose sentence states a figure its quote does not", () => {
    const out = checkPageReading(reading([
      { topic: "pay", sentence: "They pay $0.70 per mile.", quote: "Earn up to $0.68 per mile" },
      { topic: "home_time", sentence: "Drivers are home every 7 days.", quote: "home every weekend" },
      { topic: "sign_on", sentence: "The bonus is $5,000.00.", quote: "$5,000 sign-on bonus" },
    ]), PAGE);
    expect(out.dropped).toEqual([{ index: 0, reason: "figure_not_in_quote", figure: "0.70" }, { index: 1, reason: "figure_not_in_quote", figure: "7" }]);
    expect(out.kept.map((k) => k.topic)).toEqual(["sign_on"]);
  });

  it("is case-sensitive, so a quote cannot be stitched from words that exist only in another case", () => {
    expect(checkPageReading(reading([{ topic: "lanes", sentence: "It is a regional job.", quote: "regional class a driver" }]), PAGE).dropped).toHaveLength(1);
  });
});

describe("figuresIn and normaliseForQuote", () => {
  it("reads money, counts and decimals as plain digit strings", () => {
    expect(figuresIn("$1,250.00 a week, 3 days, up to 0.68.")).toEqual(["1250.00", "3", "0.68"]);
  });
  it("writes typographic quotes, dashes and whitespace runs as their plain forms and nothing else", () => {
    expect(normaliseForQuote("“A”  –\n‘b’")).toBe(`"A" - 'b'`);
  });
});

describe("the evidence a reading becomes", () => {
  const id = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  it("writes a page's kept items as market items naming the site, each with the page as its source", () => {
    const items = pageEvidence({ id, kind: "page", url: "https://www.example-carrier.com/jobs/regional", note: null, reading: [
      { topic: "pay", sentence: "They pay up to $0.68 per mile.", quote: "Earn up to $0.68 per mile" },
    ] });
    expect(items).toEqual([{ id: "market:page_7a1b2c3d4e5f_1", kind: "market", source: "https://www.example-carrier.com/jobs/regional",
      text: "A job page on example-carrier.com, saved by our recruiters, says (pay): They pay up to $0.68 per mile." }]);
    expect(evidencePackSchema.safeParse(items).success).toBe(true);
  });

  it("writes a picture's reading as one swipe item, its words marked as read", () => {
    const item = pictureEvidence({ id, kind: "picture", url: null, note: "seen on Facebook", reading: {
      hook_family: "pay_first", scene_family: "equipment_on_road", words: ["$1,800 a week", "Home weekends"], summary: "It offers regional work with weekly pay.",
    } });
    expect(item).toEqual({ id: "swipe:7a1b2c3d4e5f", kind: "swipe", source: null,
      text: `A competitor's ad saved by our recruiters ("seen on Facebook"). What it leads with: pay first. What its picture shows: truck on the road. It offers regional work with weekly pay. Its words, as read: "$1,800 a week / Home weekends".` });
    expect(evidencePackSchema.safeParse([item]).success).toBe(true);
  });

  it("cuts a sentence past the pack's 400 characters at a word", () => {
    const item = pictureEvidence({ id, kind: "picture", url: null, note: "x".repeat(300), reading: {
      hook_family: "proof", scene_family: "cab_pov", words: [], summary: "It shows a driver's own words about the company and nothing else at all.",
    } });
    expect(item.text.length).toBeLessThanOrEqual(400);
    expect(item.text.endsWith("…")).toBe(true);
  });
});
