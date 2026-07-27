import * as Crypto from 'expo-crypto';
import { getDb } from './db';
import type { OutboxRecord, OutboxStatus } from './policy';

/**
 * Durable write queue (plan §13.3). Every domain mutation is written HERE FIRST — before any UI
 * confirmation — so a driver's work survives a crash, a dead battery, or a week with no signal.
 * The sync engine (sync.ts) drains it; nothing else writes to the network directly.
 */

interface Row {
  id: string;
  kind: string;
  payload: string;
  file_uris: string;
  status: string;
  attempts: number;
  next_attempt_at: number;
  created_at: number;
  last_error: string | null;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toRecord(row: Row): OutboxRecord {
  return {
    id: row.id,
    kind: row.kind,
    payload: parseJson<unknown>(row.payload, null),
    fileUris: parseJson<string[]>(row.file_uris, []),
    status: row.status as OutboxStatus,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    lastError: row.last_error,
  };
}

/** The client UUID that becomes the domain row's primary key — the whole basis of idempotency. */
export function newClientId(): string {
  return Crypto.randomUUID();
}

export interface EnqueueInput {
  /** Pass the id you already generated for the domain object (form mount), or omit for a new one. */
  id?: string;
  kind: string;
  payload: unknown;
  fileUris?: string[];
}

/** Write a mutation to the queue. Re-enqueuing the same id is a no-op (idempotent by PK). */
export async function enqueue(input: EnqueueInput): Promise<OutboxRecord> {
  const db = await getDb();
  const now = Date.now();
  const id = input.id ?? newClientId();
  await db.runAsync(
    `insert into outbox (id, kind, payload, file_uris, status, attempts, next_attempt_at, created_at, last_error)
     values (?, ?, ?, ?, 'pending', 0, ?, ?, null)
     on conflict(id) do nothing;`,
    id,
    input.kind,
    JSON.stringify(input.payload ?? null),
    JSON.stringify(input.fileUris ?? []),
    now,
    now,
  );
  const row = await db.getFirstAsync<Row>('select * from outbox where id = ?;', id);
  if (!row) throw new Error('[outbox] enqueue failed to persist the record');
  return toRecord(row);
}

/** Everything not yet finished — drives the pending badge and the needs-attention list. */
export async function listUnfinished(): Promise<OutboxRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    `select * from outbox where status <> 'done' order by created_at asc;`,
  );
  return rows.map(toRecord);
}

/**
 * Claim the oldest record that is due, atomically flipping it to `in_flight` so two concurrent runs
 * can never pick the same one. Returns null when nothing is due.
 */
export async function claimNext(now = Date.now()): Promise<OutboxRecord | null> {
  const db = await getDb();
  return db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<Row>(
      `select * from outbox
        where status in ('pending', 'failed') and next_attempt_at <= ?
        order by created_at asc limit 1;`,
      now,
    );
    if (!row) return null;
    await tx.runAsync(`update outbox set status = 'in_flight' where id = ?;`, row.id);
    return toRecord({ ...row, status: 'in_flight' });
  });
}

/** Mark a record delivered. Kept (not deleted) briefly so the UI can show "All synced". */
export async function markDone(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `update outbox set status = 'done', last_error = null, file_uris = '[]' where id = ?;`,
    id,
  );
}

export async function markOutcome(
  id: string,
  status: OutboxStatus,
  attempts: number,
  nextAttemptAt: number,
  lastError: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `update outbox set status = ?, attempts = ?, next_attempt_at = ?, last_error = ? where id = ?;`,
    status,
    attempts,
    nextAttemptAt,
    lastError,
    id,
  );
}

/** Manual "try again" on a dead-lettered record (needs-attention list). */
export async function retryNow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `update outbox set status = 'pending', next_attempt_at = 0, attempts = 0, last_error = null where id = ?;`,
    id,
  );
}

/** Release records stuck in-flight after a hard kill (app died mid-sync) so they retry. */
export async function releaseStuck(): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    `update outbox set status = 'pending' where status = 'in_flight';`,
  );
  return res.changes;
}

/** Housekeeping: drop delivered records older than a week. */
export async function pruneDone(olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `delete from outbox where status = 'done' and created_at < ?;`,
    Date.now() - olderThanMs,
  );
}
