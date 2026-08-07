import { existsSync, readFileSync } from 'node:fs';
import type { ExpoConfig } from 'expo/config';

/** Resolved against both plausible working directories: Expo runs this config from apps/driver, but
 *  workspace tooling sometimes loads it from the repository root. Neither `__dirname` nor
 *  `import.meta.url` is dependable here — @expo/config transpiles and loads this file, and its module
 *  format is not ours to rely on. Two candidate paths is the honest, portable answer. */
function fromDriverDir(relative: string): string | null {
  for (const candidate of [relative, `apps/driver/${relative}`]) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * NATIVE RUNTIME VERSION — read from runtime-version.json, bumped whenever the native side changes
 * (ship-pipeline plan D2, decision D-S5).
 *
 * An over-the-air update is only ever served to a binary whose runtime version matches, which is what
 * stops a JavaScript bundle landing on an app that lacks the native module it calls. "Native change"
 * means anything under the local capture module, a new or upgraded native dependency, a config
 * plugin, a permission, an entitlement, or expo-updates itself.
 *
 * Deliberately a fixed string rather than `{ policy: 'fingerprint' }`. The fingerprint policy is the
 * more automatic answer and was this plan's original decision, but it hashes the resolved dependency
 * tree — and in a pnpm workspace a `--frozen-lockfile` CI install and a laptop install can produce
 * different hashes for the SAME commit. The failure mode is silent: updates simply never arrive, with
 * nothing logged anywhere. The safety it would have bought is bought instead in CI, which compares
 * the fingerprint of the last shipped APK against this build's and refuses to publish a JavaScript
 * update when the native side moved (.github/workflows/driver-ota.yml). Loud check, boring config.
 */
const runtimeVersionFile = fromDriverDir('runtime-version.json');
if (!runtimeVersionFile) throw new Error('apps/driver/runtime-version.json is missing');
const NATIVE_RUNTIME_VERSION = (JSON.parse(runtimeVersionFile) as { runtimeVersion: string })
  .runtimeVersion;

// Self-hosted update server (xprem). All three values are baked into the NATIVE build and can never
// be changed by an update — a new server URL, certificate or app id means a new APK, always. Absent
// = updates disabled entirely, which is the correct state for a laptop dev client.
const updatesUrl = process.env.UPDATES_URL;
const updatesAppId = process.env.UPDATES_APP_ID;
const hasCertificate =
  existsSync('certs/certificate.pem') || existsSync('apps/driver/certs/certificate.pem');

// Public config only — NEVER put secrets in `extra` (it ships in the bundle). Plan §12.5 / §21 F5.
const config: ExpoConfig = {
  name: 'FuelGuard Driver',
  slug: 'fuelguard-driver',
  scheme: 'fuelguard',
  version: '0.0.1',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  experiments: { typedRoutes: true },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.silvicom.fuelguard.driver',
    config: { usesNonExemptEncryption: false }, // HTTPS + OS crypto = exempt (plan §23.3 / D27)
  },
  android: {
    package: 'com.silvicom.fuelguard.driver',
    // Android refuses to install a build whose versionCode is not higher than the installed one, so
    // CI passes its run number (ship-pipeline D1.2). Locally it stays 1 — a laptop build replaces a
    // laptop build. Never hand-edited: a human-managed counter is a counter that goes backwards.
    versionCode: Number(process.env.ANDROID_VERSION_CODE ?? 1),
    // @ts-expect-error edgeToEdgeEnabled is valid in Expo 53+ but @expo/config-types lags behind
    edgeToEdgeEnabled: true,
  },
  plugins: [
    './plugins/withGradleMemory.js',
    // Signs release APKs with our keystore instead of Expo's debug one (inert without CI env).
    './plugins/withReleaseSigning.js',
    'expo-router',
    'expo-dev-client',
    'expo-font',
    'expo-secure-store',
    // SQLCipher compiles encryption INTO SQLite — without it `PRAGMA key` is silently ignored and
    // the offline outbox (unsynced driver work) would sit in plaintext on the device (D12/§21).
    ['expo-sqlite', { useSQLCipher: true }],
    // Camera for per-stop proof-of-work photos (Phase 3C). Photos are re-encoded (EXIF stripped, D12)
    // before they ever touch disk or the network. Only the camera permission is declared — no photo
    // library, no microphone — least-privilege (§21).
    [
      'expo-image-picker',
      {
        cameraPermission:
          'FuelGuard Driver uses your camera to photograph load stops — bill of lading, seal, trailer and any damage — as proof of work.',
        photosPermission: false,
        microphonePermission: false,
      },
    ],
    // MapLibre native map SDK (NAV NP0) — free/open vector tiles, no access token. Requires a dev
    // build (not Expo Go); the config plugin wires the native maps dependency.
    '@maplibre/maplibre-react-native',
    // Foreground location for the 'you-are-here' puck + off-route detection (NAV NP2). Background
    // location is deferred (NAV N8) until true turn-by-turn needs it.
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'FuelGuard Driver uses your location to show your position on the route and keep navigation centered while you drive.',
      },
    ],
  ],
  runtimeVersion: NATIVE_RUNTIME_VERSION,
  // Code signing is less optional than it looks: without it, anyone who reaches the update server can
  // push JavaScript to every phone in the fleet. The certificate is public and committed; the private
  // key never leaves the server (decision D-S7).
  ...(updatesUrl && updatesAppId
    ? {
        updates: {
          url: `${updatesUrl.replace(/\/+$/, '')}/manifest`,
          requestHeaders: { 'expo-app-id': updatesAppId },
          // ON_LOAD only CHECKS; the download is silent and the restart is a button the driver
          // presses (src/features/updates). An app that reloads itself mid check-in destroys work.
          checkAutomatically: 'ON_LOAD' as const,
          fallbackToCacheTimeout: 0,
          ...(hasCertificate
            ? {
                codeSigningCertificate: './certs/certificate.pem',
                codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' as const },
              }
            : {}),
        },
      }
    : {}),
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    mapStyleUrl: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
    mapStyleUrlDark: process.env.EXPO_PUBLIC_MAP_STYLE_URL_DARK,
    // Crash reporting (Phase 8.1) — a DSN is not a secret, but it is optional: absent = no-op.
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  },
};

export default config;
