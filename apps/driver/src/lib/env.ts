import Constants from 'expo-constants';

// Public runtime config, read from app.config.ts `extra` (populated from EXPO_PUBLIC_* at build).
// These are the native equivalents of the web's VITE_* values — anon key + URLs only, NEVER secrets
// (the bundle ships to devices). Plan §21 F5 / §12.5.
interface DriverExtra {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiUrl?: string;
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

export const env = {
  supabaseUrl: required('supabaseUrl', extra.supabaseUrl),
  supabaseAnonKey: required('supabaseAnonKey', extra.supabaseAnonKey),
  // Native has no same-origin fallback (unlike the web's ""), so the API base is required.
  apiUrl: required('apiUrl', extra.apiUrl).replace(/\/$/, ''),
} as const;
