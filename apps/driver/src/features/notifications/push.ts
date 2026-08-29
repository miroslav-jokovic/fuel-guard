import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { apiFetch } from '@/lib/api';

/**
 * Expo push registration + tap handling (Phase 6 / D53).
 *
 * Push is the FAST path only — the in-app centre (poll + persisted cache) is the source of truth,
 * so every failure mode here degrades to "the bell still works": permission denied, no EAS
 * projectId configured yet, emulator, Expo outage. Nothing throws past this module.
 *
 * Token lifecycle: registered on session-ready (idempotent server-side — the token is the PK),
 * revoked on sign-out via /token/revoke (which the server keeps OUTSIDE the module gate, so a
 * lapsed tenant's phones still go dark), and revoked server-side on offboarding (members.ts).
 */

/** Foreground presentation: show banners quietly; the centre owns the full story. */
export function configureForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
  });
}

/** The EAS project id, if this build has one — without it dev-client push tokens can't be minted. */
function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId ?? null;
}

/**
 * Ask permission and register this device's Expo push token with the API. Safe to call on every
 * sign-in: the server upserts on the token PK. Returns whether a token was registered.
 */
export async function registerForPush(): Promise<boolean> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    const status =
      existing === Notifications.PermissionStatus.GRANTED
        ? existing
        : (await Notifications.requestPermissionsAsync()).status;
    if (status !== Notifications.PermissionStatus.GRANTED) return false;

    const projectId = easProjectId();
    if (!projectId) {
      // Not an error: the centre works without push. One line so the gap is visible in dev logs.
      console.warn('[push] no EAS projectId configured — skipping token registration (centre still works)');
      return false;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Silvicom 360 Driver',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const res = await apiFetch('/api/me/notifications/token', {
      method: 'POST',
      body: {
        token,
        platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'unknown',
        app_version: Constants.expoConfig?.version ?? undefined,
      },
    });
    return res.ok;
  } catch (e) {
    console.warn(`[push] registration failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** Best-effort token revocation for sign-out — called while the session is still valid. */
export async function revokePushRegistration(): Promise<void> {
  try {
    await apiFetch('/api/me/notifications/token/revoke', { method: 'POST', timeoutMs: 3000 });
  } catch {
    // Offboarding revokes server-side too (members.ts) — this is the polite fast path only.
  }
}

/**
 * Wire the tap → navigate flow. Returns the teardown. The payload's `deep_link` (set by the
 * server's `deepLinkFor`) is translated to an APP route by `resolveDeepLink` — never trusted raw.
 */
export function onNotificationTap(handler: (deepLink: string | null) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as { deep_link?: unknown } | undefined;
    handler(typeof data?.deep_link === 'string' ? data.deep_link : null);
  });
  return () => sub.remove();
}
