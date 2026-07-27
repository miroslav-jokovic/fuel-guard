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

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function open(): Promise<SQLite.SQLiteDatabase> {
  const key = await getOrCreateKey();
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // Raw 32-byte key (x'…') skips SQLCipher's key-derivation step — faster open, same strength.
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  await assertEncrypted(db);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync(SCHEMA);
  return db;
}

/** Lazily open (and migrate) the encrypted outbox DB. Safe to call from anywhere. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= open();
  return dbPromise;
}

/** Test/sign-out helper: drop the handle so the next call re-opens. */
export function resetDbHandle(): void {
  dbPromise = null;
}
