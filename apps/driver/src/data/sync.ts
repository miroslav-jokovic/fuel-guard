import { useEffect, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import {
  claimNext,
  listUnfinished,
  markDone,
  markOutcome,
  pruneDone,
  releaseStuck,
  retryNow,
} from './outbox';
import { discardStagedFiles, sweepOrphans } from './fileStaging';
import { isNotADbError, recoverCorruptDb } from './db';
import { countNeedsAttention, countPending, outcomeAfterFailure, type OutboxRecord } from './policy';

/**
 * The sync engine (plan §13.3). One serial worker drains the outbox: claim the oldest due record,
 * run its registered handler, mark done (deleting staged files) or apply the retry policy. Serial
 * on purpose — it preserves the order a driver did things and avoids a reconnect stampede.
 */

/** Handlers throw this so the policy can tell a retryable blip from a permanent rejection. */
export class SyncError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SyncError';
    this.status = status;
  }
}

export interface SyncHandler {
  /** Deliver the record. Throw SyncError(status) on failure. Must be safe to replay (idempotent). */
  run: (record: OutboxRecord) => Promise<void>;
  /** Query keys to invalidate after a successful delivery. */
  invalidates?: readonly (readonly unknown[])[];
}

const handlers = new Map<string, SyncHandler>();

/** Feature modules register their kind at startup (Phase 3: 'load_accept', 'load_stop_photos'). */
export function registerHandler(kind: string, handler: SyncHandler): void {
  handlers.set(kind, handler);
}

// ── observable state ─────────────────────────────────────────────────────────
export interface SyncState {
  pending: number;
  needsAttention: number;
  running: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
}

let state: SyncState = {
  pending: 0,
  needsAttention: 0,
  running: false,
  lastSyncAt: null,
  lastError: null,
};
const listeners = new Set<() => void>();

function updateState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): SyncState => state;

/** Live sync state for the UI (pending badge, sync row, offline banner). */
export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

async function refreshCounters(): Promise<OutboxRecord[]> {
  const records = await listUnfinished();
  updateState({ pending: countPending(records), needsAttention: countNeedsAttention(records) });
  return records;
}

// ── the worker ───────────────────────────────────────────────────────────────
let client: QueryClient | null = null;
let running = false;
let rerunRequested = false;

async function processOne(record: OutboxRecord): Promise<boolean> {
  const handler = handlers.get(record.kind);
  if (!handler) {
    // Unknown kind (e.g. a record written by a newer build). Park it — never discard a driver's work.
    await markOutcome(record.id, 'dead', record.attempts + 1, Date.now(), `No handler for "${record.kind}"`);
    return false;
  }
  try {
    await handler.run(record);
    await markDone(record.id);
    discardStagedFiles(record.fileUris); // only after a CONFIRMED delivery
    if (client && handler.invalidates) {
      for (const key of handler.invalidates) {
        void client.invalidateQueries({ queryKey: [...key] });
      }
    }
    return true;
  } catch (e) {
    const status = e instanceof SyncError ? e.status : undefined;
    const message = e instanceof Error ? e.message : 'Unknown sync error';
    const outcome = outcomeAfterFailure(record, status, message, Date.now());
    await markOutcome(record.id, outcome.status, outcome.attempts, outcome.nextAttemptAt, outcome.lastError);
    updateState({ lastError: message });
    return false;
  }
}

/**
 * Drain the queue. Concurrent calls collapse into one run (a second request just asks the current
 * run to loop again), so triggers can fire freely.
 */
export async function runSync(): Promise<void> {
  if (running) {
    rerunRequested = true;
    return;
  }
  if (!onlineManager.isOnline()) {
    await refreshCounters();
    return;
  }
  running = true;
  updateState({ running: true });
  try {
    do {
      rerunRequested = false;
      for (;;) {
        const record = await claimNext();
        if (!record) break;
        const ok = await processOne(record);
        await refreshCounters();
        // A failure means the network is likely down or the server is unhappy — stop this pass and
        // let the next trigger (or backoff) retry, rather than burning through the whole queue.
        if (!ok) break;
      }
    } while (rerunRequested);
    updateState({ lastSyncAt: Date.now() });
  } catch (e) {
    // A storage-layer fault must not surface as an unhandled rejection from a fire-and-forget
    // trigger. A stale SQLCipher/plaintext DB is recoverable, even when native SQLite defers the
    // failure until claimNext() prepares its first statement.
    const message = e instanceof Error ? e.message : 'Sync failed';
    if (isNotADbError(message)) {
      try {
        await recoverCorruptDb();
        await refreshCounters();
        updateState({ lastError: null });
        console.warn('[sync] repaired an unreadable offline queue; new work can sync normally');
      } catch (recoveryError) {
        const recoveryMessage = recoveryError instanceof Error ? recoveryError.message : message;
        console.warn('[sync] offline queue recovery failed:', recoveryMessage);
        updateState({ lastError: recoveryMessage });
      }
    } else {
      console.warn('[sync] run aborted:', message);
      updateState({ lastError: message });
    }
  } finally {
    running = false;
    updateState({ running: false });
    try {
      await refreshCounters();
    } catch {
      /* counters are cosmetic — never let them break the run */
    }
  }
}

/** Manual retry from the needs-attention list. */
export async function retryRecord(id: string): Promise<void> {
  await retryNow(id);
  await refreshCounters();
  void runSync();
}

export async function loadOutboxRecords(): Promise<OutboxRecord[]> {
  return refreshCounters();
}

// ── triggers ─────────────────────────────────────────────────────────────────
const TICK_MS = 60_000;

/**
 * Start the engine: recover records stranded in-flight by a hard kill, sweep orphaned files, then
 * sync on connectivity regained, on foreground, and on a slow tick while work is pending.
 */
export function initSync(queryClient: QueryClient): () => void {
  client = queryClient;

  void (async () => {
    try {
      const released = await releaseStuck();
      if (released > 0) console.warn(`[sync] recovered ${released} record(s) stranded in flight`);
      await pruneDone();
      const records = await refreshCounters();
      sweepOrphans(records.flatMap((r) => r.fileUris));
    } catch (e) {
      // Opening/recovering the DB failed — surface it, but still let triggers try later.
      console.warn('[sync] startup recovery failed:', e instanceof Error ? e.message : e);
    }
    void runSync();
  })();

  const unsubscribeOnline = onlineManager.subscribe((online) => {
    if (online) void runSync();
  });

  const appStateSub = AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status === 'active') void runSync();
  });

  const timer = setInterval(() => {
    if (state.pending > 0) void runSync();
  }, TICK_MS);

  return () => {
    unsubscribeOnline();
    appStateSub.remove();
    clearInterval(timer);
    client = null;
  };
}

/** Mount-time hook used by the root layout. */
export function useSyncEngine(queryClient: QueryClient): void {
  useEffect(() => initSync(queryClient), [queryClient]);
}
