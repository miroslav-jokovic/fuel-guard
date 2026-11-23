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
 * Null where it cannot run: Android (its camera view is step L4, so Android keeps ML Kit's scanner), or
 * an iPhone binary older than runtime 1.5.0 (no `processPages`, or no view). The caller then uses the OS
 * scanner, so a driver always has a scanner.
 */
export function liveEdgePageSource(native: CaptureNativeModule | null): PageSource | null {
  if (!native?.processPages || !getLiveEdgeCameraView()) return null;
  const processPages = native.processPages.bind(native);
  return {
    source: LIVE_EDGE_CAMERA,
    async acquire(_native, options) {
      const uris = await startScanSession({ maxPages: options.maxPages }, () => router.push("/scan"));
      if (!uris) return { pages: [], cancelled: true };
      return processPages(uris, { enhanceLongEdgePx: options.enhanceLongEdgePx, enhanceQuality: options.enhanceQuality });
    },
  };
}
