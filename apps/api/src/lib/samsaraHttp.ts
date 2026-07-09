import type { Env } from "../env.js";

/**
 * Central Samsara HTTP client. EVERY Samsara call (sync, recon, diagnostics) goes through here so a
 * single place enforces:
 *  - **Rate limiting** — a steady per-token cadence (SAMSARA_MAX_RPS) shared across schedulers, recon and
 *    backfill, so a deep re-scoring run can't collectively blow the token's limit and start failing.
 *  - **Resilience** — 429 (honoring Retry-After) and 5xx/network errors are retried with exponential
 *    backoff + jitter, up to SAMSARA_MAX_RETRIES; an exhausted call returns its last response so the
 *    caller throws and the surrounding JOB fails visibly instead of silently returning null.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Per-token pacing: `nextFreeAt[token]` is the earliest wall-clock time the next request may start. Each
// call reserves the following slot, so N concurrent callers on one token are serialized to the cadence.
const nextFreeAt = new Map<string, number>();

function reserveSlot(tokenKey: string, rps: number): number {
  const interval = 1000 / Math.max(0.1, rps);
  const now = Date.now();
  const start = Math.max(now, nextFreeAt.get(tokenKey) ?? 0);
  nextFreeAt.set(tokenKey, start + interval);
  return start - now; // ms to wait before issuing
}

/** Exponential backoff with full jitter, capped. `attempt` is 0-based. Exported for tests. */
export function backoffMs(attempt: number, baseMs = 500, capMs = 15000): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into ms, or null. Exported for tests. */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export interface SamsaraFetchOpts {
  init?: RequestInit;
  /** Retry 429/5xx/network with backoff (default true). Set false for diagnostics that report raw status. */
  retry?: boolean;
  /** Injectable fetch, for tests. */
  fetchImpl?: typeof fetch;
  /**
   * Rate-limit lane. "live" (default) — schedulers, interactive recon; gets the reserved live share.
   * "backfill" — bulk re-sync; gets only the leftover share so it can never starve live traffic.
   */
  priority?: "live" | "backfill";
}

/** Effective per-second cadence for a lane: live gets SAMSARA_LIVE_RPS_FRACTION of the cap, backfill the
 *  rest. The two lanes are paced on SEPARATE slots, so combined they never exceed the cap and live is
 *  always guaranteed its share regardless of backfill load. */
export function laneRps(env: Env, priority: "live" | "backfill"): number {
  const frac = env.SAMSARA_LIVE_RPS_FRACTION ?? 0.6; // default guards partial test envs
  const live = env.SAMSARA_MAX_RPS * frac;
  return Math.max(0.1, priority === "backfill" ? env.SAMSARA_MAX_RPS - live : live);
}

/** Rate-limited, retrying Samsara GET/POST. Adds the Bearer token; returns the final Response. */
export async function samsaraFetch(
  env: Env,
  token: string,
  url: URL | string,
  opts: SamsaraFetchOpts = {},
): Promise<Response> {
  const priority = opts.priority ?? "live";
  const rps = laneRps(env, priority);
  const slotKey = `${token}:${priority}`; // separate pacing slot per lane
  const maxRetries = opts.retry === false ? 0 : env.SAMSARA_MAX_RETRIES;
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${token}`, ...(opts.init?.headers ?? {}) };
  let attempt = 0;
  for (;;) {
    const wait = reserveSlot(slotKey, rps);
    if (wait > 0) await sleep(wait);
    let res: Response;
    try {
      res = await doFetch(url, { ...opts.init, headers });
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      await sleep(backoffMs(attempt++));
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const ra = parseRetryAfter(res.headers.get("retry-after"));
      await sleep(ra ?? backoffMs(attempt));
      attempt++;
      continue;
    }
    return res; // 2xx, a non-retryable 4xx, or an exhausted 429/5xx (caller throws on !ok)
  }
}

/** Test helper — clears per-token pacing state so tests don't leak reserved slots into each other. */
export function __resetSamsaraPacing(): void {
  nextFreeAt.clear();
}
