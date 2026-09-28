/**
 * The apply link's copies on the device (AW10): Part 1's held screens (`partOne/partOneLocal.ts`, C3d1a)
 * and Part 2's unsent draft (`draftLocal.ts`, C3d1b). One database, one store per copy, each row keyed by
 * the bundle's `localKey`. What each copy holds, and for how long, is its own module's rule (Q-AW39);
 * this file is only the storage.
 *
 * ── STORAGE BLOCKED IS NOT BROKEN ─────────────────────────────────────────────────────────────
 * As `inventory/countQueue.ts`: every function RESOLVES when IndexedDB is unavailable (a private window,
 * storage disabled). The page then behaves as it did before AW10 — it cannot survive a reload, and it
 * still works.
 *
 * ── ORDER ─────────────────────────────────────────────────────────────────────────────────────
 * No queue of our own: IndexedDB processes a database's open requests in order (its connection queue)
 * and starts readwrite transactions on one store in the order they were created, so a write asked for
 * before a delete cannot land after it. Pinned by
 * "never lets a write asked for before a delete land after it".
 *
 * ⚠ C3d1a shipped Part 1's copy in its own database, `silvicom-part-one`, for one day. Opening this one
 * deletes that one: a copy left in it would never be read or swept again, and it holds a date of birth.
 */

const DB_NAME = "silvicom-apply";
const DB_VERSION = 1;
const RETIRED_DB = "silvicom-part-one";

export type CopyStore = "partOne" | "partTwo";
const STORES: readonly CopyStore[] = ["partOne", "partTwo"];

/** Every row carries its key and the moment it stops being readable. */
export interface CopyRow {
  key: string;
  version: number;
  expiresAt: string;
}

let retired = false;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    if (!retired) {
      retired = true;
      try {
        indexedDB.deleteDatabase(RETIRED_DB);
      } catch {
        // Best effort: a browser that cannot delete it cannot have stored anything in it either.
      }
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function tx<T>(
  store: CopyStore,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await open();
  return new Promise<T | null>((resolve) => {
    if (!db) return resolve(null);
    try {
      const request = run(db.transaction(store, mode).objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putCopy<T extends CopyRow>(store: CopyStore, row: T): Promise<void> {
  await tx(store, "readwrite", (s) => s.put(row));
}

export async function deleteCopy(store: CopyStore, key: string): Promise<void> {
  await tx(store, "readwrite", (s) => s.delete(key) as unknown as IDBRequest<undefined>);
}

/**
 * This key's copy, if `live` says it may be read — after deleting every copy in the store that may not,
 * whoever's it is: a copy for a link nobody reopens must not outlive its rule because nobody came back.
 */
export async function readCopy<T extends CopyRow>(
  store: CopyStore,
  key: string,
  live: (row: T) => boolean,
): Promise<T | null> {
  const all = ((await tx(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>)) ?? []) as T[];
  for (const row of all) if (!live(row)) await deleteCopy(store, row.key);
  return all.find((row) => row.key === key && live(row)) ?? null;
}

/** The earlier of `ttlMs` from now and the link's expiry (Q-AW39). An unreadable expiry leaves the ttl. */
export function copyExpiry(now: Date, ttlMs: number, linkExpiresAt: string): string {
  const ttl = now.getTime() + ttlMs;
  const link = Date.parse(linkExpiresAt);
  return new Date(Number.isNaN(link) ? ttl : Math.min(ttl, link)).toISOString();
}

/** A copy of this shape, not yet expired. */
export const isLive = (row: CopyRow, version: number, now: Date): boolean =>
  row.version === version && Date.parse(row.expiresAt) > now.getTime();

/** What the bundle says about the link, for a copy's key and its lifetime. */
export interface LocalCopySpec {
  key: string;
  linkExpiresAt: string;
}
