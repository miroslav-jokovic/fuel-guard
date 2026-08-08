/**
 * Driver write rate limits and daily business caps — D57 / D-L5. PURE, so the API that enforces them
 * and the driver app that explains them read one table and cannot drift.
 *
 * KEYED ON THE JWT `sub`, NEVER ON IP. Drivers share a carrier's NAT: an IP limit throttles a whole
 * yard the moment one phone retries in a loop, which reads to every driver in that yard as "the app
 * is broken". This is the single most important property of the design and the reason D32's
 * predecessor was re-locked.
 *
 * TWO LIMITS, TWO MEANINGS, TWO CODES. The per-minute limit is a burst guard — "slow down, try again
 * in a moment". The daily cap is a business statement — "that is the maximum for today, talk to
 * dispatch". Collapsing them into one 429 would make the app tell a driver to wait a moment for
 * something that will not clear for nine hours.
 *
 * The numbers are ~10× realistic driver behaviour: generous enough that no honest driver meets them,
 * tight enough that a runaway retry loop or a stolen token stops mattering quickly.
 */

export const DRIVER_WRITE_BUCKETS = ["shift", "load_action", "stop_capture", "message"] as const;
export type DriverWriteBucket = (typeof DRIVER_WRITE_BUCKETS)[number];

export interface DriverWriteLimit {
  perMinute: number;
  perDay: number;
  /** Used in the driver-facing sentence: "You've hit today's maximum for stop updates." */
  label: string;
}

export const DRIVER_WRITE_LIMITS: Record<DriverWriteBucket, DriverWriteLimit> = {
  // A real driver checks in once and swaps equipment a handful of times.
  shift: { perMinute: 10, perDay: 60, label: "shift changes" },
  // Accept / decline / start, across every load offered in a day.
  load_action: { perMinute: 20, perDay: 200, label: "load actions" },
  // A multi-stop run with photo retakes is legitimately chatty.
  stop_capture: { perMinute: 30, perDay: 500, label: "stop updates" },
  message: { perMinute: 20, perDay: 300, label: "messages" },
};

/** Too fast. Transient by definition — the window reopens within a minute. */
export const RATE_LIMITED_CODE = "rate_limited";
/** Today's business maximum. Also transient, but on the scale of hours, not seconds. */
export const DAILY_CAP_CODE = "daily_cap_reached";

/**
 * Which bucket a request belongs to, or null when it is not a driver write at all.
 *
 * Matched on the full pathname rather than a router mount point so that adding a route cannot
 * silently escape the limiter by being mounted somewhere unexpected — the cost is that this function
 * has to be kept in step with the routes, which is what its test is for.
 *
 * `/api/me/hazmat/*` is deliberately absent: D57 did not size it, and inventing a number here would
 * be worse than the honest gap. It stays under the blanket `apiLimiter` until it has its own.
 */
const PATTERNS: ReadonlyArray<{ bucket: DriverWriteBucket; re: RegExp }> = [
  { bucket: "shift", re: /^\/api\/me\/shift\/(start|equipment|end)\/?$/ },
  { bucket: "load_action", re: /^\/api\/me\/loads\/[^/]+\/(accept|decline|start)\/?$/ },
  { bucket: "stop_capture", re: /^\/api\/me\/loads\/[^/]+\/stops\/[^/]+\/?$/ },
  // Both message writes: opening a thread and sending into one.
  { bucket: "message", re: /^\/api\/messages\/?$/ },
  { bucket: "message", re: /^\/api\/messages\/[^/]+\/messages\/?$/ },
];

export function driverWriteBucket(method: string, pathname: string): DriverWriteBucket | null {
  if (method.toUpperCase() !== "POST") return null;
  // Query strings and duplicate slashes must not let a request slip past the match.
  const path = pathname.split("?")[0]!.replace(/\/{2,}/g, "/");
  return PATTERNS.find((p) => p.re.test(path))?.bucket ?? null;
}

// ── the per-minute window (pure, so the arithmetic is testable without a clock) ────────────────────

export const RATE_WINDOW_MS = 60_000;

export interface WindowState {
  /** Start of the current fixed window, in ms. */
  windowStartMs: number;
  count: number;
}

export interface WindowVerdict {
  allowed: boolean;
  state: WindowState;
  /** Seconds until the window reopens — the `Retry-After` value. Always ≥ 1. */
  retryAfterSec: number;
}

/**
 * Fixed window rather than a sliding log: a driver's phone does not need per-request fairness, and a
 * fixed window costs one integer per key instead of an array that grows with traffic. The worst case
 * — 2× the limit across a window boundary — is irrelevant at these numbers.
 */
export function hitWindow(
  prior: WindowState | undefined, limit: number, nowMs: number,
): WindowVerdict {
  const windowStartMs = prior && nowMs - prior.windowStartMs < RATE_WINDOW_MS ? prior.windowStartMs : nowMs;
  const count = (windowStartMs === prior?.windowStartMs ? prior.count : 0) + 1;
  const retryAfterSec = Math.max(1, Math.ceil((windowStartMs + RATE_WINDOW_MS - nowMs) / 1000));
  return { allowed: count <= limit, state: { windowStartMs, count }, retryAfterSec };
}

/** Seconds until the daily counter resets. The server's day is UTC — stated, not assumed. */
export function secondsUntilUtcMidnight(nowMs: number): number {
  const next = Date.UTC(
    new Date(nowMs).getUTCFullYear(),
    new Date(nowMs).getUTCMonth(),
    new Date(nowMs).getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((next - nowMs) / 1000));
}
