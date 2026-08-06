import { describe, expect, it } from "vitest";
import { BUNDLED_DEFAULT_CONFIG } from "../src/config.js";
import { evaluateGate, type GateInput, type ImageMetrics } from "../src/gate.js";
import type { OcrEvidence } from "../src/contracts.js";

const cfg = BUNDLED_DEFAULT_CONFIG;

function goodOcr(over: Partial<OcrEvidence> = {}): OcrEvidence {
  return {
    engine: "test.ocr",
    recognizedChars: 400,
    recognizedWords: 90,
    textCoverageFraction: 0.3,
    medianCharHeightPx: 28,
    smallTextBandCoverage: 0.05,
    meanConfidence: 0.9,
    numberTokens: ["1203", "UN1203"],
    available: true,
    ...over,
  };
}

function input(metrics: Partial<ImageMetrics>, ocr = goodOcr(), platform: "ios" | "android" = "ios"): GateInput {
  return { metrics: { longEdgePx: 1600, ...metrics }, ocr, platform };
}

describe("evaluateGate — acceptance", () => {
  it("accepts a good page: no reasons, passed, score 1", () => {
    const r = evaluateGate(input({ longEdgePx: 1600, blurVariance: 300, glareFraction: 0.01 }), cfg);
    expect(r.passed).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.score).toBe(1);
    expect(r.ocrDegraded).toBe(false);
  });
});

describe("evaluateGate — image gates (the pre-upload DoD)", () => {
  it("rejects sub-1200px BEFORE anything else", () => {
    const r = evaluateGate(input({ longEdgePx: 1100 }), cfg);
    expect(r.passed).toBe(false);
    expect(r.reasons).toContain("RESOLUTION_TOO_LOW");
  });
  it("rejects a blurry page when blur is measurable", () => {
    const r = evaluateGate(input({ blurVariance: 40 }), cfg);
    expect(r.reasons).toContain("IMAGE_BLURRED");
    expect(r.passed).toBe(false);
  });
  it("rejects glare over the threshold", () => {
    const r = evaluateGate(input({ glareFraction: 0.2 }), cfg);
    expect(r.reasons).toContain("GLARE_OVER_TEXT");
  });
  it("leaves blur/glare as na (not a silent pass) when unmeasured", () => {
    const r = evaluateGate(input({ longEdgePx: 1600 }), cfg);
    const blur = r.checks.find((c) => c.name === "blur");
    expect(blur?.status).toBe("na");
    expect(r.passed).toBe(true); // image gates that ARE measurable pass; server backstop covers blur
  });
});

describe("evaluateGate — §5 legibility", () => {
  it("degrades closed + flags when OCR is unavailable", () => {
    const r = evaluateGate(input({ blurVariance: 300 }, { ...goodOcr(), available: false }), cfg);
    expect(r.ocrDegraded).toBe(true);
    expect(r.checks.find((c) => c.name === "ocrLegibility")?.status).toBe("na");
  });
  it("PAGE_INCOMPLETE when too little text was recognized", () => {
    const r = evaluateGate(input({ blurVariance: 300 }, goodOcr({ recognizedChars: 10, recognizedWords: 3 })), cfg);
    expect(r.reasons).toContain("PAGE_INCOMPLETE");
  });
  it("TEXT_ILLEGIBLE when glyphs are too small", () => {
    const r = evaluateGate(input({ blurVariance: 300 }, goodOcr({ medianCharHeightPx: 8 })), cfg);
    expect(r.reasons).toContain("TEXT_ILLEGIBLE");
  });
  it("confidence is only secondary — a low confidence with good geometry still cautions to TEXT_ILLEGIBLE", () => {
    const r = evaluateGate(input({ blurVariance: 300 }, goodOcr({ meanConfidence: 0.1 })), cfg);
    expect(r.reasons).toContain("TEXT_ILLEGIBLE");
  });
});
