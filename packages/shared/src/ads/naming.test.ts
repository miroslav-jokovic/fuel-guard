import { describe, expect, it } from "vitest";
import { AD_NAME_ALL_PRESETS, buildAdName, parseAdName, shortId, type AdNameParts } from "./naming.js";

const campaign: AdNameParts = {
  platform: "meta", level: "campaign", brief_source: "recruiting_opening", brief_ref: "op-1@v3",
  preset_key: "ALL", day: "2026-11-02", campaign_short: shortId("AB12CD34-0000-4000-8000-000000000001"),
};
const ad: AdNameParts = { ...campaign, level: "ad", preset_key: "P2", creative_short: "9f8e7d6c", language: "es" };
const form: AdNameParts = { ...campaign, level: "form", language: "en" };

describe("ad names", () => {
  it("a campaign name reads as the opening, the preset and the day", () => {
    expect(buildAdName(campaign)).toBe("S360|META|campaign|recruiting_opening|op-1@v3|ALL|20261102|ab12cd34");
  });

  it("a form and an ad end with their language; nothing above them carries one", () => {
    expect(buildAdName(form)).toBe("S360|META|form|recruiting_opening|op-1@v3|ALL|20261102|ab12cd34|EN");
    expect(buildAdName(ad)).toBe("S360|META|ad|recruiting_opening|op-1@v3|P2|20261102|ab12cd34|9f8e7d6c|ES");
    expect(buildAdName({ ...ad, language: "en" })).not.toBe(buildAdName(ad));
    expect(() => buildAdName({ ...campaign, language: "en" })).toThrow(/language/);
    expect(() => buildAdName({ ...form, language: undefined })).toThrow(/language/);
    expect(() => buildAdName({ ...ad, language: "fr" as never })).toThrow(/language/);
  });

  it.each([campaign, ad, form, { ...campaign, platform: "simulator" as const, level: "adset" as const }])(
    "round-trips: parse(build(x)) is x (%#)", (parts) => {
      expect(parseAdName(buildAdName(parts))).toEqual(parts);
    },
  );

  it.each([
    "Driver Recruiting – Fall 2026",
    "S360|META|campaign|recruiting_opening|op-1@v3|ALL|20261102",
    "S360|META|campaign|recruiting_opening|op-1@v3|ALL|20261102|ab12cd34|9f8e7d6c",
    "S360|META|ad|recruiting_opening|op-1@v3|P2|20261102|ab12cd34",
    "S360|META|ad|recruiting_opening|op-1@v3|P2|20261102|ab12cd34|9f8e7d6c",
    "S360|META|ad|recruiting_opening|op-1@v3|P2|20261102|ab12cd34|9f8e7d6c|es",
    "S360|META|form|recruiting_opening|op-1@v3|ALL|20261102|ab12cd34",
    "S360|META|form|recruiting_opening|op-1@v3|ALL|20261102|ab12cd34|9f8e7d6c|EN",
    "S360|META|adset|recruiting_opening|op-1@v3|ALL|20261102|ab12cd34|EN",
    "S360|GOOGLE|campaign|recruiting_opening|op-1@v3|ALL|20261102|ab12cd34",
    "S360|META|campaign|recruiting_opening|op-1@v3|ALL|20261302|ab12cd34",
    "S360|META|campaign|recruiting_opening|op-1@v3|all|20261102|ab12cd34",
    "s360|META|campaign|recruiting_opening|op-1@v3|ALL|20261102|ab12cd34",
    "S360|META|campaign|recruiting_opening|op-1@v3|ALL|20261102|AB12CD34",
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

  it("only an ad names a preset; every level above it carries ALL, because a campaign runs several", () => {
    expect(() => buildAdName({ ...campaign, preset_key: "P2" })).toThrow(/preset_key/);
    expect(() => buildAdName({ ...campaign, level: "adset", preset_key: "P2" })).toThrow(/preset_key/);
    expect(() => buildAdName({ ...ad, preset_key: AD_NAME_ALL_PRESETS })).toThrow(/preset_key/);
    expect(parseAdName("S360|META|campaign|recruiting_opening|op-1@v3|P2|20261102|ab12cd34")).toBeNull();
    expect(parseAdName("S360|META|ad|recruiting_opening|op-1@v3|ALL|20261102|ab12cd34|9f8e7d6c|EN")).toBeNull();
  });

  it("a short id is the uuid's first 8 hex, lower case", () => {
    expect(shortId("AB12CD34-ffff-4000-8000-000000000001")).toBe("ab12cd34");
    expect(() => shortId("not-a-uuid")).toThrow();
  });
});
