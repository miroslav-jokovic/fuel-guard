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
export function errorResponder(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const decided = err instanceof HttpError && err.status < 500;
  if (!decided) console.error("[api] unhandled error:", err);
  if (res.headersSent) return;
  if (err instanceof HttpError) {
    res.status(err.status).json(apiError(err.code, err.message));
    return;
  }
  res.status(500).json(apiError("internal_error", "Unexpected server error"));
}
