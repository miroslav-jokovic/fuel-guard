import { describe, expect, it } from "vitest";
import type { CapturedPage } from "@fuelguard/capture-engine";
import { buildCapturePayload, decideCapture } from "@/features/hazmat/hazmatCaptureModel";

function page(passed: boolean, reasons: CapturedPage["quality"]["reasons"] = []): CapturedPage {
  const img = { uri: "file:///tmp/bol.webp", width: 1568, height: 2000, bytes: 300000, mediaType: "image/webp" as const };
  return {
    originalOfRecord: img, perspectiveCorrected: img, enhancedColor: img, enhancedGray: img,
    quality: { passed, checks: [], reasons, score: passed ? 1 : 0, ocrDegraded: false },
    ocr: { engine: "test", recognizedChars: 0, recognizedWords: 0, textCoverageFraction: 0, medianCharHeightPx: 0, smallTextBandCoverage: 0, numberTokens: [], available: false },
    metadata: { providerId: "p", providerVersion: "0.1.0", configVersion: "capture-2026.08.0" },
    integrityHash: "abc123", provenance: { captureMode: "expo_camera", osEnhanced: false },
  };
}

describe("decideCapture", () => {
  it("accepts a passing page", () => {
    const r = decideCapture({ ok: true, pages: [page(true)] });
    expect(r.accepted).toBe(true);
    expect(r.reasons).toEqual([]);
  });
  it("maps a rejected page's reasons to driver copy", () => {
    const r = decideCapture({ ok: true, pages: [page(false, ["RESOLUTION_TOO_LOW"])] });
    expect(r.accepted).toBe(false);
    expect(r.reasons[0]).toMatch(/low-resolution/i);
  });
  it("maps a scan-level failure (cancel) to copy", () => {
    const r = decideCapture({ ok: false, reason: "CAPTURE_CANCELLED" });
    expect(r.accepted).toBe(false);
    expect(r.reasons[0]).toMatch(/cancelled/i);
  });
});

describe("buildCapturePayload", () => {
  it("shapes a replay-safe create + register body from the page", () => {
    const { payload, localUri } = buildCapturePayload({ loadId: "L1", documentId: "D1", pageNumber: 1, page: page(true) });
    expect(payload.create.id).toBe("L1");
    expect(payload.register.id).toBe("D1");
    expect(payload.register.kind).toBe("bol");
    expect(payload.register.contentType).toBe("image/webp");
    expect(payload.register.capture.mode).toBe("expo_camera");
    expect(localUri).toBe("file:///tmp/bol.webp");
  });
});
