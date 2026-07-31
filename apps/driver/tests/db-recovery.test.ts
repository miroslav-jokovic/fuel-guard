import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Outbox DB recovery (regression from the 2026-07-28 device launch: `SQLiteErrorException: Error
 * code 26: file is not a database` aborted every sync). Verifies db.ts recovers from a NOTADB file
 * by dropping and recreating it, instead of dying on every open.
 *
 * The native modules db.ts imports are mocked so this runs in the node test env with no device. The
 * fake SQLite handle lets each test decide whether the verification read (`sqlite_master`) throws.
 */

// Hoisted so the vi.mock factories (which are hoisted above imports) can reach them.
const h = vi.hoisted(() => ({
  openImpl: { current: null as null | (() => Promise<unknown>) },
  deleteDatabaseAsync: vi.fn(() => Promise.resolve()),
}));

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: () => h.openImpl.current!(),
  deleteDatabaseAsync: () => h.deleteDatabaseAsync(),
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(() => Promise.resolve('ab'.repeat(32))), // an existing key → getOrCreateKey returns it
  setItemAsync: vi.fn(() => Promise.resolve()),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
}));

vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(n),
  randomUUID: () => '00000000-0000-0000-0000-000000000000',
}));

import { getDb, isNotADbError, recoverCorruptDb, resetDbHandle } from '@/data/db';

const NOTADB = () => new Error('Error code 26: file is not a database (at SQLiteModule.swift:382)');

/** A fake db handle. `failVerifyWith` throws on the sqlite_master verification read. */
function fakeDb(opts: { failVerifyWith?: Error } = {}) {
  const closeAsync = vi.fn(() => Promise.resolve());
  return {
    handle: {
      execAsync: vi.fn(() => Promise.resolve()),
      getFirstAsync: vi.fn((sql: string) => {
        if (sql.includes('cipher_version')) return { cipher_version: '4.5.0' };
        if (sql.includes('sqlite_master')) {
          if (opts.failVerifyWith) throw opts.failVerifyWith;
          return { 'count(*)': 0 };
        }
        return null;
      }),
      closeAsync,
    },
    closeAsync,
  };
}

beforeEach(() => {
  resetDbHandle();
  h.deleteDatabaseAsync.mockClear();
  h.openImpl.current = null;
});

describe('isNotADbError', () => {
  it('matches the SQLCipher NOTADB message (code + text + symbol)', () => {
    expect(isNotADbError(new Error('Error code 26: file is not a database'))).toBe(true);
    expect(isNotADbError(new Error('SQLITE_NOTADB'))).toBe(true);
    expect(isNotADbError('file is not a database')).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isNotADbError(new Error('database is locked'))).toBe(false); // code 5, transient — must NOT nuke the DB
    expect(isNotADbError(new Error('Error code 260: constraint'))).toBe(false); // word-boundary guard
    expect(isNotADbError(new Error('network request failed'))).toBe(false);
    expect(isNotADbError(undefined)).toBe(false);
  });
});

describe('getDb NOTADB recovery', () => {
  it('deletes the unreadable file once and reopens successfully', async () => {
    const bad = fakeDb({ failVerifyWith: NOTADB() });
    const good = fakeDb();
    let call = 0;
    h.openImpl.current = () => {
      call += 1;
      return Promise.resolve(call === 1 ? bad.handle : good.handle);
    };

    const db = await getDb();

    expect(db).toBe(good.handle); // the caller gets the healthy, recreated DB
    expect(h.deleteDatabaseAsync).toHaveBeenCalledTimes(1); // dropped exactly once
    expect(bad.closeAsync).toHaveBeenCalledTimes(1); // the half-open bad handle was closed first
    expect(call).toBe(2); // opened twice: fail, then recreate
  });

  it('repairs an already-open handle when native validation is deferred until a later statement', async () => {
    const old = fakeDb();
    const good = fakeDb();
    let call = 0;
    h.openImpl.current = () => {
      call += 1;
      return Promise.resolve(call === 1 ? old.handle : good.handle);
    };

    await getDb();
    await recoverCorruptDb();

    expect(h.deleteDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(old.closeAsync).toHaveBeenCalledTimes(1);
    expect(call).toBe(2);
  });

  it('does NOT delete the DB for a non-NOTADB error (a transient lock must not lose the queue)', async () => {
    const locked = fakeDb({ failVerifyWith: new Error('database is locked') });
    h.openImpl.current = () => Promise.resolve(locked.handle);

    await expect(getDb()).rejects.toThrow(/locked/);
    expect(h.deleteDatabaseAsync).not.toHaveBeenCalled();
  });

  it('throws if a freshly recreated DB is STILL NOTADB — never loops forever', async () => {
    h.openImpl.current = () => Promise.resolve(fakeDb({ failVerifyWith: NOTADB() }).handle);

    await expect(getDb()).rejects.toThrow(/file is not a database/);
    expect(h.deleteDatabaseAsync).toHaveBeenCalledTimes(1); // tried recovery exactly once, then gave up
  });
});

describe('getDb failure caching', () => {
  it('does not cache a rejected open — the next call retries', async () => {
    let call = 0;
    h.openImpl.current = () => {
      call += 1;
      if (call === 1) return Promise.reject(new Error('keychain not ready'));
      return Promise.resolve(fakeDb().handle);
    };

    await expect(getDb()).rejects.toThrow(/keychain not ready/); // first call fails
    await expect(getDb()).resolves.toBeTruthy(); // second call succeeds instead of re-throwing the cached failure
    expect(call).toBe(2);
  });
});
