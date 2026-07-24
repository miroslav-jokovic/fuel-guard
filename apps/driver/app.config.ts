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
    edgeToEdgeEnabled: true,
  },
  plugins: ['expo-router', 'expo-dev-client', 'expo-font'],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
  },
};

export default config;
