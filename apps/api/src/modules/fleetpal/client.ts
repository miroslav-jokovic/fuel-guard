import { z } from "zod";
import { paginated } from "@silvicom/shared";
import { FleetpalError, errorFromResponse } from "./errors.js";

/**
 * The FleetPal HTTP client (FLEETPAL-INTEGRATION-PLAN.md F3, D-FP9).
 *
 * Nothing outside this file parses a FleetPal payload (D-ARC1). It speaks the vendor's four
 * conventions and hands typed rows to the ingest, which knows nothing about HTTP.
 *
 * ── ⚠ 1. WALK BY `next`, NEVER BY OFFSET ───────────────────────────────────────────────────────
 * The vendor orders results **newest-first** and warns that rows added while you page shift items
 * between pages. Incrementing `offset` therefore skips rows AND repeats rows, silently, in
 * proportion to how busy the shop is — which is exactly when the sweep matters. `walk()` below
 * follows `next` until it is null and never computes an offset. For stability ACROSS runs the fix
 * is different again and belongs to the caller: page by `updated_after`, which §2.7 assigns per
 * resource.
 *
 * ── ⚠ 2. A 429 IS AN INSTRUCTION, NOT AN ERROR ─────────────────────────────────────────────────
 * `Retry-After` says how long to wait. We wait and resume, because the alternative — treating it as
 * a failure — abandons a sweep the vendor was perfectly willing to serve a moment later. Retries
 * are BOUNDED: an endpoint that answers 429 forever is a configuration problem, and looping on it
 * is how one org's sweep starves every other org's.
 *
 * ── ⚠ 3. A 400 IS NEVER RETRIED ────────────────────────────────────────────────────────────────
 * Our request is wrong; the same body fails identically forever. A retry loop on a validation error
 * is an outage that presents as a slow sync, which is the worst of both.
 *
 * ── ⚠ 4. EVERY REQUEST IS DEADLINED ────────────────────────────────────────────────────────────
 * `fetch` without a signal waits indefinitely. One hung connection would hold a scheduler tick open
 * forever and the symptom would be "the sync stopped" with nothing in the logs — the same silent
 * stall D-SAM4's cursors exist to make loud.
 */

export interface FleetpalClientOptions {
  apiKey: string;
  baseUrl: string;
  /** Per-request deadline. */
  timeoutMs?: number;
  /** How many times a retryable failure is retried before the sweep gives up. */
  maxRetries?: number;
  /** Injected for tests; production passes nothing and gets the platform's. */
  fetchImpl?: typeof fetch;
  /** Injected for tests, so a backoff assertion does not take its own delay to run. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 4;
/** The vendor clamps rather than rejects above this; asking for more just wastes the round trip. */
export const MAX_PAGE_SIZE = 200;

export interface FleetpalRequestLog {
  path: string;
  status: number | null;
  attempts: number;
  ms: number;
  error: string | null;
}

export class FleetpalClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  /**
   * Every request and its outcome, in order. A sweep records these against
   * `fleetpal_sync_state.last_error` so a failure is visible on the collector's status read rather
   * than only in a log nobody greps.
   */
  readonly log: FleetpalRequestLog[] = [];

  constructor(opts: FleetpalClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.doFetch = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * One request, with bounded retry on the kinds that deserve it.
   *
   * `url` may be absolute — that is how `next` is followed — or a path we join to `baseUrl`. An
   * absolute one is NOT re-based: the vendor's own instruction is to follow the url it gives rather
   * than templating paths out of ids, so that a collection moving does not break us.
   */
  private async request<T>(url: string, schema: z.ZodType<T>): Promise<T> {
    const target = url.startsWith("http") ? url : `${this.baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
    const started = Date.now();
    let attempts = 0;
    let lastError: FleetpalError | null = null;

    while (attempts <= this.maxRetries) {
      attempts++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let status: number | null = null;
      try {
        const res = await this.doFetch(target, {
          headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
          signal: controller.signal,
        });
        status = res.status;
        if (res.ok) {
          const body = (await res.json()) as unknown;
          this.log.push({ path: target, status, attempts, ms: Date.now() - started, error: null });
          // A shape we cannot parse is OUR bug or a vendor change, and either way it is not
          // retryable — so it becomes a validation error rather than another round trip.
          const parsed = schema.safeParse(body);
          if (!parsed.success) {
            throw new FleetpalError(
              `FleetPal response did not match the contract: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`,
              "validation",
              status,
            );
          }
          return parsed.data;
        }
        // A 4xx body is JSON; a 5xx or a proxy page may be anything, and losing the STATUS because
        // the body was unreadable would turn a diagnosable 401 into an unexplained crash.
        const body = await res.json().catch(() => null);
        lastError = errorFromResponse(status, res.headers.get("retry-after"), body);
      } catch (e) {
        if (e instanceof FleetpalError) throw e;
        const message = e instanceof Error ? e.message : String(e);
        lastError = new FleetpalError(
          controller.signal.aborted ? `FleetPal request timed out after ${this.timeoutMs}ms` : message,
          "transport",
          null,
        );
      } finally {
        clearTimeout(timer);
      }

      this.log.push({
        path: target,
        status,
        attempts,
        ms: Date.now() - started,
        error: lastError.message,
      });
      if (!lastError.retryable || attempts > this.maxRetries) throw lastError;
      await this.sleep(this.backoffMs(lastError, attempts));
    }
    throw lastError ?? new FleetpalError("FleetPal request failed", "transport", null);
  }

  /**
   * How long to wait before the next attempt.
   *
   * ⚠ **The vendor's `Retry-After` wins over our own curve.** They know their limiter; an
   * exponential backoff that ignored the header would either hammer them early or idle far longer
   * than they asked. For everything else it is exponential from one second, which is short enough
   * that a transient blip costs nothing and long enough that a real outage is not hammered.
   */
  private backoffMs(error: FleetpalError, attempt: number): number {
    if (error.retryAfterSec !== null) return error.retryAfterSec * 1000;
    return Math.min(1000 * 2 ** (attempt - 1), 30_000);
  }

  /** One object by its own url or path. */
  async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.request(path, schema);
  }

  /**
   * Walk a whole collection, following `next` until it is null.
   *
   * ⚠ **`guard` is not paranoia.** A vendor bug, or a proxy rewriting `next`, could return a page
   * whose `next` points at itself; without a bound the sweep would loop forever holding a scheduler
   * tick, and the symptom would be "the sync stopped" with nothing in the logs. The bound is high
   * enough that no real collection reaches it — 200 per page × 5,000 pages is a million rows.
   */
  async walk<T>(
    path: string,
    itemSchema: z.ZodType<T>,
    params: Record<string, string | number | undefined> = {},
    guard = 5_000,
  ): Promise<T[]> {
    const envelope = paginated(itemSchema);
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") query.set(k, String(v));
    }
    if (!query.has("limit")) query.set("limit", String(MAX_PAGE_SIZE));

    const out: T[] = [];
    let url: string | null = `${path}${path.includes("?") ? "&" : "?"}${query.toString()}`;
    let pages = 0;
    const seen = new Set<string>();

    while (url) {
      if (++pages > guard) {
        throw new FleetpalError(
          `FleetPal pagination exceeded ${guard} pages walking ${path} — refusing to loop`,
          "validation",
          null,
        );
      }
      if (seen.has(url)) {
        throw new FleetpalError(
          `FleetPal returned a next url it had already served (${url}) — refusing to loop`,
          "validation",
          null,
        );
      }
      seen.add(url);
      const page = (await this.request(url, envelope)) as { next: string | null; results: T[] };
      out.push(...page.results);
      url = page.next;
    }
    return out;
  }
}
