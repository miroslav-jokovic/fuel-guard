import { describe, expect, it } from "vitest";
import { buildAdName, parseAdName, shortId, type AdNameParts } from "./naming.js";

const campaign: AdNameParts = {
  platform: "meta", level: "campaign", brief_source: "recruiting_opening", brief_ref: "op-1@v3",
  preset_key: "P2", day: "2026-11-02", campaign_short: shortId("AB12CD34-0000-4000-8000-000000000001"),
};
const ad: AdNameParts = { ...campaign, level: "ad", creative_short: "9f8e7d6c" };

describe("ad names", () => {
  it("a campaign name reads as the opening, the preset and the day", () => {
    expect(buildAdName(campaign)).toBe("S360|META|campaign|recruiting_opening|op-1@v3|P2|20261102|ab12cd34");
  });

  it.each([campaign, ad, { ...campaign, platform: "simulator" as const, level: "adset" as const }])(
    "round-trips: parse(build(x)) is x (%#)", (parts) => {
      expect(parseAdName(buildAdName(parts))).toEqual(parts);
    },
  );

  it.each([
    "Driver Recruiting – Fall 2026",
    "S360|META|campaign|recruiting_opening|op-1@v3|P2|20261102",
    "S360|META|campaign|recruiting_opening|op-1@v3|P2|20261102|ab12cd34|9f8e7d6c",
    "S360|META|ad|recruiting_opening|op-1@v3|P2|20261102|ab12cd34",
    "S360|GOOGLE|campaign|recruiting_opening|op-1@v3|P2|20261102|ab12cd34",
    "S360|META|campaign|recruiting_opening|op-1@v3|P2|20261302|ab12cd34",
    "S360|META|campaign|recruiting_opening|op-1@v3|p2|20261102|ab12cd34",
    "s360|META|campaign|recruiting_opening|op-1@v3|P2|20261102|ab12cd34",
    "S360|META|campaign|recruiting_opening|op-1@v3|P2|20261102|AB12CD34",
  ])("a name we did not build parses to null, never a guess: %s", (name) => {
    expect(parseAdName(name)).toBeNull();
  });

  it("refuses a field that would break the name", () => {
    expect(() => buildAdName({ ...campaign, brief_ref: "op|1" })).toThrow(/brief_ref/);
    expect(() => buildAdName({ ...campaign, brief_ref: "op 1" })).toThrow(/brief_ref/);
    expect(() => buildAdName({ ...campaign, preset_key: "p2" })).toThrow(/preset_key/);
    expect(() => buildAdName({ ...campaign, day: "11/02/2026" })).toThrow(/day/);
    expect(() => buildAdName({ ...campaign, creative_short: "9f8e7d6c" })).toThrow(/creative_short/);
    expect(() => buildAdName({ ...ad, creative_short: undefined })).toThrow(/creative_short/);
  });

  it("a short id is the uuid's first 8 hex, lower case", () => {
    expect(shortId("AB12CD34-ffff-4000-8000-000000000001")).toBe("ab12cd34");
    expect(() => shortId("not-a-uuid")).toThrow();
  });
});
