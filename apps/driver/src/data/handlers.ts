import { apiFetch } from '@/lib/api';
import { registerHandler, SyncError } from './sync';

/**
 * Handler registry. Each feature owns the delivery of its own outbox `kind`; the engine only
 * schedules. Every handler must be safe to replay — the server side is idempotent on the client
 * UUIDs these payloads carry (migrations 0086/0087), so a double drain is a no-op rather than a
 * duplicate shift or a double-posted photo.
 *
 * A 409 is deliberately NOT transient (see `policy.isTransient`): it means the world moved on —
 * someone took the truck, dispatch pulled the load — so the record goes to the dead-letter list and
 * surfaces in **Needs attention** instead of retrying forever against a decision that will not change.
 */
export const DEV_PING_KIND = 'dev_ping';

export const SHIFT_START_KIND = 'shift_start';
export const SHIFT_EQUIPMENT_KIND = 'shift_equipment';
export const SHIFT_END_KIND = 'shift_end';

export const LOAD_ACCEPT_KIND = 'load_accept';
export const LOAD_DECLINE_KIND = 'load_decline';
export const LOAD_START_KIND = 'load_start';

const SHIFT_KEYS = [['me', 'shift'], ['me', 'equipment']] as const;
const LOAD_KEYS = [['me', 'loads']] as const;

/** POST a payload and turn a failure into a SyncError the engine can classify. */
async function post(path: string, body: unknown): Promise<void> {
  const res = await apiFetch(path, { method: 'POST', body });
  if (!res.ok) {
    throw new SyncError(res.error?.message ?? 'Sync failed', res.status);
  }
}

/** Load transitions all take `{ load_id, … }`; the id picks the path, the rest is the body. */
function loadHandler(suffix: string) {
  return {
    invalidates: LOAD_KEYS,
    run: async (record: { payload: unknown }) => {
      const { load_id: loadId, ...body } = (record.payload ?? {}) as Record<string, unknown> & {
        load_id?: string;
      };
      if (!loadId) throw new SyncError('Queued load action is missing its load id', 422);
      await post(`/api/me/loads/${loadId}/${suffix}`, body);
    },
  };
}

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

  // ── Duty sessions (D43/D44) ────────────────────────────────────────────────
  // `shift_start` invalidates the equipment list too: whoever the driver just took a unit from needs
  // to disappear from their own picker, and the next driver needs to see it held.
  registerHandler(SHIFT_START_KIND, {
    invalidates: SHIFT_KEYS,
    run: (record) => post('/api/me/shift/start', record.payload),
  });
  registerHandler(SHIFT_EQUIPMENT_KIND, {
    invalidates: SHIFT_KEYS,
    run: (record) => post('/api/me/shift/equipment', record.payload),
  });
  registerHandler(SHIFT_END_KIND, {
    invalidates: SHIFT_KEYS,
    run: (record) => post('/api/me/shift/end', record.payload),
  });

  // ── Loads (D45/D46) ────────────────────────────────────────────────────────
  registerHandler(LOAD_ACCEPT_KIND, loadHandler('accept'));
  registerHandler(LOAD_DECLINE_KIND, loadHandler('decline'));
  registerHandler(LOAD_START_KIND, loadHandler('start'));
}
