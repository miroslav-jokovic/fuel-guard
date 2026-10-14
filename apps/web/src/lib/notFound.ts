// Beside `@/lib/api` rather than in it, importing only its TYPE: 88 test files replace `@/lib/api`
// with a factory that knows `apiFetch` alone, and a record read's `recordOrThrow` must not vanish
// from under every one of them that mounts a detail page.
import type { ApiResult } from "./api";

/**
 * The read asked for one record and there is no such record (D-US5, F21 — UI-STANDARDIZATION.md).
 *
 * Not-found is its own state, not a failure. Before this a detail read that met a 404 threw a plain
 * `Error`, so vue-query retried it three times (seven seconds of "Loading the asset…") and the page
 * then said "Could not load the asset." beside a Retry that could only ever fail again; two pages
 * mapped the 404 to `null` instead and drew nothing at all. A link that rotted in an email, a record
 * another tab deleted and a typo in the address all deserve one sentence and a way back to the list.
 *
 * Thrown by a record read's `queryFn` on a 404 (or on a PostgREST `.maybeSingle()` that found no
 * row); `QueryState` draws it as `NotFoundState`, and `retryUnlessNotFound` never retries it.
 */
export class NotFoundError extends Error {
  constructor(message = "That record does not exist.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export const isNotFound = (error: unknown): error is NotFoundError => error instanceof NotFoundError;

/**
 * vue-query's own default (three retries) for every read, except that a record which is not there
 * is asked about once: retrying a 404 only delays the answer. Installed as the app-wide default in
 * `main.ts`; a query with its own `retry` (the card reads' 429 rule) folds this in itself.
 */
export const retryUnlessNotFound = (failureCount: number, error: unknown): boolean =>
  !isNotFound(error) && failureCount < 3;

/** The app's query defaults: `main.ts` installs them, and a test that mounts a page under a real client uses the same. */
export const QUERY_DEFAULTS = { queries: { retry: retryUnlessNotFound } };

/**
 * One record's read, unwrapped for a `queryFn`: the body when there is one, `NotFoundError` on a 404,
 * and a plain `Error` carrying `failure` (or the API's own reason) on anything else.
 */
export function recordOrThrow<T>(r: ApiResult<T>, failure: string): T {
  if (r.status === 404) throw new NotFoundError(r.error?.message);
  if (!r.ok || r.data == null) throw new Error(r.error?.message ?? failure);
  return r.data;
}
