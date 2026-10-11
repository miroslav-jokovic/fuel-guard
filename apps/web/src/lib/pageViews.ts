import { PAGE_VIEW_BATCH_MAX, pageViewKeyFor } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The browser half of the page-view count (X1, 0435). The router's `afterEach` calls `recordPageView`
 * with the DECLARED path of the screen it landed on; the key goes into a queue, and the queue goes to
 * `POST /api/page-views` once a minute, when the tab is hidden, or when it reaches a full batch.
 *
 * Only the catalogue key is queued — never the path, the query string or who is looking (the contract
 * in `packages/shared/src/pageViewsContract.ts` says why).
 *
 * ── WHAT IT DOES NOT TRY TO BE ──────────────────────────────────────────────────────────────────
 * A count good enough to say "nobody opened Recall audit this month", not an exact ledger:
 *   • a failed send is dropped, not retried. A retry after a timeout that the server actually saved
 *     would count twice, and an over-count is the worse error for a keep/hide decision;
 *   • a tab closed within a minute of its last flush can lose those views. Hiding the tab flushes, and
 *     closing it usually hides it first, but `apiFetch` has no `keepalive`, so a send started during
 *     unload may not finish. Widening `apiFetch` for this was not worth it.
 */
const FLUSH_EVERY_MS = 60_000;

let queue: string[] = [];
let sending: Promise<void> | null = null;
let started = false;

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.setInterval(() => void flushPageViews(), FLUSH_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPageViews();
  });
}

/** Queue one view of the screen at this declared route path. A path that is not a screen counts nothing. */
export function recordPageView(declaredPath: string): void {
  const key = pageViewKeyFor(declaredPath);
  if (!key) return;
  start();
  queue.push(key);
  if (queue.length >= PAGE_VIEW_BATCH_MAX) void flushPageViews();
}

/** Send what is queued, at most one batch in flight. Never throws: a count must not break a page. */
export async function flushPageViews(): Promise<void> {
  if (sending || queue.length === 0) return sending ?? undefined;
  const batch = queue.slice(0, PAGE_VIEW_BATCH_MAX);
  queue = queue.slice(batch.length);
  sending = (async () => {
    try {
      await apiFetch("/api/page-views", { method: "POST", body: { keys: batch } });
    } catch {
      /* dropped on purpose — see the header */
    } finally {
      sending = null;
    }
  })();
  return sending;
}

/** Test seam: the queue is module state, so each test starts from empty. */
export function resetPageViewsForTest(): void {
  queue = [];
  sending = null;
}
