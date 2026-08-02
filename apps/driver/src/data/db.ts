import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

/**
 * The outbox database — SQLCipher-encrypted at rest (D12 / §21).
 *
 * Why encrypted when the read cache isn't: the outbox holds work that exists NOWHERE ELSE yet —
 * stop photos, odometer readings, locations — on a device that gets lost, stolen, or rooted. The
 * 256-bit key lives in the OS keychain/keystore (expo-secure-store); only the ciphertext is on disk.
 *
 * Requires the `useSQLCipher` flag on the expo-sqlite config plugin (app.config.ts) — plain SQLite
 * silently IGNORES `PRAGMA key`, which would leave the DB readable. `assertEncrypted()` checks
 * `cipher_version` after opening and warns loudly in dev rather than failing quietly in the field.
 */
const DB_NAME = 'fuelguard-outbox.db';
const KEY_ALIAS = 'fuelguard.outbox.dbkey';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

async function getOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_ALIAS);
  if (existing) return existing;
  const key = toHex(Crypto.getRandomBytes(32));
  await SecureStore.setItemAsync(KEY_ALIAS, key, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return key;
}

async function assertEncrypted(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    const row = await db.getFirstAsync<{ cipher_version?: string }>('PRAGMA cipher_version;');
    const version = row?.cipher_version;
    if (!version) {
      console.warn(
        '[outbox] SQLCipher is NOT active — the outbox is unencrypted. Add ["expo-sqlite", { "useSQLCipher": true }] to app.config.ts plugins and rebuild the dev client (D12).',
      );
    }
  } catch {
    console.warn('[outbox] Could not verify SQLCipher; treat the outbox as unencrypted (D12).');
  }
}

const SCHEMA = `
  create table if not exists outbox (
    id              text primary key not null,
    kind            text not null,
    payload         text not null,
    file_uris       text not null default '[]',
    status          text not null default 'pending',
    attempts        integer not null default 0,
    next_attempt_at integer not null default 0,
    created_at      integer not null,
    last_error      text
  );
  create index if not exists outbox_ready on outbox (status, next_attempt_at, created_at);
`;

/**
 * SQLite error code 26 (SQLITE_NOTADB): the file exists but cannot be decrypted with our key. It
 * happens when the on-device DB predates the current SQLCipher key — an older dev-client build that
 * lacked the `useSQLCipher` flag (so the file is plaintext and `PRAGMA key` makes it unreadable), or
 * a reinstall that cleared the keychain entry while leaving the DB file behind. expo-sqlite surfaces
 * it as a message string, not a typed code, so we match the text. Exported for the unit test.
 */
export function isNotADbError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /code 26\b|file is not a database|NOTADB/i.test(msg);
}

/**
 * Open the DB with `key`, then FORCE key verification by reading the schema catalog: SQLCipher only
 * decrypts page 1 on the first real read, so a wrong-key or plaintext file throws NOTADB here — inside
 * open(), where we can recover — instead of later inside `claimNext()`'s prepareAsync, where it just
 * aborts every sync drain with no path to recover. On any failure the half-open handle is closed so
 * the file can be deleted and reopened cleanly.
 */
async function openOnce(key: string): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  try {
    // Raw 32-byte key (x'…') skips SQLCipher's key-derivation step — faster open, same strength.
    await db.execAsync(`PRAGMA key = "x'${key}'";`);
    await assertEncrypted(db);
    // The verification read — decrypts page 1; a bad key/plaintext file throws NOTADB right here.
    await db.getFirstAsync('select count(*) from sqlite_master;');
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync(SCHEMA);
    return db;
  } catch (e) {
    await db.closeAsync().catch(() => {
      /* closing a half-open handle is best-effort — the delete/reopen below still proceeds */
    });
    throw e;
  }
}

/**
 * Open (and migrate) the encrypted outbox DB, recovering ONCE from a NOTADB file. A NOTADB means the
 * existing file is unreadable with our key; its queued rows are ALREADY unrecoverable, so the only
 * path to a working outbox is to drop the file and recreate it with the (unchanged) key. Recovery
 * runs at most once per open() — a second NOTADB on a freshly created file would be a genuine bug and
 * is allowed to throw rather than loop forever.
 */
async function open(): Promise<SQLite.SQLiteDatabase> {
  const key = await getOrCreateKey();
  try {
    return await openOnce(key);
  } catch (e) {
    if (!isNotADbError(e)) throw e;
    console.warn(
      '[outbox] SQLCipher could not open the existing outbox DB (NOTADB) — it predates the current ' +
        'key (older build or reinstall). Recreating it; any un-synced queued items in the old file are ' +
        'lost, which is unavoidable since they were already unreadable.',
    );
    await SQLite.deleteDatabaseAsync(DB_NAME).catch(() => {
      /* the file may already be gone; the reopen recreates it either way */
    });
    return openOnce(key); // same key on a fresh file → a valid, encrypted DB
  }
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Lazily open (and migrate) the encrypted outbox DB. Safe to call from anywhere. A failed open is
 * NOT cached: the next call retries (e.g. after the OS finishes unlocking the keychain on a cold
 * boot), instead of wedging every future getDb() on one early failure.
 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= open().catch((e: unknown) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

/** Test/sign-out helper: drop the handle so the next call re-opens. */
export function resetDbHandle(): void {
  dbPromise = null;
}

/**
 * Recover an already-open handle that surfaced SQLITE_NOTADB during a later statement. This is the
 * second safety net for older dev clients: some native SQLite builds defer page/key validation until
 * `prepareAsync`, after the initial catalog read. Recovery is explicit and bounded, never a retry loop.
 */
export async function recoverCorruptDb(): Promise<void> {
  const current = dbPromise;
  dbPromise = null;
  const handle = await current?.catch(() => null);
  await handle?.closeAsync().catch(() => {
    /* best effort; deleteDatabaseAsync remains the source of truth */
  });
  await SQLite.deleteDatabaseAsync(DB_NAME).catch(() => {
    /* the file may already be gone */
  });
  await getDb();
}
