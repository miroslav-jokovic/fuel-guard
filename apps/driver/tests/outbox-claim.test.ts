import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The outbox claim and the rule that keeps it on the keyed connection (found 2026-11-25 on a Galaxy
 * Tab A9). `claimNext()` used `withExclusiveTransactionAsync`, which expo-sqlite runs on a NEW native
 * connection that never receives `PRAGMA key`; against the SQLCipher outbox every claim threw
 * "Error code 26: file is not a database", and sync.ts "repaired" that by deleting the outbox. No
 * queued work ever left a phone.
 *
 * Two halves, because the bug had two halves:
 * - the claim statement itself runs against REAL SQLite (node:sqlite), so its atomicity and ordering
 *   are proven rather than mocked;
 * - a source scan pins that no driver code opens a second connection or deletes the outbox anywhere
 *   but db.ts's open(). The fake SQLite in db-recovery.test.ts could never have caught this: a mock
 *   has no notion of which connection holds the key.
 */

vi.mock('expo-sqlite', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }));

import { SCHEMA } from '@/data/db';
import { CLAIM_NEXT_SQL } from '@/data/outbox';

let db: DatabaseSync;

function insert(id: string, o: { status?: string; nextAttemptAt?: number; createdAt: number }) {
  db.prepare(
    `insert into outbox (id, kind, payload, file_uris, status, attempts, next_attempt_at, created_at, last_error)
     values (?, 'stop.photo', '{}', '[]', ?, 0, ?, ?, null);`,
  ).run(id, o.status ?? 'pending', o.nextAttemptAt ?? 0, o.createdAt);
}

function claim(now: number): Record<string, unknown> | undefined {
  return db.prepare(CLAIM_NEXT_SQL).get(now);
}

function statusOf(id: string): unknown {
  return (db.prepare('select status from outbox where id = ?;').get(id) as { status: string }).status;
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
});

describe('CLAIM_NEXT_SQL against real SQLite', () => {
  it('claims the oldest due record and returns it already marked in_flight', () => {
    insert('b', { createdAt: 2 });
    insert('a', { createdAt: 1 });

    const row = claim(100);

    expect(row?.id).toBe('a');
    expect(row?.status).toBe('in_flight');
    expect(statusOf('a')).toBe('in_flight');
    expect(statusOf('b')).toBe('pending');
  });

  it('never hands the same record to two claims in a row', () => {
    insert('a', { createdAt: 1 });
    insert('b', { createdAt: 2 });

    expect(claim(100)?.id).toBe('a');
    expect(claim(100)?.id).toBe('b');
    expect(claim(100)).toBeUndefined();
  });

  it('takes failed records back, but not ones still backing off, in flight, done or dead', () => {
    insert('later', { status: 'failed', nextAttemptAt: 500, createdAt: 1 });
    insert('flying', { status: 'in_flight', createdAt: 2 });
    insert('done', { status: 'done', createdAt: 3 });
    insert('dead', { status: 'dead', createdAt: 4 });
    insert('retry', { status: 'failed', nextAttemptAt: 50, createdAt: 5 });

    expect(claim(100)?.id).toBe('retry');
    expect(claim(100)).toBeUndefined();
    expect(claim(500)?.id).toBe('later');
  });

  it('returns nothing and changes nothing on an empty queue', () => {
    expect(claim(100)).toBeUndefined();
  });
});

const SRC = path.resolve(__dirname, '../src');
const APP = path.resolve(__dirname, '../app');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('the outbox stays on its one keyed connection', () => {
  const files = [...sourceFiles(SRC), ...sourceFiles(APP)];
  const rel = (f: string) => path.relative(path.resolve(__dirname, '..'), f);

  it('no driver code opens a second SQLite connection (each one would lack PRAGMA key)', () => {
    const offenders = files.filter((f) =>
      /\.withExclusiveTransaction(Async|Sync)\s*\(|useNewConnection\s*:/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('only src/data/db.ts opens or deletes a database', () => {
    const offenders = files.filter((f) =>
      /\b(openDatabase(Async|Sync)|deleteDatabase(Async|Sync))\s*\(/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map(rel)).toEqual(['src/data/db.ts']);
  });

  it('db.ts deletes the outbox only inside open(), where a NOTADB proves the file stale', () => {
    const source = readFileSync(path.join(SRC, 'data/db.ts'), 'utf8');
    const deletes = source.match(/deleteDatabaseAsync\(/g) ?? [];
    expect(deletes).toHaveLength(1);
    const openFn = source.slice(source.indexOf('async function open()'), source.indexOf('let dbPromise'));
    expect(openFn).toContain('deleteDatabaseAsync(');
  });
});
