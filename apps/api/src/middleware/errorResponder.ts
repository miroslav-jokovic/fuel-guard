import type { NextFunction, Request, Response } from "express";
import { apiError, HttpError } from "../lib/http.js";

/**
 * The terminal error handler — never echo an upstream error verbatim (audit L8).
 *
 * A sub-500 `HttpError` is a DECIDED ANSWER that a guard threw instead of returning: "that card is
 * not in this company", "EFS is not connected for this company". Logging those at error level with a
 * stack is how an error channel stops being read, so they are answered silently and only faults reach
 * the log. Sentry already draws the same line — its express handler reports `status >= 500` only.
 *
 * It lives here rather than inline in `createApp` because `createApp` is 20 lines from the
 * function-size budget, and a terminal middleware is exactly the kind of self-contained thing that
 * should not be spending that budget.
 */
/**
 * A CLIENT fault thrown by middleware we did not write — chiefly `express.json()`.
 *
 * ── WHY THIS EXISTS (2026-09-01) ────────────────────────────────────────────────────────────────
 * `express.json()` runs in strict mode, so a double-encoded body (a top-level JSON *string* rather
 * than an object) is rejected by body-parser with `type: "entity.parse.failed"` and `status: 400`.
 * That error is not this repo's `HttpError`, so it fell through to the 500 below and the caller was
 * told "Unexpected server error" — for a request that never reached its handler.
 *
 * It cost an hour of chasing a delete that had nothing wrong with it: the service ran correctly
 * against production when called directly, every database operation succeeded, and the route passed
 * end to end in a test. The one thing the message ruled out was the one thing that was true.
 *
 * `expose` is http-errors' own flag for "this message is safe to show a client" — it is true for
 * 4xx and false for 5xx, which is exactly the line audit L8 draws about never echoing an upstream
 * error verbatim. So the status is honoured, the message only when the thrower marked it safe.
 */
function clientFault(err: unknown): { status: number; message: string } | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { status?: unknown; statusCode?: unknown; expose?: unknown; message?: unknown };
  const status = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : null;
  if (status === null || status < 400 || status >= 500) return null;
  const safe = e.expose === true && typeof e.message === "string" && e.message.length > 0;
  return { status, message: safe ? (e.message as string) : "Malformed request" };
}

export function errorResponder(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const fault = err instanceof HttpError ? null : clientFault(err);
  const decided = (err instanceof HttpError && err.status < 500) || fault !== null;
  if (!decided) console.error("[api] unhandled error:", err);
  if (res.headersSent) return;
  if (err instanceof HttpError) {
    res.status(err.status).json(apiError(err.code, err.message));
    return;
  }
  if (fault) {
    res.status(fault.status).json(apiError("invalid_request", fault.message));
    return;
  }
  res.status(500).json(apiError("internal_error", "Unexpected server error"));
}
