import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";

/** Build the structured error envelope (docs/01 §8). Never leak upstream errors verbatim (L8). */
export function apiError(code: string, message: string) {
  return { error: { code, message } };
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
