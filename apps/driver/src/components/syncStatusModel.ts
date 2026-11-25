/**
 * The words Settings › Sync shows under "Sync now". Pure, so the claim each sentence makes is tested
 * (apps/driver/tests/sync-status-model.test.ts), and SyncStatus.tsx only draws.
 *
 * Found on the first device pass (2026-11-25, Galaxy Tab A9): the row said "All synced · just now"
 * beside "1 failed". `pending` leaves out records that gave up (`dead`, counted as needsAttention by
 * policy.ts), so a phone holding nothing but stuck work fell through to "All synced". And
 * `lastSyncAt` is stamped when a run ENDS, whether or not anything was delivered, so beside stuck
 * work it reads "checked", never "synced".
 */
export interface SyncWordsInput {
  running: boolean;
  online: boolean;
  /** Records still trying (pending, in flight, backing off). */
  pending: number;
  /** Records that gave up and wait for the driver's Retry. */
  needsAttention: number;
  /** When the last run ended, delivered or not. */
  lastSyncAt: number | null;
  now: number;
}

export function relativeTime(ts: number | null, now: number): string {
  if (!ts) return 'not yet';
  const secs = Math.max(0, Math.round((now - ts) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

export function syncSubtitle(i: SyncWordsInput): string {
  const when = relativeTime(i.lastSyncAt, i.now);
  if (i.running) return 'Syncing now…';
  if (!i.online) return `Offline · last checked ${when}`;
  if (i.pending > 0) return `${i.pending} waiting · last checked ${when}`;
  if (i.needsAttention > 0) return `Not everything is sent · checked ${when}`;
  return i.lastSyncAt ? `All synced · ${when}` : 'Nothing to sync yet';
}
