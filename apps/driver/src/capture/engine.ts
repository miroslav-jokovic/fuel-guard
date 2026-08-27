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
  const native = createNativeSystemScannerProvider(config, platform);
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

/** Scan a BOL page: camera → gate. The caller decides accept/re-shoot from the ScanResult. */
export async function scanBol(): Promise<ScanResult> {
  const { provider } = await bootstrap();
  return provider.scan({ maxPages: 10 });
}

export async function getCaptureConfig(): Promise<CaptureConfig> {
  return (await bootstrap()).config;
}
