import { computed, getCurrentInstance, inject, onScopeDispose, provide, type InjectionKey, type Ref } from "vue";

/**
 * The apply link's copies on the device (AW10): Part 1's held screens (`partOne/partOneLocal.ts`, C3d1a),
 * Part 2's unsent draft (`draftLocal.ts`, C3d1b) and photographs not yet confirmed (`capture/photoLocal.ts`,
 * C3d2). One database, one store per copy, each row keyed by the bundle's `localKey`. What each copy holds, and for how long, is its own module's rule (Q-AW39);
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
/** 2: C3d2 added `photos`. The upgrade creates whichever stores are missing, so 1 → 2 keeps both copies. */
const DB_VERSION = 2;
const RETIRED_DB = "silvicom-part-one";

export type CopyStore = "partOne" | "partTwo" | "photos";
const STORES: readonly CopyStore[] = ["partOne", "partTwo", "photos"];

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

/**
 * A copy written a moment after the last change — and at once when a screen is passed (`now`) or the page
 * is put away (C3d3b1).
 *
 * ⚠ **Found by the first browser test, not by a unit test.** Both copies of typed answers (`partOneLocal`,
 * `draftLocal`) were a plain 300 ms trailing debounce, which a stream of changes each sooner than 300 ms
 * apart never lets fire: Playwright walked Part 1's screens 3–6 that fast, reloaded at screen 7, and Part 1
 * reopened on its first screen, empty. A driver's autofill does the same to one screen. §6.8's bar is zero
 * lost answers, so:
 *
 * - **`now`** writes at once, and the callers use it at the moments that matter — a screen passed (Part 1),
 *   a section changed (Part 2). Typing within a screen stays debounced.
 * - **`visibilitychange` → hidden** runs a pending write: on a phone it is the one event reliably sent
 *   while the tab is still alive, before the OS may drop it in the background.
 * - **`pagehide`** runs it too, best effort only. Measured: a write started as the page RELOADS did not
 *   survive — the document is gone before IndexedDB commits — which is why `now` exists at all.
 *
 * Call in a setup or an effect scope: the two listeners are removed with it, and the pending write is
 * dropped, never run, when the scope ends — a screen that is gone has nothing left to keep.
 */
export function debouncedCopy(write: () => void, ms: number): { schedule(): void; now(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const flush = (): void => {
    if (timer === null) return;
    cancel();
    write();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") flush();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  if (typeof window !== "undefined") window.addEventListener("pagehide", flush);
  onScopeDispose(() => {
    cancel();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", flush);
  });
  return {
    schedule() {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        write();
      }, ms);
    },
    now() {
      cancel();
      write();
    },
    cancel,
  };
}

/** What the bundle says about the link, for a copy's key and its lifetime. */
export interface LocalCopySpec {
  key: string;
  linkExpiresAt: string;
}

/**
 * The link's copy spec, provided once by `ApplyPage` (C3d2) — the way `issues.ts` provides the issue list —
 * because the capture screens sit three and four components down and none of them otherwise needs the
 * bundle. Null where nothing provided it (a test, a page from before C3d1a's `localKey`): no copy is kept.
 */
export const APPLY_LOCAL_COPY: InjectionKey<Ref<LocalCopySpec | null>> = Symbol("apply-local-copy");

/**
 * Where this link's copies live, from the bundle — provided to every screen below the page, and returned for
 * the page's own autosave. Null for a bundle with no `localKey` (one cached from before C3d1a).
 */
export function provideLocalCopy(
  bundle: () => { localKey?: string; expiresAt: string } | undefined,
): Ref<LocalCopySpec | null> {
  const spec = computed<LocalCopySpec | null>(() => {
    const inv = bundle();
    return inv?.localKey ? { key: inv.localKey, linkExpiresAt: inv.expiresAt } : null;
  });
  provide(APPLY_LOCAL_COPY, spec);
  return spec;
}

/** Safe outside a component (a composable under test in an effect scope): no instance, no copy. */
export const injectLocalCopy = (): Ref<LocalCopySpec | null> | null =>
  getCurrentInstance() ? inject(APPLY_LOCAL_COPY, null) : null;
