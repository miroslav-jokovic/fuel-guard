import type { ExpoConfig } from 'expo/config';

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
    // @ts-expect-error edgeToEdgeEnabled is valid in Expo 53+ but @expo/config-types lags behind
    edgeToEdgeEnabled: true,
  },
  plugins: [
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
  // OTA updates (Phase 8.2): runtimeVersion pins JS-update compatibility to the native app version,
  // so an EAS Update can never land on a binary missing its native modules. Inert until
  // `eas update:configure` adds the project URL (owner step — see DRIVER-APP-BUILD-STATUS).
  runtimeVersion: { policy: 'appVersion' },
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
