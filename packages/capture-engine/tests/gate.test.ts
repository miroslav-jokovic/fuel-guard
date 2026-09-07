import { describe, expect, it } from "vitest";
import { BUNDLED_DEFAULT_CONFIG, type CaptureConfig, type CaptureConfigGates } from "../src/config.js";
import { evaluateGate, type GateInput, type ImageMetrics } from "../src/gate.js";
import type { OcrEvidence } from "../src/contracts.js";

const cfg = BUNDLED_DEFAULT_CONFIG;

/**
 * A config whose shadow thresholds (D-SCAN10) are given live numbers, so the ENFORCING path stays
 * pinned after Step 3.3 retired the shipped ones to `null`.
 *
 * ⚠ The numbers below are TEST FIXTURES and nothing else. They are the values the bundled config
 * carried before 2026-09-07, chosen here only because the assertions were already written against
 * them; none of them was ever calibrated, which is exactly why the shipped config no longer has
 * them. Step 5.2 derives the real ones from a measured distribution. Do not read a threshold out of
 * this file.
 */
function enforcing(over: Partial<CaptureConfigGates> = {}): CaptureConfig {
  return {
    ...cfg,
    gates: {
      ...cfg.gates,
      blurLaplacianVarMin: 100,
      glareClippedFractionMax: 0.06,
      shadowRangeMax: 0.55,
      brightnessMeanRange: [0.35, 0.85],
      contrastRmsMin: 0.18,
      ...over,
    },
  };
}

const statusOf = (r: ReturnType<typeof evaluateGate>, name: string) =>
  r.checks.find((c) => c.name === name)?.status;

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

function input(metrics: Partial<ImageMetrics>, ocr = goodOcr(), platform: "ios" | "android" | "web" = "ios"): GateInput {
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
  it("rejects a blurry page when blur is measurable AND its floor is live", () => {
    const r = evaluateGate(input({ blurVariance: 40 }), enforcing());
    expect(r.reasons).toContain("IMAGE_BLURRED");
    expect(r.passed).toBe(false);
  });
  it("rejects glare over a live threshold", () => {
    const r = evaluateGate(input({ glareFraction: 0.2 }), enforcing());
    expect(r.reasons).toContain("GLARE_OVER_TEXT");
  });
  it("leaves blur/glare as na (not a silent pass) when unmeasured", () => {
    const r = evaluateGate(input({ longEdgePx: 1600 }), cfg);
    const blur = r.checks.find((c) => c.name === "blur");
    expect(blur?.status).toBe("na");
    expect(r.passed).toBe(true); // image gates that ARE measurable pass; server backstop covers blur
  });
});

describe("evaluateGate — shadow mode (D-SCAN10): a retired threshold is `na`, never a pass", () => {
  // The plan's Step 3.3 states the failure this whole block exists to stop: "a `null` silently
  // coerced to `0` would pass everything". The metrics below are deliberately DISASTROUS — a page
  // this blurry, this blown out and this dark would be refused by any floor anybody ever derives —
  // so a check that reports `pass` here can only be reporting on a coerced zero.
  const ruinous: Partial<ImageMetrics> = {
    blurVariance: 0,
    glareFraction: 1,
    shadowRange: 1,
    brightnessMean: 0,
    contrastRms: 0,
  };

  it("reports na for every threshold the shipped config has retired", () => {
    const r = evaluateGate(input(ruinous), cfg);
    expect(statusOf(r, "blur")).toBe("na");
    expect(statusOf(r, "glare")).toBe("na");
    expect(statusOf(r, "shadow")).toBe("na");
    expect(statusOf(r, "brightness")).toBe("na");
    expect(statusOf(r, "contrast")).toBe("na");
    expect(r.reasons).toEqual([]);
  });

  it("rejects the same page once those thresholds are live, so `na` is the config and not the code", () => {
    // Without this, the case above passes just as well against a gate that lost the ability to
    // reject at all — which is the shape of every reassuring test that turned out to be measuring
    // nothing. Same metrics, same input, only the config differs.
    const r = evaluateGate(input(ruinous), enforcing());
    expect(r.reasons).toEqual(
      expect.arrayContaining(["IMAGE_BLURRED", "GLARE_OVER_TEXT", "SHADOW_OVER_TEXT", "UNDER_OR_OVER_EXPOSED", "LOW_CONTRAST"]),
    );
  });

  it("keeps enforcing a threshold that was DERIVED as zero", () => {
    // `isEnforcing` is `!== null`, not truthiness, and this is the case that separates them. Zero is
    // a legitimate value for `glareClippedFractionMax` — a fraction whose ideal is none at all — and
    // `if (floor)` would retire it by accident, which is a gate switching itself off with nobody
    // editing a config.
    const r = evaluateGate(input({ glareFraction: 0.01 }), enforcing({ glareClippedFractionMax: 0 }));
    expect(statusOf(r, "glare")).toBe("fail");
    expect(r.reasons).toContain("GLARE_OVER_TEXT");
  });

  it("does not let a retired threshold inflate the accept score", () => {
    // `na` checks are excluded from the denominator, so retiring five of them must not turn a
    // partial pass into a whole one. Resolution fails; the score is over what remains applicable.
    const r = evaluateGate(input({ ...ruinous, longEdgePx: 900 }), cfg);
    expect(r.passed).toBe(false);
    expect(r.reasons).toContain("RESOLUTION_TOO_LOW");
    expect(r.checks.filter((c) => c.status === "pass").every((c) => c.name !== "blur")).toBe(true);
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

/**
 * The `web` platform (A7 / D-APP11) — the applicant's own browser, reached from the application link.
 *
 * ⚠ It deliberately carries no thresholds of its own, and that is the finding rather than a shortcut.
 * The web provider measures ONE metric, `longEdgePx`, so a web-specific blur or glare floor would be a
 * number the gate never reads; and the one threshold that does apply — the resolution floor — is
 * pinned to the server's authoritative usability gate, where a client-side divergence would either
 * reject photographs the server accepts or spend a driver's bandwidth on ones it will refuse.
 */
describe("evaluateGate — the web platform", () => {
  const webMetrics = { longEdgePx: 1600 };
  const noOcr = (): OcrEvidence => ({ ...goodOcr(), available: false });

  it("holds the same resolution floor the server holds", () => {
    const under = evaluateGate(input({ longEdgePx: 900 }, noOcr(), "web"), cfg);
    expect(under.reasons).toContain("RESOLUTION_TOO_LOW");
    expect(under.passed).toBe(false);

    const over = evaluateGate(input(webMetrics, noOcr(), "web"), cfg);
    expect(over.passed).toBe(true);
  });

  it("reaches the same verdict as the driver app's JS fallback for the same measurements", () => {
    // The two providers measure identically, so they must decide identically: a licence photographed
    // in the driver app and one photographed from the application link are the same photograph.
    const web = evaluateGate(input(webMetrics, noOcr(), "web"), cfg);
    const android = evaluateGate(input(webMetrics, noOcr(), "android"), cfg);
    expect(web.passed).toBe(android.passed);
    expect(web.score).toBe(android.score);
    expect(web.checks.map((c) => `${c.name}:${c.status}`)).toEqual(
      android.checks.map((c) => `${c.name}:${c.status}`),
    );
  });

  it("degrades legibility closed, because a browser runs no OCR", () => {
    const r = evaluateGate(input(webMetrics, noOcr(), "web"), cfg);
    expect(r.ocrDegraded).toBe(true);
    expect(r.checks.find((c) => c.name === "ocrLegibility")?.status).toBe("na");
  });
});
