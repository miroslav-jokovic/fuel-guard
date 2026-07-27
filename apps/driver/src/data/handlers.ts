import { apiFetch } from '@/lib/api';
import { registerHandler, SyncError } from './sync';

/**
 * Handler registry. Each feature owns the delivery of its own outbox `kind`; the engine only
 * schedules. Phase 3 registers `load_accept` and `load_stop_photos` here.
 *
 * `dev_ping` is the seeded test mutation the plan calls for (§13.1): it exercises the full path —
 * enqueue → survive relaunch → drain on reconnect → invalidate — against a real authenticated
 * endpoint, so the machinery is provably working before any domain data rides on it.
 */
export const DEV_PING_KIND = 'dev_ping';

export function registerSyncHandlers(): void {
  registerHandler(DEV_PING_KIND, {
    invalidates: [['me', 'driver']],
    run: async () => {
      const res = await apiFetch('/api/me/driver');
      if (!res.ok) {
        throw new SyncError(res.error?.message ?? 'Ping failed', res.status);
      }
    },
  });
}
