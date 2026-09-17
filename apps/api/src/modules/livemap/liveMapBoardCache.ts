import type { SupabaseClient } from "@supabase/supabase-js";
import type { LiveMapBoard } from "@silvicom/shared";
import { readLiveMapBoard, type LiveMapBoardOptions } from "./liveMapBoard.js";

/**
 * One board per org per few seconds, however many dispatchers are looking at it (C3,
 * `docs/plans/livemap/LIVE-MAP-CONCURRENCY-PLAN.md`).
 *
 * ── THE COST THIS REMOVES, MEASURED ─────────────────────────────────────────────────────────────
 * `readLiveMapBoard` is five sequential upstream round trips — the `org_module_enabled` RPC, then
 * `vehicle_positions`, `vehicles`, `drivers`, `loads`. Every dispatcher polls it every five seconds,
 * and they all get the SAME answer: thirty dispatchers in one org were measured making **150
 * Supabase round trips per second to answer one question**, and receiving thirty identical 68 KB
 * boards for it.
 *
 * ── WHY A PROMISE IS CACHED AND NOT A VALUE, WHICH IS THE WHOLE TRICK ───────────────────────────
 * Storing the in-flight promise gives two different wins from one line. Callers that arrive while a
 * read is still running **coalesce** onto it rather than starting a second one — which is what
 * protects the database against a synchronised herd, such as thirty browsers resuming when a laptop
 * wakes. Callers that arrive after it settles get the **cached** board until it expires, which is
 * what collapses the steady state. Caching a value would have given only the second.
 *
 * ── WHY THIS IS NOT A STALENESS BUG ─────────────────────────────────────────────────────────────
 * The TTL is deliberately well under the poll interval, AND under the cadence of the data itself:
 * positions arrive from the Samsara tier every 5 s (LM4), so a board held for 2.5 s is never older
 * than the feed's own granularity. A dispatcher's worst case goes from "5 s stale" to "7.5 s stale"
 * in the pathological alignment, against a feed that had nothing newer to give them either way.
 *
 * ⚠ And it stays HONEST rather than merely close enough, because `generatedAt` is baked into the
 * board at generation and travels with it. A cached board reports the instant it was built, not the
 * instant it was served, so every age the client renders off it — `ageSeconds`, the fuel clock,
 * the rail's freshness line — is computed against the right moment. This is D-LM10's rule (one
 * clock, server-side) doing exactly the job it was written for.
 *
 * ⚠⚠ THE CACHE IS KEYED BY ORG, AND THAT IS A TENANCY BOUNDARY, NOT A PERFORMANCE DETAIL. The API
 * reads with the service role, which BYPASSES RLS — so an entry keyed carelessly (by nothing, by
 * user, by "the last board") would serve one carrier another carrier's trucks, and no database
 * policy would stop it. `expectOrgScoped` proves the underlying reads are scoped; the matrix in this
 * module's test proves the cache in front of them cannot cross the same line.
 *
 * ⚠ The cached board is SHARED BETWEEN CALLERS and must be treated as immutable. Today's only
 * consumer serialises it and sends it, which is why it is not cloned — cloning 171 vehicles per
 * request would spend most of what the cache saves. A future caller that wants to modify a board
 * must copy it first.
 */

/**
 * How long a board may be served after it was built.
 *
 * 2 500 ms is half the 5 s poll and half the position feed's own cadence, so it is bounded by the
 * thing that actually limits freshness rather than by a number somebody liked. It is NOT derived
 * from `LIVE_MAP_POLL_MS`: the poll is a client's choice and lives in the web bundle, while this
 * bounds how stale the SERVER is willing to be, and tying them would make a client edit silently
 * change a server guarantee.
 */
export const BOARD_CACHE_TTL_MS = 2_500;

interface Entry {
  /** When the read STARTED — so a slow read cannot extend its own life past the TTL. */
  startedAtMs: number;
  board: Promise<LiveMapBoard>;
}

const entries = new Map<string, Entry>();

export interface CachedBoardOptions extends LiveMapBoardOptions {
  /** Injected by tests. Production reads the monotonic-enough wall clock once, here. */
  nowMs?: number;
}

export async function readLiveMapBoardCached(
  admin: SupabaseClient,
  orgId: string,
  opts: CachedBoardOptions = {},
): Promise<LiveMapBoard> {
  const nowMs = opts.nowMs ?? Date.now();
  const hit = entries.get(orgId);
  if (hit && nowMs - hit.startedAtMs < BOARD_CACHE_TTL_MS) return hit.board;

  const { nowMs: _ignored, ...readOpts } = opts;
  const board = readLiveMapBoard(admin, orgId, readOpts);
  const entry: Entry = { startedAtMs: nowMs, board };
  entries.set(orgId, entry);

  /**
   * ⚠ A FAILED READ IS NOT CACHED, and this is the half that is easy to leave out. Without it a
   * single upstream blip would be replayed to every dispatcher in the org for the next 2.5 seconds —
   * one transient error amplified into a board-wide outage, which is worse than the un-cached
   * behaviour it replaced. The identity check matters too: a newer entry may already have taken this
   * org's slot by the time a slow failure lands, and deleting blindly would evict a healthy board.
   */
  board.catch(() => {
    if (entries.get(orgId) === entry) entries.delete(orgId);
  });

  return board;
}

/**
 * Drop everything. For tests only — production entries age out on their own.
 *
 * Exported because the cache is module state: without it one test's board would be served to the
 * next test's assertions, which is the kind of cross-test bleed that reads as a flake.
 */
export function __resetLiveMapBoardCache(): void {
  entries.clear();
}
