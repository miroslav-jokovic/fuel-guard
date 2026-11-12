/**
 * How fast this process asks HERE for map tiles, and in what order (D-DR30).
 *
 * ── THE DEFECT, MEASURED (2026-11-10) ────────────────────────────────────────────────────────────
 * HERE limits our key per second and does not publish the number. A burst of 40 simulated
 * dispatchers zooming at once (each at the browser's 32 parallel requests, D-DR28) sent the proxy
 * ~200 tiles a second, and HERE answered `429 "Rate limit for this service has been reached"` to
 * 17–21% of them in two of three runs. The proxy turned each one into a 502, so the reader got a
 * blank square that maplibre does not ask for again until the camera moves. The same burst sent
 * straight to HERE was refused 34% of the time at ~400 a second. So the limit is real, and it is the
 * key's, not this server's.
 *
 * The realistic shape is not 40 people zooming in the same second. It is shift start: 40 people
 * opening the map within a few seconds, ~60 tiles each, ~2 400 tiles at once.
 *
 * ── WHAT THIS DOES ───────────────────────────────────────────────────────────────────────────────
 * A token bucket in front of HERE: up to `burst` tiles go at once, then `ratePerSecond`. A tile over
 * the rate WAITS here instead of being refused there. Two properties come with the queue, and both
 * were chosen rather than inherited:
 *
 *   - **Fair between callers.** Waiting tiles are queued per caller and released round-robin, so one
 *     dispatcher's 400-tile zoom cannot hold the other 39 behind it. A plain FIFO would.
 *   - **A tile the reader stopped wanting is never sent.** maplibre cancels the tiles a zoom flew
 *     past. In the staging walk that was 170 of 408 requests. A cancelled tile still in this queue
 *     is dropped before it reaches HERE, so it is neither billed nor counted against the limit.
 *
 * ⚠ It is PER PROCESS. Production runs `API_REPLICAS=2` (infra/server/production.env), so the fleet
 * rate is twice the number below. Staging runs one. A shared limiter would need Redis or the
 * database, and a tile is the cheapest, most re-issuable request this app makes. That is not worth
 * a network round trip per tile.
 */

export interface TilePacerOptions {
  /** Tiles per second this process may start against HERE once the burst is spent. */
  ratePerSecond: number;
  /** Tiles that may start at once from a full bucket. */
  burst: number;
  /** Longest a tile may wait for its turn before the caller is told to try again. */
  maxWaitMs: number;
  /** Most tiles this process holds waiting, across every caller. */
  maxQueued: number;
}

/**
 * Sized from the burst above until HERE tells us our real limit (Q-DR30).
 *
 * **Rate.** HERE started refusing at ~200 tiles a second. Two replicas at 80 is 160 fleet-wide,
 * under every refusal measured. The burst of 100 covers one dispatcher's whole first view (~60
 * tiles) and one deep zoom step without waiting at all.
 *
 * **Wait.** ⚠ The first draft let a tile wait 6 s, and the rig showed that was the wrong trade. With
 * HERE stood in at 200 a second and 40 readers opening the map at once (2 400 tiles), 1 234 of them
 * were answered "busy" after 6 s. A busy tile is a blank square, exactly what the queue exists to
 * prevent. Draining 2 400 tiles at 160 a second takes ~15 s, so a tile may wait 20 s: the reader
 * sees the map fill in instead of holes in it. A tile the reader pans away from is cancelled and
 * leaves the queue at once, so a long wait is never spent on a tile nobody wants.
 *
 * **Queue.** 4 000 per process: the whole shift-start case with room. Past that the answer is busy,
 * so a flood still cannot grow this process without bound.
 */
export const HERE_TILE_PACING: TilePacerOptions = {
  ratePerSecond: 80,
  burst: 100,
  maxWaitMs: 20_000,
  maxQueued: 4_000,
};

/** What `acquire` answers: send it, the queue is full or too slow, or the caller left first. */
export type TileTurn = "go" | "busy" | "gone";

export interface TilePacerCounts {
  /** Tiles sent at once, from the bucket. */
  immediate: number;
  /** Tiles that waited, then were sent. */
  queued: number;
  /** Longest wait of a tile that was sent, in ms. */
  maxWaitMs: number;
  /** Tiles answered "busy": queue full, or waited past `maxWaitMs`. */
  busy: number;
  /** Tiles the reader cancelled while queued, never sent to HERE. */
  abandoned: number;
}

interface Waiter {
  key: string;
  since: number;
  resolve: (turn: TileTurn) => void;
  timer: NodeJS.Timeout;
  onAbort: () => void;
  signal: AbortSignal;
}

export class TilePacer {
  private tokens: number;
  private last: number;
  /** Waiting tiles per caller; `order` is the round-robin ring of callers with something waiting. */
  private readonly queues = new Map<string, Waiter[]>();
  private readonly order: string[] = [];
  private size = 0;
  private drainTimer: NodeJS.Timeout | null = null;
  private counts: TilePacerCounts = TilePacer.zero();

  constructor(
    private readonly opts: TilePacerOptions,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = opts.burst;
    this.last = now();
  }

  private static zero(): TilePacerCounts {
    return { immediate: 0, queued: 0, maxWaitMs: 0, busy: 0, abandoned: 0 };
  }

  /** The counts since the last call, then cleared. One reader: the per-minute `[metrics]` line. */
  drainCounts(): TilePacerCounts {
    const c = this.counts;
    this.counts = TilePacer.zero();
    return c;
  }

  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.opts.burst, this.tokens + ((t - this.last) / 1000) * this.opts.ratePerSecond);
    this.last = t;
  }

  /**
   * Wait for this caller's turn to send one tile to HERE.
   *
   * ⚠ A caller with nothing queued goes straight to the bucket. Only when the bucket is empty, or
   * other callers are already waiting, does a tile join the queue. Jumping ahead of waiting tiles
   * because a token happened to free up would break the fairness the queue exists for.
   */
  acquire(key: string, signal: AbortSignal): Promise<TileTurn> {
    if (signal.aborted) return Promise.resolve("gone");
    this.refill();
    if (this.size === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      this.counts.immediate += 1;
      return Promise.resolve("go");
    }
    if (this.size >= this.opts.maxQueued) {
      this.counts.busy += 1;
      return Promise.resolve("busy");
    }
    return new Promise<TileTurn>((resolve) => {
      const waiter: Waiter = {
        key,
        since: this.now(),
        resolve,
        signal,
        timer: setTimeout(() => this.leave(waiter, "busy"), this.opts.maxWaitMs),
        onAbort: () => this.leave(waiter, "gone"),
      };
      waiter.timer.unref?.();
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      let q = this.queues.get(key);
      if (!q) {
        q = [];
        this.queues.set(key, q);
        this.order.push(key);
      }
      q.push(waiter);
      this.size += 1;
      this.schedule();
    });
  }

  /** Take a waiter out without sending it: it waited too long, or its reader went away. */
  private leave(w: Waiter, turn: "busy" | "gone"): void {
    const q = this.queues.get(w.key);
    const i = q?.indexOf(w) ?? -1;
    if (!q || i < 0) return;
    q.splice(i, 1);
    this.size -= 1;
    if (q.length === 0) this.dropKey(w.key);
    clearTimeout(w.timer);
    w.signal.removeEventListener("abort", w.onAbort);
    if (turn === "busy") this.counts.busy += 1;
    else this.counts.abandoned += 1;
    w.resolve(turn);
  }

  private dropKey(key: string): void {
    this.queues.delete(key);
    const at = this.order.indexOf(key);
    if (at >= 0) this.order.splice(at, 1);
  }

  /** Release as many waiting tiles as the bucket allows, one caller at a time, then re-arm. */
  private drain = (): void => {
    this.drainTimer = null;
    this.refill();
    while (this.size > 0 && this.tokens >= 1) {
      const key = this.order.shift()!;
      const q = this.queues.get(key)!;
      const w = q.shift()!;
      this.size -= 1;
      if (q.length === 0) this.queues.delete(key);
      else this.order.push(key);
      clearTimeout(w.timer);
      w.signal.removeEventListener("abort", w.onAbort);
      this.tokens -= 1;
      this.counts.queued += 1;
      this.counts.maxWaitMs = Math.max(this.counts.maxWaitMs, this.now() - w.since);
      w.resolve("go");
    }
    this.schedule();
  };

  private schedule(): void {
    if (this.drainTimer || this.size === 0) return;
    const needMs = Math.max(1, Math.ceil(((1 - this.tokens) / this.opts.ratePerSecond) * 1000));
    this.drainTimer = setTimeout(this.drain, needMs);
    this.drainTimer.unref?.();
  }
}
