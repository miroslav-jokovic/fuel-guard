import { randomUUID } from "node:crypto";

/**
 * A service failure that leaves a trail.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 * Every service in this module used to answer a failed query with a bare
 * `{ error: "Could not create inspector", code: "insert_failed" }` and throw the database's own
 * message away. When the owner reported that adding an inspector did not work, there was nothing to
 * look at: no row, no audit entry, no log line, and a sentence that named the operation rather than
 * the reason. An error that cannot be diagnosed from production is not an error message, it is a
 * shrug.
 *
 * `lib/http.ts`'s `dbErrorResponse` already had the shape — log the real cause with a short
 * reference, return the reference to the caller — and these services simply did not use it. This is
 * that convention at the service layer, where the cause is still in hand.
 *
 * The public message still never carries the PG text (audit-L8): it carries a reference somebody can
 * grep the logs for.
 */
export interface TracedError {
  error: string;
  code: string;
}

export function traced(scope: string, code: string, publicMessage: string, cause?: unknown): TracedError {
  const ref = randomUUID().slice(0, 8);
  const detail =
    cause && typeof cause === "object" && "message" in cause ? (cause as { message?: string }).message : cause;
  console.error(`[api] maintenance.${scope} failed (ref ${ref}):`, detail ?? "no cause reported");
  return { error: `${publicMessage} (ref: ${ref})`, code };
}
