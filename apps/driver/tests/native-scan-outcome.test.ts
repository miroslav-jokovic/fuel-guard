import { describe, expect, it } from "vitest";
import { REJECTION_REASONS } from "@silvicom/capture-engine";
import { BUNDLED_DEFAULT_CONFIG, evaluateGate, unavailableOcr } from "@silvicom/capture-engine";
import {
  assemblePage,
  imageMetricsFromMeasurement,
  interpretNativeScan,
  measurementTarget,
  reasonForUnsupported,
  rejectionFromThrown,
  supportFromNative,
} from "@/capture/nativeScanOutcome";
import type { NativeImageMetrics, NativeScanResult, NativeScannedPage } from "../modules/capture-native";

/**
 * The rejection taxonomy survives the last hop (SCANNER-UPGRADE-PLAN.md Step 1.1, F2/F3, D-SCAN7).
 *
 * ── THE DEFECT THESE PIN ──────────────────────────────────────────────────────────────────────
 * The Kotlin module threw `CodedScannerException("SCANNER_MODULE_UNAVAILABLE")` for the de-Googled
 * and enterprise-locked case that DCE §9 spends a paragraph on. The provider caught every throw and
 * returned `PROVIDER_ERROR` without reading its code. So a driver whose phone has no Play services
 * was told "Something went wrong with the capture — retake", and retook it, forever, instead of
 * "Scanner isn't ready on this device — connect to Wi-Fi once, then retake". A fifteen-word taxonomy
 * died at its last hop and nothing noticed, because nothing could: the logic sat inside a module that
 * cannot be imported without a React Native runtime.
 *
 * These run in `pnpm test`, on a laptop, with no device — which is the point. D-SCAN13 moved the
 * device session to the end of the programme, so anything that can only be checked by holding a phone
 * stays unchecked for months.
 */

/**
 * A page carries TWO artifacts since Phase 4b, and the fixture makes them visibly different — a
 * larger original with its own hash — so a test that confused the two would fail rather than pass by
 * looking at a value that happens to be shared.
 */
const page = (): NativeScannedPage => ({
  original: {
    uri: "file:///tmp/page.original.jpg",
    width: 3024,
    height: 4032,
    bytes: 3_100_000,
    mediaType: "image/jpeg",
    sha256: "original-hash",
  },
  derived: {
    uri: "file:///tmp/page.jpg",
    width: 1568,
    height: 2000,
    bytes: 300_000,
    mediaType: "image/jpeg",
    sha256: "derived-hash",
  },
  osEnhanced: true,
});

describe("interpretNativeScan", () => {
  it("carries an anticipated unavailability through as its own reason", () => {
    const res: NativeScanResult = {
      pages: [],
      cancelled: false,
      unavailable: { reason: "SCANNER_MODULE_UNAVAILABLE", detail: "no Play services" },
    };
    expect(interpretNativeScan(res)).toEqual({
      kind: "rejected",
      reason: "SCANNER_MODULE_UNAVAILABLE",
      message: "no Play services",
    });
  });

  it("carries the iOS unsupported-device case through too", () => {
    const res: NativeScanResult = {
      pages: [],
      cancelled: false,
      unavailable: { reason: "UNSUPPORTED_DEVICE", detail: "not supported on this device" },
    };
    const outcome = interpretNativeScan(res);
    expect(outcome).toMatchObject({ kind: "rejected", reason: "UNSUPPORTED_DEVICE" });
  });

  it("refuses to promote an unrecognised reason into the taxonomy", () => {
    // A native side that invents a code must not be able to mint a RejectionReason by putting a
    // string in the right place — every consumer of `reason` is exhaustive over the union, and
    // REJECTION_COPY would hand the driver `undefined`.
    const res: NativeScanResult = {
      pages: [],
      cancelled: false,
      unavailable: { reason: "CAMERA_ON_FIRE", detail: "invented" },
    };
    expect(interpretNativeScan(res)).toMatchObject({ kind: "rejected", reason: "PROVIDER_ERROR" });
  });

  it("prefers unavailability over cancellation when a result claims both", () => {
    // A scanner that could not start has not been cancelled by anybody. Telling a driver "Capture
    // cancelled" when their phone has no Play services sends them hunting for a mistake they did not
    // make, so the order of these two checks is load-bearing rather than incidental.
    const res: NativeScanResult = {
      pages: [],
      cancelled: true,
      unavailable: { reason: "SCANNER_MODULE_UNAVAILABLE" },
    };
    expect(interpretNativeScan(res)).toMatchObject({ reason: "SCANNER_MODULE_UNAVAILABLE" });
  });

  it("reports a plain cancellation as a cancellation", () => {
    expect(interpretNativeScan({ pages: [], cancelled: true })).toEqual({
      kind: "rejected",
      reason: "CAPTURE_CANCELLED",
    });
  });

  it("names an empty non-cancelled result rather than passing it on as a success", () => {
    const outcome = interpretNativeScan({ pages: [], cancelled: false });
    expect(outcome).toMatchObject({ kind: "rejected", reason: "PROVIDER_ERROR" });
  });

  it("passes pages through untouched when the scan succeeded", () => {
    const pages = [page(), page()];
    expect(interpretNativeScan({ pages, cancelled: false })).toEqual({ kind: "pages", pages });
  });
});

describe("rejectionFromThrown", () => {
  it("reads a recognisable code off a thrown CodedError", () => {
    const e = Object.assign(new Error("module missing"), { code: "SCANNER_MODULE_UNAVAILABLE" });
    expect(rejectionFromThrown(e)).toBe("SCANNER_MODULE_UNAVAILABLE");
  });

  it("falls back to PROVIDER_ERROR for anything else", () => {
    // Including the case this is written to tolerate: a platform where the code never arrives at all.
    expect(rejectionFromThrown(new Error("boom"))).toBe("PROVIDER_ERROR");
    expect(rejectionFromThrown({ code: "NOT_A_REASON" })).toBe("PROVIDER_ERROR");
    expect(rejectionFromThrown("a string")).toBe("PROVIDER_ERROR");
    expect(rejectionFromThrown(null)).toBe("PROVIDER_ERROR");
    expect(rejectionFromThrown(undefined)).toBe("PROVIDER_ERROR");
  });
});

describe("supportFromNative", () => {
  it("says nothing about a reason when the device can scan", () => {
    const s = supportFromNative({ camera: true, docScanner: true, ocr: true, scannerModule: "available" });
    expect(s.supported).toBe(true);
    expect(s.reason).toBeUndefined();
  });

  it("distinguishes an absent scanner module from an absent camera", () => {
    // The two have different remedies — one is "connect to Wi-Fi once" or a fleet-level fallback to
    // v2 RawCapture, the other is not fixable at all — so a single "unsupported" would throw away the
    // only fact that changes what anyone does next.
    expect(reasonForUnsupported({ camera: true, docScanner: false, scannerModule: "unavailable" })).toBe(
      "SCANNER_MODULE_UNAVAILABLE",
    );
    expect(reasonForUnsupported({ camera: false, docScanner: true, scannerModule: "available" })).toBe(
      "UNSUPPORTED_DEVICE",
    );
  });

  it("does not guess when the module state is unknown", () => {
    // iOS never reports `scannerModule` (there is no Play-Services module to report), and Android
    // omits it when it cannot tell. Neither is evidence of an absent module.
    expect(reasonForUnsupported({ camera: true, docScanner: false })).toBe("UNSUPPORTED_DEVICE");
    const s = supportFromNative({ camera: true, docScanner: false, ocr: true });
    expect(s.scannerModule).toBeUndefined();
    expect(s.reason).toBe("UNSUPPORTED_DEVICE");
  });
});

describe("the taxonomy itself", () => {
  it("has a runtime list that matches what the copy table must cover", () => {
    // The union used to exist only at compile time, so anything validating a string had to restate
    // the list. This asserts the runtime array is the one thing to read.
    expect(REJECTION_REASONS).toContain("SCANNER_MODULE_UNAVAILABLE");
    expect(REJECTION_REASONS).toContain("PROVIDER_ERROR");
    expect(new Set(REJECTION_REASONS).size).toBe(REJECTION_REASONS.length);
  });
});

describe("imageMetricsFromMeasurement — shadow-mode measurement (Step 3.3, D-SCAN10)", () => {
  const measured: NativeImageMetrics = {
    longEdgePx: 2000,
    blurVariance: 4321.5,
    glareFraction: 0.012,
    brightnessMean: 0.71,
    contrastRms: 0.23,
    shadowRange: 0.08,
    analysisLongEdgePx: 1024,
  };

  it("passes every measured field through under the name the gate reads", () => {
    expect(imageMetricsFromMeasurement(measured)).toEqual({
      blurVariance: 4321.5,
      glareFraction: 0.012,
      brightnessMean: 0.71,
      contrastRms: 0.23,
      shadowRange: 0.08,
    });
  });

  it("does not source longEdgePx from the measurement", () => {
    // The resolution floor's input is a question about what the camera captured, and the provider
    // already knows it from the page the scanner returned. Taking it from here would mean a FAILED
    // measurement was indistinguishable from a page with no pixels — and resolution is the one image
    // threshold that is still enforcing, so that mistake would reject real captures.
    expect(imageMetricsFromMeasurement(measured)).not.toHaveProperty("longEdgePx");
  });

  it("leaves every field ABSENT when the measurement could not be taken", () => {
    expect(imageMetricsFromMeasurement(null)).toEqual({});
    for (const key of ["blurVariance", "glareFraction", "brightnessMean", "contrastRms", "shadowRange"]) {
      expect(imageMetricsFromMeasurement(null)).not.toHaveProperty(key);
    }
  });

  it("a failed measurement is `na` at the gate, not a page measured as catastrophic", () => {
    // The failure this whole function exists to prevent, stated end to end rather than as a property
    // of a return value. Zeroing the fields instead of omitting them would look identical today —
    // every floor is null — and would start rejecting good pages the day Step 5.2 turns them on.
    const cfg = {
      ...BUNDLED_DEFAULT_CONFIG,
      gates: { ...BUNDLED_DEFAULT_CONFIG.gates, blurLaplacianVarMin: 100, contrastRmsMin: 0.18 },
    };
    const ocr = unavailableOcr("test.none");
    const absent = evaluateGate(
      { metrics: { longEdgePx: 1600, ...imageMetricsFromMeasurement(null) }, ocr, platform: "ios" },
      cfg,
    );
    expect(absent.checks.find((c) => c.name === "blur")?.status).toBe("na");
    expect(absent.reasons).toEqual([]);

    const zeroed = evaluateGate(
      { metrics: { longEdgePx: 1600, blurVariance: 0, contrastRms: 0 }, ocr, platform: "ios" },
      cfg,
    );
    expect(zeroed.reasons).toContain("IMAGE_BLURRED");
  });
});

/**
 * ── WHY THESE EXIST, AND WHAT IT COST TO FIND OUT ─────────────────────────────────────────────
 * `assemblePage` and the choice of which file to measure lived in the provider until Phase 4b. A
 * mutation written to check that D-SCAN4 was really enforced — point `measure()` at the DERIVATIVE
 * instead of the original — **passed the entire driver suite**, because nothing in it could reach
 * the code that decides. The provider imports the native bridge, which needs a React Native runtime.
 *
 * That is precisely the failure mode this file's header describes for rejection reasons, one layer
 * up, and D-SCAN13's deferral of the device session makes it expensive: an undetected inversion here
 * would sit in the recorded metrics for months and then be baked into Step 5.2's thresholds.
 */
describe("assemblePage (Phase 4b — two artifacts per page)", () => {
  const cfg = BUNDLED_DEFAULT_CONFIG;

  it("measures the ORIGINAL, which is what D-SCAN4 requires", () => {
    expect(measurementTarget(page())).toBe("file:///tmp/page.original.jpg");
  });

  it("keeps the original as the evidentiary record and the derivative as what uploads", () => {
    const assembled = assemblePage(page(), null, cfg, "ios");
    expect(assembled.originalOfRecord.uri).toBe("file:///tmp/page.original.jpg");
    expect(assembled.originalOfRecord.sha256).toBe("original-hash");
    // The three derivative fields still alias each other on the v1 path: the OS corrected perspective
    // and enhanced in one step and hands back one image (DCE §3). Step 6.1 splits them.
    expect(assembled.enhancedColor.uri).toBe("file:///tmp/page.jpg");
    expect(assembled.perspectiveCorrected.uri).toBe(assembled.enhancedColor.uri);
    expect(assembled.enhancedGray.uri).toBe(assembled.enhancedColor.uri);
    expect(assembled.enhancedColor.sha256).toBe("derived-hash");
  });

  it("hashes the page by its ORIGINAL, never by a derivative", () => {
    // `integrityHash` has been documented as the original's hash since DCE §2, and was vacuously so
    // while a page had one file. Registering the derivative's hash here would record a provenance
    // claim about bytes nobody kept (0328).
    expect(assemblePage(page(), null, cfg, "android").integrityHash).toBe("original-hash");
  });

  /**
   * ⚠ The resolution floor must read the ORIGINAL's dimensions. The derivative's long edge is
   * `enhanceLongEdgePx` — a number we chose — so gating on it would make the check a statement about
   * our own config that passes by construction, on a page the camera captured at any resolution at
   * all. The fixture's derivative is 1568 px and the floor is 1200, so the mistake would NOT show up
   * as a failure; it would show up as a gate that never fires.
   */
  it("gates resolution on the original's long edge, not the derivative's", () => {
    const assembled = assemblePage(page(), null, cfg, "ios");
    const resolution = assembled.quality.checks.find((c) => c.name === "resolution");
    expect(resolution?.detail?.longEdgePx).toBe(4032);
  });

  /**
   * ⚠ Step 5.3 / audit finding F6. This line read `coverageFraction: 1` and was the last invented
   * number in the metric path: an assertion, never a measurement, that made the gate's coverage check
   * report PASS on every capture ever taken and count toward the accept score.
   *
   * It cannot be measured on the v1 path and this is not a deferral — the OS scanner returns the
   * cropped page and never the crop's area against the frame it came from, so the ratio exists only
   * inside VisionKit and ML Kit. Absent is the honest report, and the gate renders absent as `na`.
   */
  it("asserts no coverage fraction, because nothing on the v1 path can measure one", () => {
    // ⚠ Measured against a config whose coverage floor is LIVE, and that is the only way this test
    // discriminates. Written first against the shipped config, it passed with the assertion put back:
    // a retired floor renders `na` whether or not a fraction was produced, so the check's status
    // could not tell "nothing measured it" from "the floor is off". With an enforcing floor, an
    // asserted 1 reports PASS and only a genuinely absent metric reports `na`.
    const enforcing = { ...cfg, gates: { ...cfg.gates, coverageMinFraction: 0.6 } };
    const assembled = assemblePage(page(), null, enforcing, "ios");
    const coverage = assembled.quality.checks.find((c) => c.name === "coverage");
    expect(coverage?.status).toBe("na");
    expect(coverage?.detail?.coverageFraction).toBeUndefined();
    expect(assembled.quality.reasons).not.toContain("PAGE_INCOMPLETE");
  });

  /**
   * Step 5.1. `assemblePage` is where a measurement stops being a native return value and becomes the
   * record Step 5.2 reads, and every field below was being dropped before this merge: the five
   * metrics because the gate renders them `na` and an `na` check carries no detail, and the analysis
   * scale because it is not part of `ImageMetrics` and nothing carried it past the provider.
   */
  it("keeps the whole measurement, including the scale and the numbers the gate will render na", () => {
    const measured = {
      longEdgePx: 4032, blurVariance: 812.5, glareFraction: 0.014,
      brightnessMean: 0.62, contrastRms: 0.22, shadowRange: 0.31, analysisLongEdgePx: 1024,
    };
    const assembled = assemblePage(page(), measured, cfg, "ios", { captureMs: 4200, processingMs: 180 });

    expect(assembled.metrics.blurVariance).toBe(812.5);
    expect(assembled.metrics.glareFraction).toBe(0.014);
    expect(assembled.metrics.shadowRange).toBe(0.31);
    // …and the gate really did throw them away, which is why the line above matters.
    expect(assembled.quality.checks.find((c) => c.name === "blur")?.status).toBe("na");
    expect(assembled.quality.checks.find((c) => c.name === "blur")?.detail).toBeUndefined();

    expect(assembled.metadata.analysisLongEdgePx).toBe(1024);
    expect(assembled.metadata.captureMs).toBe(4200);
    expect(assembled.metadata.processingMs).toBe(180);
  });

  it("records no scale and no timings when the measurement failed, rather than zeroes", () => {
    // Same rule as the metrics themselves: absent means "not known", and `analysisLongEdgePx: 0`
    // would be a scale — one that makes every recorded number uninterpretable in a way that looks
    // like data.
    const assembled = assemblePage(page(), null, cfg, "ios");
    expect(assembled.metadata.analysisLongEdgePx).toBeUndefined();
    expect(assembled.metadata.captureMs).toBeUndefined();
    expect(assembled.metadata.processingMs).toBeUndefined();
    expect(assembled.metrics.blurVariance).toBeUndefined();
  });

  it("still refuses a page whose ORIGINAL is below the floor, though its derivative is not", () => {
    const small = page();
    small.original = { ...small.original, width: 800, height: 1000 };
    const assembled = assemblePage(small, null, cfg, "ios");
    expect(assembled.quality.reasons).toContain("RESOLUTION_TOO_LOW");
  });
});
