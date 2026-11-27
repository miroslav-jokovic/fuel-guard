import { router } from "expo-router";
import { getLiveEdgeCameraView } from "../../modules/capture-native/LiveEdgeCameraView";
import type { CaptureNativeModule } from "../../modules/capture-native";
import { LIVE_EDGE_CAMERA } from "./nativeScanOutcome";
import type { PageSource } from "./nativeSystemScannerProvider";
import { startScanSession } from "./scanSession";

/**
 * Our own camera as the page source (D-LED6): the scanner screen (`app/scan.tsx`) takes the pages — the
 * outline traces itself only once the page is placed well and the phone is still, and the trace's end
 * takes each shot — then `processPages` runs them through the same native pipeline as a VisionKit scan.
 *
 * Null where it cannot run: a binary older than the camera view (iPhone before runtime 1.5.0, Android
 * before 1.6.0 — no `processPages`, or no view). The caller then uses the OS scanner, so a driver always
 * has a scanner. It does not need the OS scanner itself (`needsOsScanner: false`), so a phone without
 * Google Play services still gets it (gap G5).
 */
export function liveEdgePageSource(native: CaptureNativeModule | null): PageSource | null {
  if (!native?.processPages || !getLiveEdgeCameraView()) return null;
  const processPages = native.processPages.bind(native);
  return {
    source: LIVE_EDGE_CAMERA,
    needsOsScanner: false,
    async acquire(_native, options) {
      const uris = await startScanSession({ maxPages: options.maxPages }, () => router.push("/scan"));
      if (!uris) return { pages: [], cancelled: true };
      return processPages(uris, { enhanceLongEdgePx: options.enhanceLongEdgePx, enhanceQuality: options.enhanceQuality });
    },
  };
}
