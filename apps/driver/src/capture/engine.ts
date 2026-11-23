import { Platform } from "react-native";
import {
  BUNDLED_DEFAULT_CONFIG,
  loadConfig,
  type CaptureConfig,
  type CaptureProvider,
  type ScanResult,
  type SignatureVerifier,
} from "@silvicom/capture-engine";
import { createNativeSystemScannerProvider } from "./nativeSystemScannerProvider";
import { createExpoImagePickerProvider } from "./expoImagePickerProvider";
import { liveEdgePageSource } from "./liveEdgePageSource";
import { getCaptureNativeModule } from "../../modules/capture-native";

/**
 * Capture engine bootstrap (M6 / DCE §8). Loads + verifies the signed config, then picks the native
 * SystemScanner provider when it is built into the binary AND supported on this device, else the JS
 * fallback. Result is cached for the session.
 *
 * TODO(Slice E): supply a real Ed25519 verifier over the pinned key + wire the remote-override fetch.
 * Until then only the bundled signed default is used; a reject-all verifier makes any (absent) remote a
 * no-op — the gate can never be weakened.
 */
const platform: "ios" | "android" = Platform.OS === "ios" ? "ios" : "android";
const verifier: SignatureVerifier = { verify: () => false };

let cached: { config: CaptureConfig; provider: CaptureProvider } | null = null;

async function bootstrap(): Promise<{ config: CaptureConfig; provider: CaptureProvider }> {
  if (cached) return cached;
  const { config } = await loadConfig({ bundled: BUNDLED_DEFAULT_CONFIG, verifier });
  let provider: CaptureProvider = createExpoImagePickerProvider(config);
  // One scanner for every document (owner, 2026-11-23): our own camera wherever it exists (iPhone,
  // runtime 1.5.0+), else the OS scanner, else the plain camera. Same provider, same gate either way.
  const ownCamera = liveEdgePageSource(getCaptureNativeModule());
  const native = ownCamera
    ? createNativeSystemScannerProvider(config, platform, ownCamera)
    : createNativeSystemScannerProvider(config, platform);
  if (native) {
    try {
      const support = await native.isSupported();
      if (support.supported) provider = native;
    } catch {
      /* fall back to the JS provider */
    }
  }
  cached = { config, provider };
  return cached;
}

/**
 * Scan a document: camera → gate. Every document in the app comes through here — the hazmat BOL and a
 * stop's paperwork slot alike — so they share one scanner. The caller decides accept/re-shoot from the
 * ScanResult.
 */
export async function scanDocument(maxPages: number): Promise<ScanResult> {
  const { provider } = await bootstrap();
  return provider.scan({ maxPages });
}

/** Scan a BOL for a hazmat check: up to ten pages (the server's MAX_BOL_PAGES). */
export async function scanBol(): Promise<ScanResult> {
  return scanDocument(10);
}

export async function getCaptureConfig(): Promise<CaptureConfig> {
  return (await bootstrap()).config;
}
