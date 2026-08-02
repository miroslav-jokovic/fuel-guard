import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import { AppState } from 'react-native';
import { createClient, processLock } from '@supabase/supabase-js';
import { env } from './env';
import { LargeSecureStore } from './secureStore';

/**
 * The single Supabase client for the driver app (plan §3.1 / D10).
 *  • storage: encrypted (LargeSecureStore) so refresh tokens are never plaintext at rest.
 *  • flowType 'pkce': the secure code-exchange flow for the invite/reset deep links.
 *  • detectSessionInUrl false: native handles deep links explicitly (no window.location).
 *  • processLock: serializes token refresh across app/JS contexts (RN guidance).
 * Only public values reach the client — the service-role key never leaves the server.
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: new LargeSecureStore(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
    lock: processLock,
  },
});

// Refresh the session only while the app is foregrounded — background refresh wastes battery and
// can race the OS suspending the process (Supabase RN guidance).
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
