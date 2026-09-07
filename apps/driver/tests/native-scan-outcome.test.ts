import { describe, expect, it } from "vitest";
import { REJECTION_REASONS } from "@silvicom/capture-engine";
import {
  interpretNativeScan,
  reasonForUnsupported,
  rejectionFromThrown,
  supportFromNative,
} from "@/capture/nativeScanOutcome";
import type { NativeScanResult, NativeScannedPage } from "../modules/capture-native";

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

const page = (): NativeScannedPage => ({
  uri: "file:///tmp/page.jpg",
  width: 1568,
  height: 2000,
  bytes: 300_000,
  mediaType: "image/jpeg",
  integrityHash: "abc123",
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
