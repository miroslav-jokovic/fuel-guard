/**
 * FleetPal's error vocabulary (FLEETPAL-INTEGRATION-PLAN.md F3).
 *
 * ── ⚠ BRANCH ON `code`, NEVER ON `message` ─────────────────────────────────────────────────────
 * The vendor is explicit about which half of a validation error is a contract: codes (`invalid`,
 * `duplicate`, `required`, …) are stable and safe to branch on; messages are human-readable and
 * **may be reworded**. A client keyed off message text works until somebody makes a copy edit, and
 * then fails in a way that looks like the vendor broke something. Nothing below reads a message
 * except to put it in front of a person.
 *
 * ── WHAT EACH STATUS MEANS FOR A SWEEP, WHICH IS NOT WHAT IT MEANS IN GENERAL ──────────────────
 * The distinction that matters to a collector is **retry / stop / skip**, and it does not follow
 * the usual 4xx-vs-5xx line:
 *
 *   • `401` — the key is dead (missing, malformed, revoked, expired). STOP the org's sweep. Retrying
 *     cannot help and hammering an auth endpoint is how a key gets rate-limited on top of revoked.
 *   • `403` — the key is valid but its ROLE cannot read this. Also stop, and say which resource:
 *     keys are issued per user and carry that user's role, so this is a support ticket, not a bug.
 *   • `404` — no such object **or it belongs to another company**. The vendor collapses those two
 *     deliberately. For a collection walk it is fatal; for one object it means skip.
 *   • `429` — back off for `Retry-After` seconds and resume. Not an error; the vendor's documented
 *     way of asking us to slow down.
 *   • `5xx` — retry with backoff. Their side.
 *   • `400` — our request is wrong. Never retried: the same body will fail identically forever, and
 *     a retry loop on a validation error is an outage that looks like a slow sync.
 */

export type FleetpalErrorKind =
  | "auth"        // 401 — credential dead, stop this org
  | "forbidden"   // 403 — role cannot read this resource, stop and report
  | "not_found"   // 404 — gone, or another company's
  | "rate_limit"  // 429 — back off and resume
  | "validation"  // 400 — our request; never retry
  | "server"      // 5xx — theirs; retry with backoff
  | "transport";  // the request never completed

export class FleetpalError extends Error {
  constructor(
    message: string,
    readonly kind: FleetpalErrorKind,
    readonly status: number | null,
    /** Field-keyed validation codes, when the vendor sent them. Empty for every other kind. */
    readonly codes: Record<string, string> = {},
    /** Seconds the vendor asked us to wait. Only ever set on `rate_limit`. */
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = "FleetpalError";
  }

  /** Whether a sweep should try this request again, as opposed to stopping or skipping. */
  get retryable(): boolean {
    return this.kind === "rate_limit" || this.kind === "server" || this.kind === "transport";
  }
}

function kindFor(status: number): FleetpalErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "validation";
}

/**
 * Read `Retry-After`.
 *
 * ⚠ **A missing or unparseable header is not zero.** The vendor documents seconds, but HTTP allows
 * an HTTP-date and a proxy may send one; `Number("Wed, 10 Sep 2026 …")` is `NaN`, and a `NaN ?? 0`
 * that became a zero-second wait would turn a rate limit into a hot loop against the endpoint that
 * just asked us to slow down. So an unreadable value falls back to a real pause.
 */
export const RATE_LIMIT_FALLBACK_SEC = 30;
export function parseRetryAfter(raw: string | null): number {
  if (!raw) return RATE_LIMIT_FALLBACK_SEC;
  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const at = Date.parse(raw);
  if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000));
  return RATE_LIMIT_FALLBACK_SEC;
}

/**
 * Turn a failed response into a `FleetpalError`.
 *
 * A `4xx` body is JSON: validation failures are keyed by field name with whole-object errors under
 * `non_field_errors`, and every other status returns a bare `detail` string. A body that is neither
 * — an HTML error page from a proxy, say — must not throw here: losing the STATUS because the body
 * was unreadable would turn a diagnosable 401 into an unexplained crash.
 */
export function errorFromResponse(status: number, retryAfter: string | null, body: unknown): FleetpalError {
  const kind = kindFor(status);
  const retryAfterSec = kind === "rate_limit" ? parseRetryAfter(retryAfter) : null;

  if (body && typeof body === "object") {
    const rec = body as Record<string, unknown>;
    if (typeof rec.detail === "string") {
      return new FleetpalError(rec.detail, kind, status, {}, retryAfterSec);
    }
    const codes: Record<string, string> = {};
    const parts: string[] = [];
    for (const [field, value] of Object.entries(rec)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      if (typeof v.code === "string") codes[field] = v.code;
      if (typeof v.message === "string") parts.push(`${field}: ${v.message}`);
    }
    if (parts.length > 0) {
      return new FleetpalError(parts.join("; "), kind, status, codes, retryAfterSec);
    }
  }
  return new FleetpalError(`FleetPal returned ${status}`, kind, status, {}, retryAfterSec);
}
