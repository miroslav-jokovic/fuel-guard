/**
 * The Meta Graph client (ADS-AGENT-BUILD-WORKFLOW.md B1a). Every Meta call the ads module makes goes
 * through `MetaGraph`: the adapters (B2–B5), the connection test (B1b), and — pointed at FakeMeta behind
 * `simulatorGate` — the simulator platform, so the code the simulator exercises is the code production runs.
 *
 * ── WHAT IT DECIDES, FROM META'S OWN PAGES (read 2026-11-02) ─────────────────────────────────────
 *   · The version, in ONE constant. v26.0, introduced 2026-07-29 (the changelog lists v25.0 available
 *     until 2028-07-29). FakeMeta answers only this version, so a bump here that the fake does not
 *     follow fails every contract test. https://developers.facebook.com/docs/graph-api/changelog
 *   · How each error is handled, from the error-handling page's table:
 *       1, 2 (API Unknown / Service) — "wait and retry"            → `transient`, retried
 *       4, 17, 341, 613, 80000–80014 (throttling)                   → `rate_limited`, NOT retried
 *       190, 102 (token)                                            → `token_invalid`
 *       3, 10, 200–299 (permission)                                 → `permission_denied`
 *       368 (blocked for policy)                                    → `policy_blocked`
 *       anything else                                               → `invalid_request` (`meta_<code>`)
 *     https://developers.facebook.com/docs/graph-api/guides/error-handling/
 *   · Throttling: `X-Business-Use-Case-Usage` is read on EVERY answer, and its
 *     `estimated_time_to_regain_access` (minutes) is obeyed. Once a throttle is reached, this
 *     connection's calls are refused HERE until the regain time, without asking Meta. Hammering a
 *     throttled ad account lengthens the block, and the block is on the carrier's own account.
 *     https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
 *
 * ── RETRIES: ONLY WHERE A SECOND CALL CANNOT DO A SECOND THING ───────────────────────────────────
 * A read is retried on a transient error or a timeout. A write is retried only when the caller says it is
 * idempotent: a status or budget update sets a value, so twice is once. A create is NOT idempotent at
 * Meta, which takes no idempotency key. A create that timed out or answered 5xx may have happened (FakeMeta's
 * `applied_then_temporary`), so it comes back `outcome_unknown: true` and is never re-sent here. The
 * publisher (B2) resumes it by reading what exists. A blind retry is how a carrier ends up with two
 * live campaigns.
 *
 * ── THE TOKEN ────────────────────────────────────────────────────────────────────────────────────
 * Sent as `Authorization: Bearer`, never as `access_token=` in a URL, where proxies and request logs keep
 * it. It is also scrubbed from every message a failure carries, in case Meta echoes it.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────────────────────────
 * It writes no `ads_actions` row. A read is not an act, and an act's row belongs to the code that decides
 * it — the guard, the runner's pause, the connection test — so the row records why, not only what.
 * Nor does it send `appsecret_proof`: that needs our Meta app's secret, which is Stage 2 (owner track
 * "Meta ready").
 */

export const META_GRAPH_VERSION = "v26.0";
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export type GraphFailureKind =
  | "transient"
  | "rate_limited"
  | "token_invalid"
  | "permission_denied"
  | "policy_blocked"
  | "invalid_request"
  | "timeout"
  | "network";

export interface GraphFailure {
  kind: GraphFailureKind;
  /** What the ledger and `last_error` carry: `rate_limited`, `token_invalid`, `meta_100`, `timeout`… */
  error_code: string;
  http: number | null;
  code: number | null;
  subcode: number | null;
  fbtrace_id: string | null;
  /** Meta's message, with the token scrubbed out. */
  message: string;
  /** When Meta says how long to wait (throttling), in ms. */
  retry_after_ms: number | null;
  /** A write that may have happened at Meta although we got no success: the caller must read, not re-send. */
  outcome_unknown: boolean;
  attempts: number;
}

export interface UsageReading {
  /** The highest of call_count, total_cputime and total_time across the header's entries, in percent. */
  peak_pct: number;
  regain_minutes: number;
}

export type GraphResult<T> = { ok: true; data: T; usage: UsageReading | null; attempts: number } | { ok: false; error: GraphFailure };

export interface MetaGraphOptions {
  token: string;
  /** One key per connection, so one carrier's throttle never blocks another's. */
  throttleKey: string;
  /** The real Graph by default; FakeMeta's base on the simulator and in tests. */
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Extra attempts after the first, for calls that may be retried. */
  retries?: number;
}

type Params = Record<string, string | number | boolean | readonly unknown[] | Record<string, unknown> | null | undefined>;

const THROTTLE_CODES = new Set([4, 17, 341, 613]);
const DEFAULT_REGAIN_MINUTES = 5;
const BACKOFF_MS = [1_000, 4_000];

/** Throttled-until instants by connection, shared by every client of one process (a client is made per call site). */
const blockedUntil = new Map<string, number>();

/** For tests only: forget every throttle this process recorded. */
export function resetGraphThrottles(): void {
  blockedUntil.clear();
}

export class MetaGraph {
  private readonly o: Required<Omit<MetaGraphOptions, "fetch">> & { fetch: typeof fetch };

  constructor(opts: MetaGraphOptions) {
    if (!opts.token) throw new Error("MetaGraph: no token");
    this.o = {
      baseUrl: META_GRAPH_BASE,
      fetch: globalThis.fetch,
      now: () => new Date(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      timeoutMs: 30_000,
      retries: BACKOFF_MS.length,
      ...opts,
    };
  }

  get<T>(path: string, params: Params = {}): Promise<GraphResult<T>> {
    return this.call<T>("GET", path, params, true);
  }

  /**
   * The same client — base URL, throttle key, clock — holding another token (B4b: the connection test
   * subscribes the Page with the Page token `me/accounts` just handed out). Shares the throttle on purpose:
   * one connection, one budget.
   */
  withToken(token: string): MetaGraph {
    return new MetaGraph({ ...this.o, token });
  }

  /** `idempotent: true` only for a write that sets a value (status, budget); never for a create. */
  post<T>(path: string, params: Params, opts: { idempotent: boolean }): Promise<GraphResult<T>> {
    return this.call<T>("POST", path, params, opts.idempotent);
  }

  private async call<T>(method: "GET" | "POST", path: string, params: Params, retryable: boolean): Promise<GraphResult<T>> {
    const until = blockedUntil.get(this.o.throttleKey) ?? 0;
    const now = this.o.now().getTime();
    if (until > now) return { ok: false, error: this.local(until - now) };

    for (let attempt = 1; ; attempt += 1) {
      const outcome = await this.once<T>(method, path, params);
      if (outcome.ok) return { ...outcome, attempts: attempt };
      const failure = { ...outcome.error, attempts: attempt };
      const sent = method === "POST" && !retryable;
      // A write whose answer we lost — a timeout, a dropped socket, a 5xx — may have happened.
      if (sent && (failure.kind === "transient" || failure.kind === "timeout" || failure.kind === "network")) failure.outcome_unknown = true;
      const canRetry = retryable && (failure.kind === "transient" || failure.kind === "timeout" || failure.kind === "network");
      if (!canRetry || attempt > this.o.retries) return { ok: false, error: failure };
      await this.o.sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]!);
    }
  }

  private async once<T>(method: "GET" | "POST", path: string, params: Params): Promise<{ ok: true; data: T; usage: UsageReading | null } | { ok: false; error: GraphFailure }> {
    const url = new URL(`${this.o.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`);
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      if (method === "GET") url.searchParams.set(k, s);
      else form.set(k, s);
    }
    let res: Response;
    try {
      res = await this.o.fetch(url, {
        method,
        headers: { authorization: `Bearer ${this.o.token}`, ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
        body: method === "POST" ? form.toString() : undefined,
        signal: AbortSignal.timeout(this.o.timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return { ok: false, error: failure(timedOut ? "timeout" : "network", timedOut ? "timeout" : "network", null, this.scrub(err instanceof Error ? err.message : String(err))) };
    }

    const usage = readUsage(res.headers.get("x-business-use-case-usage"));
    if (usage && (usage.regain_minutes > 0 || usage.peak_pct >= 100)) this.block(usage.regain_minutes || DEFAULT_REGAIN_MINUTES);

    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const err = (body as { error?: { code?: unknown; error_subcode?: unknown; message?: unknown; fbtrace_id?: unknown } } | null)?.error;
    if (res.ok && !err) return { ok: true, data: body as T, usage };

    if (!err) {
      // Not Graph's envelope: a proxy's HTML page, an empty 502. A 5xx is Meta's side; a 4xx is ours.
      return { ok: false, error: failure(res.status >= 500 ? "transient" : "invalid_request", `http_${res.status}`, res.status, `HTTP ${res.status} without a Graph error body`) };
    }
    const code = typeof err.code === "number" ? err.code : null;
    const subcode = typeof err.error_subcode === "number" ? err.error_subcode : null;
    const kind = classify(code);
    const f = failure(kind, kind === "invalid_request" || kind === "policy_blocked" ? `meta_${code ?? res.status}` : kind, res.status, this.scrub(String(err.message ?? "")));
    f.code = code;
    f.subcode = subcode;
    f.fbtrace_id = typeof err.fbtrace_id === "string" ? err.fbtrace_id : null;
    if (kind === "rate_limited") {
      const minutes = usage?.regain_minutes || DEFAULT_REGAIN_MINUTES;
      this.block(minutes);
      f.retry_after_ms = minutes * 60_000;
    }
    return { ok: false, error: f };
  }

  private block(minutes: number): void {
    const until = this.o.now().getTime() + minutes * 60_000;
    blockedUntil.set(this.o.throttleKey, Math.max(until, blockedUntil.get(this.o.throttleKey) ?? 0));
  }

  private local(waitMs: number): GraphFailure {
    const f = failure("rate_limited", "rate_limited", null, `Meta asked us to wait; ${Math.ceil(waitMs / 60_000)} min left — not sent`);
    f.retry_after_ms = waitMs;
    f.attempts = 0;
    return f;
  }

  private scrub(s: string): string {
    return s.split(this.o.token).join("[token]");
  }
}

export function classify(code: number | null): GraphFailureKind {
  if (code === null) return "invalid_request";
  if (code === 1 || code === 2) return "transient";
  if (THROTTLE_CODES.has(code) || (code >= 80_000 && code <= 80_014)) return "rate_limited";
  if (code === 190 || code === 102) return "token_invalid";
  if (code === 3 || code === 10 || (code >= 200 && code <= 299)) return "permission_denied";
  if (code === 368) return "policy_blocked";
  return "invalid_request";
}

/** `X-Business-Use-Case-Usage`: `{ <business id>: [{ type, call_count, total_cputime, total_time, estimated_time_to_regain_access }] }`. */
export function readUsage(header: string | null): UsageReading | null {
  if (!header) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(header);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  let peak = 0;
  let regain = 0;
  for (const entries of Object.values(parsed as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries as Array<Record<string, unknown>>) {
      for (const k of ["call_count", "total_cputime", "total_time"]) if (typeof e[k] === "number") peak = Math.max(peak, e[k] as number);
      if (typeof e.estimated_time_to_regain_access === "number") regain = Math.max(regain, e.estimated_time_to_regain_access);
    }
  }
  return { peak_pct: peak, regain_minutes: regain };
}

function failure(kind: GraphFailureKind, error_code: string, http: number | null, message: string): GraphFailure {
  return { kind, error_code, http, code: null, subcode: null, fbtrace_id: null, message, retry_after_ms: null, outcome_unknown: false, attempts: 1 };
}
