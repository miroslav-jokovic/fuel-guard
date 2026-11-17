import { randomUUID } from "node:crypto";

/**
 * A service failure that leaves a trail: the real cause is logged under a short reference, and the
 * caller gets the reference in place of the database's text (audit-L8). `dbErrorResponse` in
 * `http.ts` is the same convention for a route holding `res`; this is it for a service, where the
 * cause is still in hand.
 *
 * Born in `modules/maintenance/inspections/serviceError.ts` (the reasons are written there) and
 * promoted here when the tolls module needed it, because a module may not import another module's
 * internals (`check-feature-boundaries`) and a second copy would be a second convention.
 */
export interface TracedError {
  error: string;
  code: string;
}

export function tracedFailure(scope: string, code: string, publicMessage: string, cause?: unknown): TracedError {
  const ref = randomUUID().slice(0, 8);
  const detail =
    cause && typeof cause === "object" && "message" in cause ? (cause as { message?: string }).message : cause;
  console.error(`[api] ${scope} failed (ref ${ref}):`, detail ?? "no cause reported");
  return { error: `${publicMessage} (ref: ${ref})`, code };
}
