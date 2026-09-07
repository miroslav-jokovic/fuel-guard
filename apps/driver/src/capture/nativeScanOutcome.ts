import { toRejectionReason, type RejectionReason, type SupportResult } from "@silvicom/capture-engine";
import type { NativeScanResult, NativeScannedPage, NativeSupport } from "../../modules/capture-native";

/**
 * How a native scan result becomes an engine outcome (SCANNER-UPGRADE-PLAN.md Step 1.1, D-SCAN7).
 *
 * ── WHY THIS IS ITS OWN FILE ──────────────────────────────────────────────────────────────────
 * Every decision here is pure, and none of it should need a phone to check. The provider beside this
 * file cannot be imported in a unit test — it reaches the native module, which reaches
 * `expo-modules-core`, which expects a React Native runtime — so logic that lives inside it is logic
 * that can only be verified by holding a device. D-SCAN13 moved the device session to the end of the
 * programme, which makes that trade much worse than it was: anything left in the provider stays
 * unverified for months. So the decisions move out here, where `pnpm test` reaches them today, and
 * the provider keeps only the I/O.
 *
 * The types come in with `import type`, which is erased at compile time — so importing this file does
 * NOT load the native bridge, which is the entire point.
 */

/** What a native scan turned out to be, before any image work is done. */
export type NativeScanOutcome =
  | { kind: "pages"; pages: NativeScannedPage[] }
  | { kind: "rejected"; reason: RejectionReason; message?: string };

/**
 * Interpret a resolved native scan.
 *
 * Order matters and is deliberate: `unavailable` is checked BEFORE `cancelled`, because a scanner
 * that could not start has not been cancelled by anybody, and telling a driver "Capture cancelled"
 * when their phone has no Play services sends them to look for a mistake they did not make.
 */
export function interpretNativeScan(res: NativeScanResult): NativeScanOutcome {
  if (res.unavailable) {
    // Checked against the taxonomy, never asserted into it: a reason the native side invents must not
    // become a RejectionReason just because it is a string in the right place.
    return {
      kind: "rejected",
      reason: toRejectionReason(res.unavailable.reason),
      message: res.unavailable.detail,
    };
  }
  if (res.cancelled) return { kind: "rejected", reason: "CAPTURE_CANCELLED" };
  if (res.pages.length === 0) {
    // Neither unavailable, nor cancelled, nor carrying anything. Nothing in the contract forbids it,
    // and a silent `{ ok: true, pages: [] }` would reach `decideCapture` as "No page captured" with no
    // reason attached. Name it here instead.
    return { kind: "rejected", reason: "PROVIDER_ERROR", message: "The scanner returned no pages." };
  }
  return { kind: "pages", pages: res.pages };
}

/**
 * A thrown value's `code`, when it carries a recognisable one; `PROVIDER_ERROR` otherwise.
 *
 * This is a SECONDARY path and the design does not rest on it. On Android a Kotlin `CodedException`
 * does reach JS carrying a `code` — `expo-modules-core`'s `Exceptions.cpp` builds a `CodedError` from
 * the `ExpoModulesCore_CodedError` global installed in `setUpJsLogger.fx.ts`. On iOS the equivalent
 * construction happens inside the prebuilt `ExpoModulesJSI` binary and could not be confirmed from
 * source (checked 2026-09-06). Rather than ship a design whose correctness depends on an unverified
 * half, every EXPECTED outcome now arrives as a value and a rejection means only "unforeseen" — so
 * reading the code here can add precision and can never be load-bearing.
 */
export function rejectionFromThrown(e: unknown): RejectionReason {
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return toRejectionReason(code);
}

/**
 * Which flavour of "cannot scan" a support probe describes.
 *
 * The distinction earns its place: Play services being absent is the DCE §9 case and has a remedy a
 * driver can act on (connect to Wi-Fi once) or a fleet-level one (v2 RawCapture for locked fleets).
 * No camera is a different conversation and no amount of Wi-Fi fixes it.
 */
export function reasonForUnsupported(s: Pick<NativeSupport, "camera" | "docScanner" | "scannerModule">): RejectionReason {
  if (!s.camera) return "UNSUPPORTED_DEVICE";
  return s.scannerModule === "unavailable" ? "SCANNER_MODULE_UNAVAILABLE" : "UNSUPPORTED_DEVICE";
}

/** The engine's SupportResult from a native probe, carrying WHY when it cannot scan. */
export function supportFromNative(s: NativeSupport): SupportResult {
  const supported = s.camera && s.docScanner;
  return {
    supported,
    camera: s.camera,
    docScanner: s.docScanner,
    ocr: s.ocr,
    scannerModule: s.scannerModule,
    reason: supported ? undefined : reasonForUnsupported(s),
  };
}
