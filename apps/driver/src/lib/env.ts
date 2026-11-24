import Constants from 'expo-constants';

// Public runtime config, read from app.config.ts `extra` (populated from EXPO_PUBLIC_* at build).
// These are the native equivalents of the web's VITE_* values — anon key + URLs only, NEVER secrets
// (the bundle ships to devices). Plan §21 F5 / §12.5.
interface DriverExtra {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiUrl?: string;
  mapStyleUrl?: string;
  mapStyleUrlDark?: string;
  sentryDsn?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as DriverExtra;

/** Fail loudly at boot with an actionable message instead of a silent white screen later. */
function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `[config] Missing "${name}". Set EXPO_PUBLIC_${name
        .replace(/([A-Z])/g, '_$1')
        .toUpperCase()} in your .env / EAS secrets and rebuild the dev client.`,
    );
  }
  return value;
}

function optionalUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}

const sentryDsn = extra.sentryDsn?.trim();

export const env = {
  supabaseUrl: required('supabaseUrl', extra.supabaseUrl),
  supabaseAnonKey: required('supabaseAnonKey', extra.supabaseAnonKey),
  // Native has no same-origin fallback (unlike the web's ""), so the API base is required.
  apiUrl: required('apiUrl', extra.apiUrl).replace(/\/$/, ''),
  // A hosted basemap, when one is configured (NAV N4). With none, the app draws its own bundled
  // style in the theme's colours (D-DV28, `src/lib/basemap`).
  mapStyleUrl: optionalUrl(extra.mapStyleUrl),
  mapStyleUrlDark: optionalUrl(extra.mapStyleUrlDark),
  // Optional (Phase 8.1): crash reporting is a no-op without a DSN — dev/test runs unaffected.
  sentryDsn: sentryDsn === undefined || sentryDsn.length === 0 ? null : sentryDsn,
} as const;

/** A configured basemap URL for the active theme, or null to use the bundled style (D-DV28). */
export function mapStyleOverride(isDark: boolean): string | null {
  return isDark ? env.mapStyleUrlDark : env.mapStyleUrl;
}
