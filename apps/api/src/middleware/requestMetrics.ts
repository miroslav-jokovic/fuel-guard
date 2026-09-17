import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * What this process is actually serving (C7, `docs/plans/livemap/LIVE-MAP-CONCURRENCY-PLAN.md`).
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────────────────────────
 * Measured 2026-09-17: this API had **no request logging of any kind** — no `morgan`, no `pino`, no
 * hand-rolled middleware, no logging dependency — so both Railway services returned zero log lines
 * for every route. There was no p95, no request rate, no count of refusals. `Q-LM21` was recorded as
 * *blocked* for exactly this reason: the question "how often is this route called in production" had
 * no answer that did not require a deploy.
 *
 * Three performance changes then shipped on one afternoon (C1 the per-caller budget, C2 compression,
 * C3 the board cache) and **none of them could be observed working in production**. That is the
 * actual cost of this gap, and it is why this is a summary rather than a dashboard: the point is to
 * be able to read a number at all.
 *
 * ── WHY IT AGGREGATES INSTEAD OF LOGGING EACH REQUEST ───────────────────────────────────────────
 * ⚠ A line per request is the obvious shape and it is the wrong one here. The basemap tile proxy
 * serves dozens of requests per dispatcher per camera move; at the 30 dispatchers C1 exists to
 * support, per-request logging would emit tens of thousands of lines an hour to answer a question
 * that is really about distributions. So requests are folded into a rolling window in memory and ONE
 * line is emitted per interval. The plan's constraint was "must not cost a log line per tile"; this
 * costs a log line per minute, whatever the traffic.
 *
 * ── AND WHY THERE IS NOTHING IDENTIFYING IN IT ──────────────────────────────────────────────────
 * ⚠⚠ The repo's rule is never to log PII, and a request path is full of it by default. So:
 * **the query string is dropped entirely** (it carries search terms, emails and filters), **every
 * id-shaped path segment is replaced** before it is used as a key, and **no user, org, token or
 * address is recorded at any point**. What survives is a route SHAPE and a duration. There is
 * deliberately no way to ask this module what one person did — it cannot answer, by construction.
 */

/** Percentile latencies and counts for one window. */
export interface RequestMetricsSnapshot {
  windowMs: number;
  requests: number;
  statusClasses: Record<string, number>;
  refused429: number;
  serverErrors5xx: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Busiest routes, and the slowest — the two questions a summary is read for. */
  byRoute: Array<{ route: string; count: number; p95: number; max: number }>;
  distinctRoutes: number;
}

/**
 * How many distinct route shapes are tracked before the rest are folded into one bucket.
 *
 * ⚠ A cardinality guard, not a tuning knob. Without it, anything probing random URLs — a scanner, a
 * broken client, a crawler on the SPA fallback — would mint an unbounded number of map keys inside a
 * long-lived process, which is a memory leak that only appears under the traffic you least want to
 * fall over in. The normaliser below collapses most of that; this catches what it does not.
 */
const MAX_TRACKED_ROUTES = 200;

/** Durations kept per route for percentiles. Bounded, because a busy route must not grow forever. */
const SAMPLES_PER_ROUTE = 128;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turn a concrete request path into a route SHAPE safe to use as a metrics key.
 *
 * Exported because it is the part with the rules in it, and rules that are not tested drift. The two
 * jobs are inseparable: collapsing ids is what bounds cardinality AND what keeps identifiers out of
 * the logs, so one function does both rather than leaving either to a caller's discipline.
 */
export function normalizeRoutePath(rawPath: string): string {
  // The query string never reaches a key. It is the part most likely to carry a person in it.
  const path = (rawPath.split("?")[0] ?? "").split("#")[0] ?? "";
  if (!path.startsWith("/api")) {
    // The SPA and its hashed assets. Counted, so the volume is visible, but not enumerated — asset
    // filenames carry a build hash each and would be a new key per deploy.
    return path === "/healthz" ? "/healthz" : "<non-api>";
  }
  const segments = path.split("/").filter(Boolean).map((segment) => {
    if (UUID.test(segment)) return ":id";
    if (/^\d+$/.test(segment)) return ":n";
    // Opaque credentials and long tokens travel in paths too (invite links, public applications).
    if (segment.length >= 24) return ":id";
    return segment;
  });
  // Depth cap: a recursive or generated path cannot invent new keys past this point.
  const capped = segments.length > 8 ? [...segments.slice(0, 8), "…"] : segments;
  return `/${capped.join("/")}`;
}

interface RouteBucket {
  count: number;
  max: number;
  samples: number[];
  /** Where the next sample goes once the reservoir is full — plain round-robin, not random. */
  cursor: number;
}

interface Window {
  startedAtMs: number;
  requests: number;
  statusClasses: Map<string, number>;
  refused429: number;
  serverErrors5xx: number;
  routes: Map<string, RouteBucket>;
  overflowRoutes: number;
}

function emptyWindow(nowMs: number): Window {
  return {
    startedAtMs: nowMs,
    requests: 0,
    statusClasses: new Map(),
    refused429: 0,
    serverErrors5xx: 0,
    routes: new Map(),
    overflowRoutes: 0,
  };
}

let current = emptyWindow(Date.now());

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return Math.round(sorted[index]!);
}

function record(route: string, status: number, durationMs: number, nowMs: number): void {
  current.requests += 1;
  const cls = `${Math.floor(status / 100)}xx`;
  current.statusClasses.set(cls, (current.statusClasses.get(cls) ?? 0) + 1);
  if (status === 429) current.refused429 += 1;
  if (status >= 500) current.serverErrors5xx += 1;

  let key = route;
  if (!current.routes.has(key) && current.routes.size >= MAX_TRACKED_ROUTES) {
    key = "<other>";
    current.overflowRoutes += 1;
  }
  let bucket = current.routes.get(key);
  if (!bucket) {
    bucket = { count: 0, max: 0, samples: [], cursor: 0 };
    current.routes.set(key, bucket);
  }
  bucket.count += 1;
  if (durationMs > bucket.max) bucket.max = durationMs;
  if (bucket.samples.length < SAMPLES_PER_ROUTE) bucket.samples.push(durationMs);
  else {
    bucket.samples[bucket.cursor] = durationMs;
    bucket.cursor = (bucket.cursor + 1) % SAMPLES_PER_ROUTE;
  }
  void nowMs;
}

/**
 * Record every request's shape, status and duration.
 *
 * ⚠ MOUNT IT ABOVE THE RATE LIMITERS. `res.on("finish")` fires whoever wrote the response, so this
 * would still work lower down — but a limiter that refuses a request answers it and returns, so a
 * metrics middleware mounted BELOW one would count zero of the refusals. Counting 429s is most of
 * why this exists: C1 shipped because nobody could see them.
 */
export function requestMetrics(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      record(`${req.method} ${normalizeRoutePath(req.originalUrl || req.url)}`, res.statusCode, durationMs, Date.now());
    });
    next();
  };
}

/** Read the current window without disturbing it. */
export function snapshotRequestMetrics(nowMs: number = Date.now()): RequestMetricsSnapshot {
  const byRoute = [...current.routes.entries()]
    .map(([route, b]) => {
      const sorted = [...b.samples].sort((x, y) => x - y);
      return { route, count: b.count, p95: percentile(sorted, 95), max: Math.round(b.max) };
    })
    .sort((a, b) => b.count - a.count);

  const all = [...current.routes.values()].flatMap((b) => b.samples).sort((x, y) => x - y);
  return {
    windowMs: nowMs - current.startedAtMs,
    requests: current.requests,
    statusClasses: Object.fromEntries(current.statusClasses),
    refused429: current.refused429,
    serverErrors5xx: current.serverErrors5xx,
    p50: percentile(all, 50),
    p95: percentile(all, 95),
    p99: percentile(all, 99),
    max: all.length ? Math.round(all[all.length - 1]!) : 0,
    byRoute,
    distinctRoutes: current.routes.size,
  };
}

export function resetRequestMetrics(nowMs: number = Date.now()): void {
  current = emptyWindow(nowMs);
}

/** One line, so it can be grepped out of Railway's log stream without a log platform. */
export function formatMetricsLine(s: RequestMetricsSnapshot): string {
  return `[metrics] ${JSON.stringify({
    windowSec: Math.round(s.windowMs / 1000),
    requests: s.requests,
    rps: s.windowMs > 0 ? +(s.requests / (s.windowMs / 1000)).toFixed(2) : 0,
    status: s.statusClasses,
    refused429: s.refused429,
    errors5xx: s.serverErrors5xx,
    latencyMs: { p50: s.p50, p95: s.p95, p99: s.p99, max: s.max },
    distinctRoutes: s.distinctRoutes,
    busiest: s.byRoute.slice(0, 5),
    slowest: [...s.byRoute].sort((a, b) => b.p95 - a.p95).slice(0, 3),
  })}`;
}

export const METRICS_REPORT_INTERVAL_MS = 60_000;

/**
 * Start the periodic summary.
 *
 * ── ⚠ THIS IS NOT A SCHEDULER, AND THE DISTINCTION IS THE ONE `docs/WORKER-DEPLOYMENT.md` DRAWS ──
 * That document governs background work that must run in exactly ONE process fleet-wide — the
 * Samsara sync, the digest, the nightly reconcile — because two processes doing it means duplicated
 * writes, and `RUN_SCHEDULERS_IN_PROCESS` defaulting to `true` is how `@fleetguard/web` ran the whole
 * set alongside `@fleetguard/api` unnoticed.
 *
 * This is the opposite case on every count. It writes nothing, reads no shared state, coordinates
 * with nobody, and reports only what the process it lives in has served — so it MUST run in every
 * process, and two services reporting separately is the correct behaviour rather than the bug. It
 * needs no env flag, and giving it one would create exactly the silent-default trap that document
 * exists to warn about.
 *
 * ⚠ `unref()` so a process with nothing else to do can still exit. Without it this timer would hold
 * the event loop open forever and every test that builds an app would hang on teardown.
 */
export function startRequestMetricsReporter(
  intervalMs: number = METRICS_REPORT_INTERVAL_MS,
  log: (line: string) => void = console.log,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    const snapshot = snapshotRequestMetrics();
    // A window nobody touched is not worth a line. An idle service should be quiet, not repetitive.
    if (snapshot.requests > 0) log(formatMetricsLine(snapshot));
    resetRequestMetrics();
  }, intervalMs);
  timer.unref();
  return timer;
}
