import { describe, expect, it } from "vitest";
import { resizedSize, sendLimitsFor, TIER_LIMITS, visionTierOf, visualTokens } from "./visionTier.js";

/**
 * D-DR16 — every expected size below is ANTHROPIC'S, not computed by this file's code: the *Vision* and
 * *Coordinates* docs' worked examples (read 2026-10-10), and where marked LIVE, the size the API itself
 * named when asked on 2026-10-10 (an image block with `oversized_image: "error"` is refused with "would
 * be downsized to W×H" before any model runs). A transcription slip in `resizedSize` therefore fails
 * against the vendor's numbers, not against itself.
 *
 * One disagreement found that way: the Vision docs' table gives 1269×952 for a 2000×1500 image on the
 * standard tier; the reference implementation on the Coordinates page and the LIVE API both give
 * 1270×952 (1270 / (4/3) = 952.5 exactly, which the API rounds half to even). The API is the authority.
 */
const sz = (w: number, h: number) => ({ width: w, height: h });

describe("resizedSize — the docs' worked examples", () => {
  it("standard tier: the A4 scan at 130 DPI, both sides under 1568 px yet over the token budget", () => {
    expect(resizedSize(1075, 1520, TIER_LIMITS.standard)).toEqual(sz(924, 1307));
  });
  it("standard tier: 1920×1080 resizes to 1456×819, not 1568×882 (the token limit binds, not the edge)", () => {
    expect(resizedSize(1920, 1080, TIER_LIMITS.standard)).toEqual(sz(1456, 819));
  });
  it("standard tier: a 2000×1500 photo (Samsara's size, F-DR11) resizes to 1270×952 — LIVE, not the table's 1269", () => {
    expect(resizedSize(2000, 1500, TIER_LIMITS.standard)).toEqual(sz(1270, 952));
  });
  it("a 300 DPI letter page (2550×3300) is 952×1232 on the standard tier and 1688×2184 on the high — LIVE", () => {
    expect(resizedSize(2550, 3300, TIER_LIMITS.standard)).toEqual(sz(952, 1232));
    expect(resizedSize(2550, 3300, TIER_LIMITS.high)).toEqual(sz(1688, 2184));
  });
  it("standard tier: 3840×2160 resizes to 1456×819", () => {
    expect(resizedSize(3840, 2160, TIER_LIMITS.standard)).toEqual(sz(1456, 819));
  });
  it("high tier: 1920×1080 and 2000×1500 are not resized — LIVE on claude-sonnet-5-5", () => {
    expect(resizedSize(1920, 1080, TIER_LIMITS.high)).toEqual(sz(1920, 1080));
    expect(resizedSize(2000, 1500, TIER_LIMITS.high)).toEqual(sz(2000, 1500));
  });
  it("high tier: 3840×2160 resizes to 2576×1449 at 4784 tokens", () => {
    expect(resizedSize(3840, 2160, TIER_LIMITS.high)).toEqual(sz(2576, 1449));
    expect(visualTokens(2576, 1449)).toBe(4784);
  });
  it("an image that fits is returned unchanged on both tiers — never enlarged", () => {
    for (const t of [TIER_LIMITS.standard, TIER_LIMITS.high]) {
      expect(resizedSize(1000, 1000, t)).toEqual(sz(1000, 1000));
      expect(resizedSize(1092, 1092, t)).toEqual(sz(1092, 1092));
      expect(resizedSize(200, 200, t)).toEqual(sz(200, 200));
    }
  });
  it("the docs' token counts: 1000² is 1296, 1092² is 1521, 200² is 64", () => {
    expect(visualTokens(1000, 1000)).toBe(1296);
    expect(visualTokens(1092, 1092)).toBe(1521);
    expect(visualTokens(200, 200)).toBe(64);
  });
});

describe("visionTierOf — 'Claude 4.7 and later' is the high-resolution tier", () => {
  it("answers high for 4.7 and every later generation, with or without a date suffix", () => {
    for (const m of ["claude-opus-4-7", "claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-opus-4-7-20260101"])
      expect(visionTierOf(m)).toBe("high");
  });
  it("answers standard for the pinned pair and earlier generations", () => {
    for (const m of ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-sonnet-4-5-20250929", "claude-opus-4-1"])
      expect(visionTierOf(m)).toBe("standard");
  });
  it("answers standard — the size that fits both tiers — for an id it cannot read", () => {
    for (const m of ["claude-3-5-sonnet-20241022", "sonnet", "", "gpt-5"]) expect(visionTierOf(m)).toBe("standard");
  });
});

describe("sendLimitsFor", () => {
  it("is the model's tier for up to 20 images", () => {
    expect(sendLimitsFor("claude-sonnet-5-5", 20)).toEqual(TIER_LIMITS.high);
    expect(sendLimitsFor("claude-sonnet-4-6", 3)).toEqual(TIER_LIMITS.standard);
  });
  it("caps either side at 2000 px above 20 images, the docs' many-image limit", () => {
    expect(sendLimitsFor("claude-sonnet-5-5", 21)).toEqual({ maxEdge: 2000, maxTokens: 4784 });
    expect(sendLimitsFor("claude-sonnet-4-6", 21)).toEqual(TIER_LIMITS.standard);
  });
  it("counts the 28-px padding against the edge limit: above 20 images a wide page is held to 1988 px, not 2000", () => {
    // 1568 and 2576 are multiples of 28, so the padding only binds at the many-image limit (2000 = 71.4 × 28).
    // The reference implementation's rule (Coordinates docs), not measured live: it needs a 21-image request.
    expect(resizedSize(4000, 1000, sendLimitsFor("claude-sonnet-5-5", 21))).toEqual(sz(1988, 497));
  });
});
