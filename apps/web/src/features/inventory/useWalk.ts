import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { dequeue, enqueue, flush, kindOf, pending, type QueuedCount, type QueuedKind } from "./countQueue";

/**
 * The part of a walk that is the same whether it is a shelf or a truck (D-INV19, plan I5/I9).
 *
 * ── WHAT IS GENUINELY SHARED, AND WHAT IS NOT ─────────────────────────────────────────────────
 * A shelf count types a quantity per bin; a unit check taps Found or Not here per item. Those are
 * two vocabularies and two ledgers, and a single component doing both would be a screen with two
 * modes — the shape the plan's own §2.3 warns about. What the two DO share is everything around the
 * item: the walk is written to the phone before the network is touched, the queue is drained on
 * reconnect, the strip counts what is waiting, and closing is irreversible.
 *
 * So the shell is this composable plus `WalkHeader.vue`, and each body owns its own words. That is
 * D-INV19's "one session component serves parts and units" read as what it can actually mean:
 * `/shop/count/:sessionId` is one route and one component, and it hands off to the body that
 * matches the session's kind.
 *
 * ── THE ORDER OF OPERATIONS IS THE FEATURE ────────────────────────────────────────────────────
 * `commit` writes to IndexedDB, THEN sends. Not "send, and if that works remember it". A bay is
 * where the signal is worst, and the strip's promise is only kept by writing first. Every row
 * carries the movement id its caller minted (D-INV27), so a replay is free at the server.
 */
export function useWalk(sessionId: Ref<string>, kind: QueuedKind) {
  /** How many writes are still on this phone — what the connectivity strip counts down. */
  const queued = ref(0);

  async function refresh() {
    queued.value = (await pending(sessionId.value)).length;
  }

  /**
   * Send what is on this phone, oldest first, stopping at the first failure.
   *
   * The sender is given the whole row because since I9 a queue can hold both ledgers' rows, and
   * only `kind` says which endpoint a payload belongs to. A drain that guessed would replay a unit
   * check into `record_part_movement`.
   */
  async function drain(send: (row: QueuedCount) => Promise<void>) {
    await flush(send);
    await refresh();
  }

  /**
   * Write it down, then try to send it. Returns whether the send succeeded — the caller decides
   * what to say about it, because "Counted 12" and "Found" are different sentences.
   */
  async function commit(
    id: string,
    movement: QueuedCount["movement"],
    send: () => Promise<void>,
  ): Promise<boolean> {
    await enqueue({ id, sessionId: sessionId.value, kind, movement, queuedAt: new Date().toISOString() });
    try {
      await send();
      await dequeue(id);
      await refresh();
      return true;
    } catch {
      // Kept on the phone; the strip says so and the next drain replays it in order.
      await refresh();
      return false;
    }
  }

  /**
   * Drop a queued row that has not been sent — a local retraction, never a reversal of a ledger row.
   * An append-only ledger has no eraser (`IV011`, `IV021`); what is already sent is corrected by
   * recording again.
   */
  async function retract(matches: (row: QueuedCount) => boolean): Promise<void> {
    const rows = await pending(sessionId.value);
    const entry = rows.find(matches);
    if (entry) await dequeue(entry.id);
    await refresh();
  }

  const onOnline = () => void refresh();
  onMounted(() => {
    window.addEventListener("online", onOnline);
    void refresh();
  });
  onBeforeUnmount(() => window.removeEventListener("online", onOnline));

  return { queued, refresh, drain, commit, retract, kindOf };
}
