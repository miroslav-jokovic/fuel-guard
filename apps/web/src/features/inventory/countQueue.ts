import type { AssetMovementInput, PartMovementInput } from "@silvicom/shared";

/**
 * The count screen's write queue (INVENTORY-PLAN.md I5 PR 2b, D-INV27, §2.12).
 *
 * ── WHY A QUEUE AT ALL, AND WHY NOT BACKGROUND SYNC ───────────────────────────────────────────
 * A shelf count happens in a bay, and a bay is where the signal is worst. The connectivity strip on
 * the count screen promises "Saving on this phone — will sync when connected", and a promise on a
 * screen has to be backed by something: the count is written HERE first and sent afterwards, so a
 * technician who walks behind a container does not lose the last four bins.
 *
 * The Background Sync API would be the obvious mechanism and it is not available — Safari has never
 * shipped it and there is no sign of it (research §4.5), and this shop's phones are iPhones (§2.11).
 * So the replay is ours: IndexedDB survives a reload, a crash and a browser restart, and the queue
 * is drained on `online` and on the next visit.
 *
 * ── THE SERVER HALF IS ALREADY BUILT, AND IT IS WHAT MAKES THIS SAFE ──────────────────────────
 * Every queued row carries the movement id the drawer minted (D-INV27), and
 * `record_part_movement` returns the row it already has for an id it has seen. So a flush that
 * half-succeeded — sent, committed, connection dropped before the response — replays harmlessly:
 * the second attempt gets the same movement back and the shelf moves once. Without that, a queue
 * would be a machine for double-counting.
 *
 * ── `localStorage` WAS CONSIDERED AND REJECTED ────────────────────────────────────────────────
 * It would hold this data — a few dozen small rows — and it needs no dependency. It is synchronous,
 * which on this screen means the main thread stalls on every write while a thumb is mid-tap, and it
 * is per-origin 5 MB shared with everything else the app stores. IndexedDB is asynchronous and is
 * what the plan names; the cost is one dev dependency to test it (`fake-indexeddb`), which is a
 * smaller price than a stall on the one screen that has to feel instant.
 */

const DB_NAME = "silvicom-count-queue";
const DB_VERSION = 1;
const STORE = "movements";

/**
 * Which ledger a queued row belongs to (I9).
 *
 * A shelf walk queues a `counted` PART movement; a unit check queues an `asset_movements` row. They
 * are the same session shape (D-INV19) and two different endpoints, so the row has to say which —
 * a queue that guessed would replay a unit check into `record_part_movement`.
 */
export type QueuedKind = "part" | "asset";

export interface QueuedCount {
  /** The movement id — the primary key here AND the idempotency key at the server (D-INV27). */
  id: string;
  sessionId: string;
  /**
   * ⚠ Absent on rows written before I9, and read as `"part"` when it is. The store is not versioned
   * for this — there is no schema change, only a new field — and a row already on somebody's phone
   * when the app updates must not be replayed to the wrong endpoint. Production held zero inventory
   * rows when this shipped (measured 2026-09-09), so the coalesce is cheap insurance rather than a
   * migration; it costs one `??` and removes the only way this generalisation could lose a count.
   */
  kind?: QueuedKind;
  /** The whole validated payload, sent verbatim on flush. */
  movement: PartMovementInput | AssetMovementInput;
  queuedAt: string;
}

/** The kind a row belongs to, with the pre-I9 default applied. */
export const kindOf = (row: QueuedCount): QueuedKind => row.kind ?? "part";

/**
 * ⚠ Every function below RESOLVES rather than throws when IndexedDB is unavailable — a private
 * window, a browser with storage disabled, a jsdom without the shim. The count must still work in
 * that browser: it degrades to "sent immediately, nothing kept", which is the behaviour of a
 * screen with no queue rather than a screen that is broken. A count that refused to open because
 * storage was blocked would be a worse product than one that simply cannot survive a reload.
 */
function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await open();
  return new Promise<T | null>((resolve) => {
    if (!db) return resolve(null);
    try {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Write the count down before trying to send it. The order is the whole point. */
export async function enqueue(entry: QueuedCount): Promise<void> {
  await tx("readwrite", (store) => store.put(entry));
}

/** Drop a row that the server has acknowledged — or has told us it already had. */
export async function dequeue(id: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(id) as unknown as IDBRequest<undefined>);
}

/** Everything still waiting, oldest first, so a flush replays in the order it was counted. */
export async function pending(sessionId?: string): Promise<QueuedCount[]> {
  const all = ((await tx("readonly", (store) => store.getAll() as IDBRequest<QueuedCount[]>)) ??
    []) as QueuedCount[];
  const rows = sessionId ? all.filter((r) => r.sessionId === sessionId) : all;
  return rows.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

/**
 * Send what is waiting, oldest first, and stop at the first failure.
 *
 * ⚠ Stopping matters. A count is a sequence of absolute totals against one shelf, and the RPC takes
 * each delta at commit time — so replaying them out of order, or skipping a failure and continuing,
 * would apply them against a shelf that never existed. On a failure the rest stay queued and the
 * strip keeps saying so.
 *
 * Returns how many were accepted, which is what the connectivity strip counts down.
 *
 * The sender takes the whole ROW rather than the movement, because since I9 the caller has to read
 * `kind` to know which endpoint the payload belongs to.
 */
export async function flush(send: (row: QueuedCount) => Promise<void>): Promise<number> {
  const rows = await pending();
  let sent = 0;
  for (const row of rows) {
    try {
      await send(row);
    } catch {
      break;
    }
    await dequeue(row.id);
    sent += 1;
  }
  return sent;
}
