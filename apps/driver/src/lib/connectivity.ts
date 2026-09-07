import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { isUnmeteredConnection } from './meteredConnection';

/**
 * Real connectivity, not "did a fetch fail" (plan §13.2). NetInfo drives React Query's
 * `onlineManager`; AppState drives `focusManager` so foregrounding triggers a background refresh.
 *
 * `isInternetReachable` is tri-state: true / false / null (not yet determined). Treat null as
 * online — a captive-portal check in progress must not blank the UI with an offline banner.
 */
export function isStateOnline(state: NetInfoState): boolean {
  return !!state.isConnected && state.isInternetReachable !== false;
}

/** Wire NetInfo + AppState into React Query. Returns a teardown for tests/fast-refresh. */
export function initConnectivity(): () => void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(isStateOnline(state));
    }),
  );

  const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active');
  });

  return () => {
    sub.remove();
  };
}

/**
 * True when the current connection does not cost the driver money by the megabyte (D-SCAN11).
 *
 * The I/O only. Which facts make a connection unmetered — and the tri-state trap in the answer —
 * lives in `meteredConnection.ts`, where `pnpm test` can reach it; nothing in THIS file can be
 * imported by a test, because NetInfo pulls in React Native.
 *
 * Offline is metered by definition here: there is nothing to upload over, and answering "yes, free"
 * would send the handler into an upload that fails rather than into the wait it is asking about.
 */
export async function isUnmetered(): Promise<boolean> {
  const state = await NetInfo.fetch();
  if (!isStateOnline(state)) return false;
  const details = state.details as { isConnectionExpensive?: boolean } | null | undefined;
  return isUnmeteredConnection({ type: state.type, isConnectionExpensive: details?.isConnectionExpensive });
}

/** Subscribe to the online flag for UI (offline banner, sync affordances). */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(() => onlineManager.isOnline());
  useEffect(() => onlineManager.subscribe(setOnline), []);
  return online;
}
