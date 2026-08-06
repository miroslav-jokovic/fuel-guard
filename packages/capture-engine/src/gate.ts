/**
 * Quality Validation Engine — the §5 accept/reject gate (DCE §5). OUR code, config-driven, pure.
 *
 * Geometry + coverage FIRST (both platforms expose these reliably); OCR confidence is a SECONDARY,
 * platform-tuned signal only — it can add caution, never rescue (DCE §12 #3). Legibility, not
 * correctness: the gate never reads meaning, only asks "is this page readable enough to trust the
 * downstream extraction?". Degraded OCR fails CLOSED — it degrades to the image-only checks and FLAGS
 * it (`ocrDegraded`), never silently passing legibility.
 *
 * Pure: metrics in (measured by a provider), a QualityReport out. No IO, no image access here.
 */

import type { CaptureConfig } from "./config";
import type { CheckName, CheckResult, OcrEvidence, QualityReport, RejectionReason } from "./contracts";

/**
 * Metrics a provider measures on the page image. Every field except `longEdgePx` is optional: a
 * provider reports only what it can measure reliably, and an unmeasured check becomes `na` (never a
 * silent pass). The JS fallback provider, for instance, reliably supplies only `longEdgePx`.
 */
export interface ImageMetrics {
  longEdgePx: number;
  blurVariance?: number;
  glareFraction?: number;
  shadowRange?: number;
  brightnessMean?: number;
  contrastRms?: number;
  coverageFraction?: number;
  documentDetected?: boolean;
  /** v2/raw-capture only — `na` on the SystemScanner path. */
  perspectiveSeverity?: number;
  lensSmudge?: number;
}

export interface GateInput {
  metrics: ImageMetrics;
  ocr: OcrEvidence;
  platform: "ios" | "android";
}

function pass(name: CheckName, score: number, detail?: CheckResult["detail"]): CheckResult {
  return detail ? { name, status: "pass", score, detail } : { name, status: "pass", score };
}
function fail(name: CheckName, score: number, detail?: CheckResult["detail"]): CheckResult {
  return detail ? { name, status: "fail", score, detail } : { name, status: "fail", score };
}
function na(name: CheckName): CheckResult {
  return { name, status: "na" };
}

/** Evaluate the §5 gate. Deterministic; the caller shows `report.reasons` to the driver on reject. */
export function evaluateGate(input: GateInput, config: CaptureConfig): QualityReport {
  const { metrics, ocr, platform } = input;
  const g = config.gates;
  const checks: CheckResult[] = [];
  const reasons: RejectionReason[] = [];

  const reject = (check: CheckResult, reason: RejectionReason): void => {
    checks.push(check);
    reasons.push(reason);
  };

  // ── resolution (always applicable; the hard floor enforced BEFORE upload — PLAN M6 DoD) ──
  if (metrics.longEdgePx >= g.resolutionMinLongEdgePx) {
    checks.push(pass("resolution", 1, { longEdgePx: metrics.longEdgePx }));
  } else {
    reject(fail("resolution", 0, { longEdgePx: metrics.longEdgePx }), "RESOLUTION_TOO_LOW");
  }

  // ── documentDetected (optional) ──
  if (metrics.documentDetected === undefined) checks.push(na("documentDetected"));
  else if (metrics.documentDetected) checks.push(pass("documentDetected", 1));
  else reject(fail("documentDetected", 0), "DOCUMENT_NOT_DETECTED");

  // ── coverage (optional) ──
  if (metrics.coverageFraction === undefined) checks.push(na("coverage"));
  else if (metrics.coverageFraction >= g.coverageMinFraction) {
    checks.push(pass("coverage", metrics.coverageFraction, { coverageFraction: metrics.coverageFraction }));
  } else {
    reject(fail("coverage", metrics.coverageFraction, { coverageFraction: metrics.coverageFraction }), "PAGE_INCOMPLETE");
  }

  // ── blur (optional — JS fallback cannot measure it; server usabilityGate is the backstop) ──
  if (metrics.blurVariance === undefined) checks.push(na("blur"));
  else if (metrics.blurVariance >= g.blurLaplacianVarMin) {
    checks.push(pass("blur", 1, { blurVariance: metrics.blurVariance }));
  } else {
    reject(fail("blur", 0, { blurVariance: metrics.blurVariance }), "IMAGE_BLURRED");
  }

  // ── glare (optional) ──
  if (metrics.glareFraction === undefined) checks.push(na("glare"));
  else if (metrics.glareFraction <= g.glareClippedFractionMax) {
    checks.push(pass("glare", 1, { glareFraction: metrics.glareFraction }));
  } else {
    reject(fail("glare", 0, { glareFraction: metrics.glareFraction }), "GLARE_OVER_TEXT");
  }

  // ── shadow (optional; v2/native) ──
  if (metrics.shadowRange === undefined) checks.push(na("shadow"));
  else if (metrics.shadowRange <= g.shadowRangeMax) checks.push(pass("shadow", 1, { shadowRange: metrics.shadowRange }));
  else reject(fail("shadow", 0, { shadowRange: metrics.shadowRange }), "SHADOW_OVER_TEXT");

  // ── brightness (optional) ──
  if (metrics.brightnessMean === undefined) checks.push(na("brightness"));
  else if (metrics.brightnessMean >= g.brightnessMeanRange[0] && metrics.brightnessMean <= g.brightnessMeanRange[1]) {
    checks.push(pass("brightness", 1, { brightnessMean: metrics.brightnessMean }));
  } else {
    reject(fail("brightness", 0, { brightnessMean: metrics.brightnessMean }), "UNDER_OR_OVER_EXPOSED");
  }

  // ── contrast (optional) ──
  if (metrics.contrastRms === undefined) checks.push(na("contrast"));
  else if (metrics.contrastRms >= g.contrastRmsMin) checks.push(pass("contrast", 1, { contrastRms: metrics.contrastRms }));
  else reject(fail("contrast", 0, { contrastRms: metrics.contrastRms }), "LOW_CONTRAST");

  // ── perspective / lens smudge (v2 raw-frame only) ──
  checks.push(metrics.perspectiveSeverity === undefined ? na("perspectiveSeverity")
    : metrics.perspectiveSeverity <= 1 ? pass("perspectiveSeverity", 1) : fail("perspectiveSeverity", 0));
  checks.push(metrics.lensSmudge === undefined ? na("lensSmudge")
    : metrics.lensSmudge <= 1 ? pass("lensSmudge", 1) : fail("lensSmudge", 0));

  // ── OCR legibility (§5 — geometry/coverage-led, confidence secondary) ──
  let ocrDegraded = false;
  if (!config.ocrLegibility.enabled) {
    checks.push(na("ocrLegibility"));
  } else if (!ocr.available) {
    // Degrade to image-only checks, and FLAG it (fails closed — never silent-passes legibility).
    ocrDegraded = true;
    checks.push(na("ocrLegibility"));
  } else {
    const o = config.ocrLegibility;
    const geometryOk =
      ocr.recognizedChars >= o.minRecognizedChars &&
      ocr.recognizedWords >= o.minRecognizedWords &&
      ocr.textCoverageFraction >= o.textCoverageFractionMin &&
      ocr.medianCharHeightPx >= o.minMedianCharHeightPx &&
      ocr.smallTextBandCoverage >= o.smallTextBandCoverageMin;
    const platformMin =
      o.confidenceSignal.use === "secondary"
        ? o.confidenceSignal.platformOverrides[platform]?.meanMin ?? o.confidenceSignal.meanMin
        : undefined;
    const confidenceOk = platformMin === undefined || ocr.meanConfidence === undefined || ocr.meanConfidence >= platformMin;
    const detail = {
      recognizedChars: ocr.recognizedChars,
      recognizedWords: ocr.recognizedWords,
      textCoverageFraction: ocr.textCoverageFraction,
      medianCharHeightPx: ocr.medianCharHeightPx,
      smallTextBandCoverage: ocr.smallTextBandCoverage,
    };
    if (geometryOk && confidenceOk) {
      checks.push(pass("ocrLegibility", 1, detail));
    } else {
      const incomplete =
        ocr.recognizedChars < o.minRecognizedChars ||
        ocr.recognizedWords < o.minRecognizedWords ||
        ocr.textCoverageFraction < o.textCoverageFractionMin;
      reject(fail("ocrLegibility", 0, detail), incomplete ? "PAGE_INCOMPLETE" : "TEXT_ILLEGIBLE");
    }
  }

  const applicable = checks.filter((c) => c.status !== "na");
  const passedCount = applicable.filter((c) => c.status === "pass").length;
  const score = applicable.length === 0 ? 1 : passedCount / applicable.length;
  const passed = reasons.length === 0 && score >= g.overallAcceptScoreMin;

  return { passed, checks, reasons: dedupe(reasons), score, ocrDegraded };
}

function dedupe(reasons: RejectionReason[]): RejectionReason[] {
  const seen = new Set<RejectionReason>();
  const out: RejectionReason[] = [];
  for (const r of reasons) {
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}
