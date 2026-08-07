import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';

/**
 * Over-the-air update lifecycle for the driver app (ship-pipeline plan D2.5).
 *
 * The rule this hook exists to enforce: NEVER restart a driver's app for them. `expo-updates` will
 * happily reload the moment a bundle lands, and doing that mid check-in — halfway through a hazmat
 * capture, one field short of finishing a stop — destroys work the driver cannot easily redo. So the
 * download is silent and automatic; the restart is a button they press when their hands are free.
 *
 * Checks run on foreground rather than on a timer: a phone in a cab is backgrounded for hours, and
 * the moment a driver picks it up is exactly when a restart is cheapest. Failures are swallowed on
 * purpose — a dead-zone update check is not an error any driver should ever be shown.
 *
 * This is the SOFT path. The hard one is the `core.app` minVersion gate in app/_layout.tsx, which
 * replaces the whole navigator when a fleet forces an upgrade.
 */
export interface AppUpdateState {
  /** A newer bundle is downloaded and will be used on the next restart. */
  ready: boolean;
  /** A check or download is in flight. */
  busy: boolean;
  /** Restart into the downloaded bundle. The caller decides when that is safe. */
  apply: () => Promise<void>;
  /** Force a check now — Settings offers this manually. */
  check: () => Promise<void>;
}

const FOREGROUND_THROTTLE_MS = 5 * 60_000;

export function useAppUpdate(): AppUpdateState {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastCheckedAt = useRef(0);

  const check = useCallback(async () => {
    // In development, and in any build made without an updates URL, expo-updates is inert and these
    // calls throw. That is not a condition worth reporting — it is the normal state of a dev client.
    if (__DEV__ || !Updates.isEnabled) return;
    const now = Date.now();
    if (now - lastCheckedAt.current < FOREGROUND_THROTTLE_MS) return;
    lastCheckedAt.current = now;
    setBusy(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        const fetched = await Updates.fetchUpdateAsync();
        if (fetched.isNew) setReady(true);
      }
    } catch {
      // Offline, server unreachable, or updates disabled — try again on the next foreground.
    } finally {
      setBusy(false);
    }
  }, []);

  const apply = useCallback(async () => {
    try {
      await Updates.reloadAsync();
    } catch {
      setReady(false); // nothing to reload into — drop the prompt rather than leave a dead button
    }
  }, []);

  useEffect(() => {
    void check();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void check();
    });
    return () => sub.remove();
  }, [check]);

  return { ready, busy, apply, check };
}
