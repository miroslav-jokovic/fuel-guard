import { File } from 'expo-file-system';
import { apiFetch } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { registerHandler, SyncError } from './sync';
import { queuedRegisters, type RegisterBody } from '@/features/hazmat/hazmatCaptureModel';

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
export const LOAD_STOP_KIND = 'load_stop';

export const HAZMAT_CAPTURE_KIND = 'hazmat_capture';

export const MESSAGE_THREAD_KIND = 'message_thread_create';
export const MESSAGE_SEND_KIND = 'message_send';

/** Storage bucket for proof-of-work photos (migration 0085) — private, path-scoped by org+driver. */
const LOAD_PHOTOS_BUCKET = 'load-photos';

const SHIFT_KEYS = [['me', 'shift'], ['me', 'equipment']] as const;
const LOAD_KEYS = [['me', 'loads']] as const;

/** POST a payload and turn a failure into a SyncError the engine can classify. */
async function post(path: string, body: unknown): Promise<void> {
  const res = await apiFetch(path, { method: 'POST', body });
  if (!res.ok) {
    throw new SyncError(res.error?.message ?? 'Sync failed', res.status, res.retryAfterMs);
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

/** One queued stop photo: the API fields plus the staged local file the handler uploads. */
interface QueuedStopPhoto {
  id: string;
  slot: string;
  storage_path: string;
  captured_at?: string;
  local_uri?: string;
}

/**
 * Upload one staged photo to Storage. A retry after a prior success hits "already exists" — which is
 * success, not failure, since the storage RLS grants a driver INSERT only (no overwrite) and the row
 * is keyed by the same client UUID either way. Any other error is thrown so the record retries.
 */
async function uploadStopPhoto(photo: QueuedStopPhoto): Promise<void> {
  if (!photo.local_uri) return; // nothing staged (e.g. a plain arrive/skip)
  const bytes = await new File(photo.local_uri).arrayBuffer();
  const { error } = await supabase.storage
    .from(LOAD_PHOTOS_BUCKET)
    .upload(photo.storage_path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (error) {
    const message = (error as { message?: string }).message ?? '';
    const statusCode = (error as { statusCode?: string }).statusCode;
    if (statusCode === '409' || /exist|duplicate/i.test(message)) return; // already uploaded — idempotent
    throw new SyncError(`Photo upload failed: ${message || 'unknown storage error'}`);
  }
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

  // ── Stop capture (D21, migration 0087) ─────────────────────────────────────
  // Bytes BEFORE the POST: the API records each photo's storage_path, so the object must already be
  // in the bucket or the metadata would point at nothing. Both steps are idempotent, so a retry after
  // a partial success re-uploads (→ "already exists", ignored) and re-POSTs (→ on-conflict-do-nothing).
  registerHandler(LOAD_STOP_KIND, {
    invalidates: LOAD_KEYS,
    run: async (record) => {
      const payload = (record.payload ?? {}) as {
        load_id?: string;
        stop_id?: string;
        status?: string;
        skip_reason?: string;
        occurred_at?: string;
        photos?: QueuedStopPhoto[];
      };
      if (!payload.load_id || !payload.stop_id || !payload.status) {
        throw new SyncError('Queued stop action is malformed', 422);
      }
      const photos = payload.photos ?? [];
      for (const photo of photos) {
        await uploadStopPhoto(photo);
      }
      await post(`/api/me/loads/${payload.load_id}/stops/${payload.stop_id}`, {
        status: payload.status,
        ...(payload.skip_reason ? { skip_reason: payload.skip_reason } : {}),
        ...(payload.occurred_at ? { occurred_at: payload.occurred_at } : {}),
        photos: photos.map((p) => ({
          id: p.id,
          slot: p.slot,
          storage_path: p.storage_path,
          ...(p.captured_at ? { captured_at: p.captured_at } : {}),
        })),
      });
    },
  });

  // ── Messages (Phase 7, D54) ────────────────────────────────────────────────
  // Both write paths are replay-safe on their client UUIDs: a re-drained thread-create finds the
  // existing thread and no-ops (the service checks the id first); a re-drained send collides on the
  // message PK. A reply typed in a dead zone therefore lands exactly once, whenever signal returns.
  registerHandler(MESSAGE_THREAD_KIND, {
    invalidates: [['me', 'messages']],
    run: (record) => post('/api/messages', record.payload),
  });
  registerHandler(MESSAGE_SEND_KIND, {
    invalidates: [['me', 'messages']],
    run: async (record) => {
      const p = (record.payload ?? {}) as { thread_id?: string; message_id?: string; body?: string; occurred_at?: string };
      if (!p.thread_id || !p.message_id || !p.body) {
        throw new SyncError('Queued message is malformed', 422);
      }
      await post(`/api/messages/${p.thread_id}/messages`, {
        message_id: p.message_id,
        body: p.body,
        ...(p.occurred_at ? { occurred_at: p.occurred_at } : {}),
      });
    },
  });

  // ── Hazmat driver capture (M6) ─────────────────────────────────────────────
  // The whole capture is ONE queued item, replay-safe end to end (client-UUID PKs → idempotent create +
  // register + submit; storage upload treats "already exists" as success). Offline capture drains on
  // reconnect with no double-post (M6.2). Every step is idempotent, so a re-drain of a delivered capture
  // just no-ops rather than double-posting.
  registerHandler(HAZMAT_CAPTURE_KIND, {
    invalidates: [['me', 'hazmat']],
    run: async (record) => {
      const p = (record.payload ?? {}) as {
        loadId?: string;
        create?: { id: string };
        /** Since multi-page (plan Step 1.2). One entry per page, aligned by index with fileUris. */
        registers?: RegisterBody[];
        /** The pre-multi-page shape. See the comment below — this is not dead code. */
        register?: RegisterBody;
      };
      // A record queued by an older build carries `register`; one queued by this build carries
      // `registers`. Both must drain, because the outbox survives an app update: a driver who scanned
      // offline on Friday and updated over the weekend has a Friday-shaped record on disk, and
      // rejecting it would throw away work that exists nowhere else — the cardinal sin this whole
      // subsystem is built to avoid. The legacy branch can be deleted once no device can still hold
      // one; until somebody can say that with evidence, it stays.
      const registers = queuedRegisters(p);
      if (!p.loadId || !p.create || registers.length === 0) {
        throw new SyncError('Queued hazmat capture is malformed', 422);
      }

      // 1) create the driver's own load (idempotent)
      await post('/api/me/hazmat/loads', p.create);

      // 2+3) register each page and upload its bytes BEFORE any submit, so the extraction never runs
      //      against a partially uploaded document. Sequential rather than parallel: the server caps
      //      pages at MAX_BOL_PAGES and counts existing rows to enforce it, so concurrent registers
      //      would race that count.
      for (const [index, reg] of registers.entries()) {
        const registered = await apiFetch<{ documentId: string; storagePath: string }>(
          `/api/me/hazmat/loads/${p.loadId}/documents`,
          { method: 'POST', body: reg },
        );
        if (!registered.ok || !registered.data) {
          throw new SyncError(registered.error?.message ?? 'Document register failed', registered.status);
        }

        // Driver-scoped RLS on the `hazmat` bucket (0092). Re-upload after a partial success →
        // already-exists = success (the bucket denies overwrite; the row is keyed by the same client
        // UUID), which is what makes a re-drained record a no-op rather than a duplicate.
        const localUri = record.fileUris[index];
        if (!localUri) continue;
        const bytes = await new File(localUri).arrayBuffer();
        const { error } = await supabase.storage
          .from('hazmat')
          .upload(registered.data.storagePath, bytes, { contentType: reg.contentType, upsert: false });
        if (error) {
          const message = (error as { message?: string }).message ?? '';
          const statusCode = (error as { statusCode?: string }).statusCode;
          if (statusCode !== '409' && !/exist|duplicate/i.test(message)) {
            throw new SyncError(`BOL upload failed: ${message || 'unknown storage error'}`);
          }
        }
      }

      // 4) submit → analyze, ONCE, after every page has landed (idempotent; an already-submitted load
      //    returns the latest run, not a 409). Submitting per page would start the extraction against
      //    an incomplete document and produce a confident verdict on a document nobody sent.
      await post(`/api/me/hazmat/loads/${p.loadId}/submit`, {});
    },
  });
}
