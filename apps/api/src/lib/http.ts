import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";
import { randomUUID } from "node:crypto";

/** Build the structured error envelope (docs/01 §8). Never leak upstream errors verbatim (L8). */
export function apiError(code: string, message: string) {
  return { error: { code, message } };
}

/**
 * Respond to a failed database call without handing the caller our schema.
 *
 * PostgREST and Postgres error text names tables, columns and constraints — `error.message` was
 * being returned verbatim at four route sites, which is exactly what the repo's own audit-L8 rule
 * ("never echo upstream errors verbatim") exists to prevent, and what the global error handler in
 * app.ts already gets right (audit 2026-08-09, finding 3.8).
 *
 * Simply swallowing the text would trade a disclosure problem for a debugging one, so the real
 * message is logged with a short reference that also goes to the caller. An operator handed
 * "(ref: 3f9a1c2b)" can grep the logs and find the exact failure; the caller learns nothing about
 * the schema. This is a stopgap for a proper request id — when correlation ids land (backlog 4.2),
 * this should use that instead of minting its own.
 */
export function dbErrorResponse(
  res: Response,
  scope: string,
  error: { message?: string } | null | undefined,
  publicMessage: string,
  code = "db_error",
): void {
  const ref = randomUUID().slice(0, 8);
  console.error(`[api] ${scope} failed (ref ${ref}):`, error?.message ?? error);
  res.status(500).json(apiError(code, `${publicMessage} (ref: ${ref})`));
}

/** Validate req.body against a Zod schema; 400 on failure. Attaches parsed value to res.locals. */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json(apiError("invalid_request", result.error.issues[0]?.message ?? "Invalid body"));
      return;
    }
    res.locals.body = result.data;
    next();
  };
}

/** Wrap an async handler so rejected promises become a 500 instead of crashing the process. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
