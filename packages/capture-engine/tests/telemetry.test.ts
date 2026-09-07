import { describe, expect, it } from "vitest";
import { buildCaptureTelemetry, CAPTURE_TELEMETRY_VERSION } from "../src/telemetry.js";
import type { CapturedPage } from "../src/contracts.js";

/**
 * Step 5.1 — what a capture records about itself, so Step 5.2 derives a threshold instead of
 * inventing one.
 *
 * ── THE DEFECT THESE PIN ──────────────────────────────────────────────────────────────────────
 * Phase 3 shipped "every capture measures blur, glare, shadow, brightness and contrast". It measured
 * them and then discarded them: `QualityReport`'s `na` checks carry no `detail`, and under D-SCAN10
 * every one of those floors is `null`, so every one of those checks is `na`. The five numbers
 * evaporated one function after they were computed, and Step 5.2 would have been deriving thresholds
 * from a distribution nobody was writing. The same was true of `analysisLongEdgePx`, which the native
 * module has returned since Phase 3 and nothing carried past the provider.
 */

function page(over: Partial<CapturedPage> = {}): CapturedPage {
  return {
    originalOfRecord: { uri: "file:///o.jpg", width: 3024, height: 4032, bytes: 3_100_000, mediaType: "image/jpeg", sha256: "o" },
    perspectiveCorrected: { uri: "file:///d.jpg", width: 1568, height: 2000, bytes: 300_000, mediaType: "image/jpeg", sha256: "d" },
    enhancedColor: { uri: "file:///d.jpg", width: 1568, height: 2000, bytes: 300_000, mediaType: "image/jpeg", sha256: "d" },
    enhancedGray: { uri: "file:///d.jpg", width: 1568, height: 2000, bytes: 300_000, mediaType: "image/jpeg", sha256: "d" },
    // Every image floor is `null`, so the gate reported `na` for all five and kept none of them.
    quality: { passed: true, checks: [{ name: "blur", status: "na" }], reasons: [], score: 1, ocrDegraded: false },
    metrics: { longEdgePx: 4032, blurVariance: 812.5, glareFraction: 0.014, shadowRange: 0.31, brightnessMean: 0.62, contrastRms: 0.22 },
    ocr: { engine: "ios.vision", recognizedChars: 400, recognizedWords: 90, textCoverageFraction: 0.3, medianCharHeightPx: 28, smallTextBandCoverage: 0.05, numberTokens: [], available: true },
    metadata: {
      providerId: "capture.native.system_scanner", providerVersion: "0.1.0",
      configVersion: "capture-2026.08.0", device: "ios",
      analysisLongEdgePx: 1024, captureMs: 4200, processingMs: 180,
    },
    integrityHash: "o",
    provenance: { captureMode: "system_scanner", osEnhanced: true },
    ...over,
  };
}

describe("buildCaptureTelemetry", () => {
  it("keeps the five measured values the gate discarded", () => {
    const t = buildCaptureTelemetry(page());
    expect(t.metrics.blurVariance).toBe(812.5);
    expect(t.metrics.glareFraction).toBe(0.014);
    expect(t.metrics.shadowRange).toBe(0.31);
    expect(t.metrics.brightnessMean).toBe(0.62);
    expect(t.metrics.contrastRms).toBe(0.22);
  });

  /**
   * ⚠ Without the scale, a recorded blur variance is not interpretable. M2 measured the same document
   * at 4283.7 at 3000 px and 7299.9 at 800 px — a 1.7× swing from resolution alone — which is why
   * D-SCAN1 fixes the analysis edge and why the edge has to travel with the number.
   */
  it("stamps the scale the metrics were computed at", () => {
    expect(buildCaptureTelemetry(page()).analysisLongEdgePx).toBe(1024);
  });

  it("records the source page as the scanner produced it, not the derivative that uploads", () => {
    const t = buildCaptureTelemetry(page());
    expect(t.source.widthPx).toBe(3024);
    expect(t.source.heightPx).toBe(4032);
    expect(t.source.bytes).toBe(3_100_000);
  });

  it("separates the driver's shooting time from our processing time", () => {
    // One number for both would make a slow phone and a slow measurement indistinguishable, which is
    // the question Step 5.2 will be asking of this column.
    expect(buildCaptureTelemetry(page()).timings).toEqual({ captureMs: 4200, processingMs: 180 });
  });

  it("carries the re-shoot count, which is trigger (a) of the Phase 7 decision", () => {
    expect(buildCaptureTelemetry(page(), { attempt: 3 }).attempt).toBe(3);
  });

  /**
   * The gate verdict and the OCR evidence are already columns on the same row — `quality` (0092) and
   * `ocr_evidence` (0133), written from the same request. Repeating them here would be a copy of a
   * fact that already has a home, and on an evidence row two answers to "what did the gate decide".
   */
  it("does not repeat what other columns on the same row already hold", () => {
    const t = buildCaptureTelemetry(page()) as Record<string, unknown>;
    expect(t.quality).toBeUndefined();
    expect(t.ocr).toBeUndefined();
    expect(t.gate).toBeUndefined();
  });

  /**
   * ⚠ Absent, never zero — the same rule the gate follows for a metric it could not take. A
   * `captureMs: 0` in this column would be read by Step 5.2 as an instantaneous capture, and an
   * `attempt: 1` invented for a caller that does not count would make the re-shoot rate read as zero
   * for ever.
   */
  it("omits what it does not know rather than defaulting it", () => {
    const bare = page({
      metadata: { providerId: "capture.js.expo_image_picker", providerVersion: "0.1.0", configVersion: "capture-2026.08.0" },
    });
    const t = buildCaptureTelemetry(bare);
    expect(t.timings).toBeUndefined();
    expect(t.device).toBeUndefined();
    expect(t.analysisLongEdgePx).toBeUndefined();
    expect(t.attempt).toBeUndefined();
    expect("attempt" in t).toBe(false);
  });

  it("still records the platform when that is all the provider knows", () => {
    const web = page({
      metadata: { providerId: "capture.web.file", providerVersion: "0.1.0", configVersion: "capture-2026.08.0", device: "web" },
    });
    expect(buildCaptureTelemetry(web).device).toEqual({ platform: "web" });
  });

  it("stamps a version, so Step 5.2 can tell definitions apart", () => {
    expect(buildCaptureTelemetry(page()).version).toBe(CAPTURE_TELEMETRY_VERSION);
  });

  /**
   * The audit's own rule: device CLASS and timings only, nothing about the person.
   *
   * ⚠ Asserted as a CLOSED key set rather than as a search for forbidden words, because the first
   * version of this test did the latter and failed on its own crudeness — "lon" is a substring of
   * `longEdgePx`. A substring scan is also the weaker assertion: it would pass a field called
   * `capturedBy`. An allowlist fails the moment anybody adds a field, which is exactly when someone
   * should have to think about whether it belongs in a record that outlives the driver's employment.
   *
   * `Constants.deviceName` is "Miki's iPhone" — the personal data this record exists to avoid — and
   * the point of the allowlist is that there is nowhere to put it.
   */
  it("carries a closed set of fields, none of which can hold a person, a place or an image", () => {
    const allowed = new Set([
      "version", "provider", "id", "configVersion", "device", "platform", "model", "osVersion",
      "timings", "captureMs", "processingMs", "source", "widthPx", "heightPx", "bytes", "mediaType",
      "metrics", "longEdgePx", "blurVariance", "glareFraction", "shadowRange", "brightnessMean",
      "contrastRms", "coverageFraction", "documentDetected", "perspectiveSeverity", "lensSmudge",
      "analysisLongEdgePx", "attempt",
    ]);
    const seen = new Set<string>();
    const walk = (v: unknown): void => {
      if (!v || typeof v !== "object") return;
      for (const [k, child] of Object.entries(v)) {
        seen.add(k);
        walk(child);
      }
    };
    walk(buildCaptureTelemetry(page(), { attempt: 1 }));
    expect([...seen].filter((k) => !allowed.has(k))).toEqual([]);
    // And the record really does contain something, so an empty walk cannot pass this vacuously.
    expect(seen.has("blurVariance")).toBe(true);
  });
});
