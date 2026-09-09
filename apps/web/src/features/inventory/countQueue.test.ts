import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import type { PartMovementInput } from "@silvicom/shared";
import { dequeue, enqueue, flush, kindOf, pending, type QueuedCount } from "./countQueue";

/**
 * The count screen's write queue (INVENTORY-PLAN.md I5 PR 2b).
 *
 * ── WHY THIS IS TESTED AGAINST A REAL IndexedDB AND NOT AN INTERFACE ──────────────────────────
 * The queue's whole value is that it survives things — a reload, a crash, a browser restart — and an
 * in-memory fake substituted behind an interface would test the fake. `fake-indexeddb` is a real
 * implementation of the actual API, so the transaction shape, the key path and the upgrade are all
 * exercised; a `keyPath` typo would fail here and would not fail against a `Map`.
 *
 * ── WHAT THE ASSERTIONS ARE ABOUT ─────────────────────────────────────────────────────────────
 * Not "does it store things". Three properties the count depends on:
 *
 *   · **order.** A count is a sequence of absolute totals against one shelf and the RPC takes each
 *     delta at commit time, so replaying them out of order applies them against a shelf that never
 *     existed;
 *   · **stopping at the first failure**, for the same reason — skipping a failure and carrying on
 *     would land later counts on a shelf missing an earlier one;
 *   · **degrading rather than throwing** when there is no IndexedDB at all. A private window must
 *     still be able to count; it just cannot survive a reload.
 */

const movement = (id: string): PartMovementInput =>
  ({
    id,
    partId: "11111111-1111-4111-8111-111111111111",
    locationId: "22222222-2222-4222-8222-222222222222",
    occurredAt: "2026-09-09T10:00:00.000Z",
    reason: "counted",
    countedTotal: 7,
    blind: true,
  }) as PartMovementInput;

const row = (id: string, queuedAt: string, sessionId = "s-1") => ({
  id,
  sessionId,
  movement: movement(id),
  queuedAt,
});

beforeEach(() => {
  // A fresh database per test — the queue is a singleton by design, so the isolation has to come
  // from the factory rather than from the module.
  globalThis.indexedDB = new IDBFactory();
});

describe("the queue keeps the walk", () => {
  it("holds what was written and gives it back", async () => {
    await enqueue(row("a", "2026-09-09T10:00:00.000Z"));
    const rows = await pending();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.movement.id).toBe("a");
  });

  it("returns them OLDEST FIRST, whatever order they went in", async () => {
    await enqueue(row("c", "2026-09-09T10:02:00.000Z"));
    await enqueue(row("a", "2026-09-09T10:00:00.000Z"));
    await enqueue(row("b", "2026-09-09T10:01:00.000Z"));
    expect((await pending()).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("scopes to one walk when asked, so two counts do not read each other's entries", async () => {
    await enqueue(row("a", "2026-09-09T10:00:00.000Z", "s-1"));
    await enqueue(row("b", "2026-09-09T10:01:00.000Z", "s-2"));
    expect((await pending("s-1")).map((r) => r.id)).toEqual(["a"]);
  });

  it("drops a row once the server has it", async () => {
    await enqueue(row("a", "2026-09-09T10:00:00.000Z"));
    await dequeue("a");
    expect(await pending()).toEqual([]);
  });

  it("re-queuing the same movement id replaces rather than duplicates", async () => {
    // The id is the primary key here for the same reason it is the idempotency key at the server:
    // one movement, one row, however many times the screen writes it down.
    await enqueue(row("a", "2026-09-09T10:00:00.000Z"));
    await enqueue(row("a", "2026-09-09T10:05:00.000Z"));
    expect(await pending()).toHaveLength(1);
  });
});

describe("which ledger a row belongs to (I9)", () => {
  /**
   * ⚠ A row written before I9 carries no `kind`, and replaying one to the wrong endpoint would send
   * a shelf count to `move_asset`. The default is what stops that, and it is asserted rather than
   * assumed because the row that proves it can only exist on somebody's phone across a deploy.
   */
  it("reads a row with no kind as a part movement", async () => {
    await enqueue(row("a", "2026-09-09T10:00:00.000Z"));
    const [queued] = await pending();
    expect(queued!.kind).toBeUndefined();
    expect(kindOf(queued!)).toBe("part");
  });

  it("...and carries the kind it was given", async () => {
    await enqueue({ ...row("b", "2026-09-09T10:00:00.000Z"), kind: "asset" });
    const [queued] = await pending();
    expect(kindOf(queued!)).toBe("asset");
  });
});

describe("flushing", () => {
  it("sends everything in order and empties the queue", async () => {
    await enqueue(row("a", "2026-09-09T10:00:00.000Z"));
    await enqueue(row("b", "2026-09-09T10:01:00.000Z"));
    const sent: string[] = [];
    const count = await flush(async (r) => void sent.push(r.id));
    expect(sent).toEqual(["a", "b"]);
    expect(count).toBe(2);
    expect(await pending()).toEqual([]);
  });

  /**
   * ⚠ The assertion that matters. A count is a run of absolute totals and the RPC takes each delta
   * against what is on hand AT COMMIT TIME — so a flush that skipped a failure and carried on would
   * apply the later counts against a shelf missing the earlier one, and the variance report would
   * blame a bin nobody miscounted.
   */
  it("STOPS at the first failure and keeps the rest, in order", async () => {
    await enqueue(row("a", "2026-09-09T10:00:00.000Z"));
    await enqueue(row("b", "2026-09-09T10:01:00.000Z"));
    await enqueue(row("c", "2026-09-09T10:02:00.000Z"));
    const sent: string[] = [];
    const send = vi.fn(async (r: QueuedCount) => {
      if (r.id === "b") throw new Error("offline");
      sent.push(r.id);
    });
    const count = await flush(send);
    expect(sent).toEqual(["a"]);
    expect(count).toBe(1);
    expect((await pending()).map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("is a no-op on an empty queue rather than an error", async () => {
    expect(await flush(async () => undefined)).toBe(0);
  });
});

/**
 * A private window, a browser with site data blocked, a jsdom with no shim. The count must still
 * work — it degrades to "sent immediately, nothing kept", which is a screen without a queue rather
 * than a screen that is broken.
 */
describe("with no IndexedDB at all", () => {
  beforeEach(() => {
    // @ts-expect-error — deliberately removing the API the way a locked-down browser does.
    delete globalThis.indexedDB;
  });

  it("swallows the write instead of throwing", async () => {
    await expect(enqueue(row("a", "2026-09-09T10:00:00.000Z"))).resolves.toBeUndefined();
  });

  it("reports an empty queue rather than failing to read one", async () => {
    expect(await pending()).toEqual([]);
  });

  it("flushes nothing, quietly", async () => {
    expect(await flush(async () => undefined)).toBe(0);
  });
});
