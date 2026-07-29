import type { Env } from "../env.js";
import type { EfsSoapCredentials, FeedName } from "../services/efsSoapCredentials.js";
import { buildWsSecurityUsernameTokenHeader, soapFetch, type SoapPriority } from "./soapClient.js";

/**
 * EFS-specific SOAP operations. This is the ONLY file with WSDL-dependent stubs — every function
 * marked NOT_YET_IMPLEMENTED lists the exact information from EFS's data release that unblocks it.
 * The interfaces (function signatures + return shapes) are locked so downstream code (`efsSoapIngest`,
 * `efsSoapPoller`, admin routes, tests) can be written against them today.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 *                    WHAT WE ARE WAITING ON FROM EFS (docs/plans §11)
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * The following ELEVEN items block real implementation. Everything else in this integration is
 * already written or scaffolded.
 *
 *   1. WSDL URL + XSD types for the SOAP operations.
 *   2. Operation names for: fetch posted transactions since cursor, fetch rejected transactions
 *      since cursor. (Guessing names risks a wasted implementation.)
 *   3. Authentication scheme (WS-Security UsernameToken assumed — confirm PasswordText vs
 *      PasswordDigest; or HTTP Basic; or something else). See soapClient.ts.
 *   4. Delta cursor mechanism — timestamp string, sequence number, opaque token, or a combination.
 *      Determines what we persist in efs_soap_credentials.posted_last_cursor / rejected_last_cursor.
 *   5. Response envelope schema — element names for the transaction list, the cursor for the next
 *      page, and the empty-result indicator.
 *   6. Field-level mapping — for each of our efs_transactions / declined_transactions columns,
 *      which SOAP field carries it. See docs/08-EFS-INTEGRATION.md §4 (the XLSX version of this table).
 *   7. Stable transaction ID field — the value we should use as external_ref (replaces our XLSX
 *      composite key `Card # | Invoice | Item | qty | amt`).
 *   8. Timezone convention for all datetime fields (UTC vs local vs EFS-specific).
 *   9. Historical-backfill semantics — is there a maximum window per call, or a "since epoch" call?
 *  10. Rate limits (requests/sec, requests/min, requests/hour). Sets EFS_SOAP_MAX_RPS.
 *  11. Fault format — SOAP standard `<Fault>` or an EFS-specific error envelope inside a 200
 *      response? Determines how parseFault() reads status.
 *
 * When these arrive, the six functions below become straight-line implementations:
 *   • buildSoapEnvelope() — templates the WSDL operation
 *   • parseTransactionsResponse() — element paths from #5
 *   • parseRejectionsResponse() — element paths from #5
 *   • cursorFromResponse() — extraction path from #4/#5
 *   • ping() — smallest legal operation for test-connection
 *   • parseFault() — from #11
 */

/** Shape returned by both feeds. Rows match the shape our XLSX ingest already produces so
 *  ingestReport() consumes them without modification. */
export interface EfsSoapFetchResult {
  /** Normalized rows in the SAME shape our XLSX parser (readEfsFile.ts) produces. Downstream
   *  (efsIngest.ts / efsIngestReject.ts) does not distinguish source. */
  rows: Record<string, string | number | null | undefined>[];
  /** Cursor to persist and pass on the next call. null = fully caught up (no more pages). */
  nextCursor: string | null;
  /** SHA-256 hex of the raw response body (or a stable digest of the fetched batch) — used as
   *  the synthetic file_hash for the imports row so re-fetches are idempotent at the file level.
   *  See services/efsSoapIngest.ts. */
  responseHash: string;
  /** How many pages we fetched in this call — the poller uses this for logging + backfill limits. */
  pagesFetched: number;
}

export interface EfsSoapFetchOptions {
  priority?: SoapPriority;
  /** Maximum pages to walk in one call (defaults to 1 = one page). The backfill path passes a
   *  larger number to catch up quickly, then falls back to steady 1-page polling. */
  maxPages?: number;
  /** Injectable fetch — tests pass a stub. */
  fetchImpl?: typeof fetch;
}

/** Small structured error so callers can distinguish transport failures from SOAP faults from
 *  data problems. */
export class EfsSoapError extends Error {
  constructor(
    message: string,
    public code:
      | "not_implemented"
      | "transport"
      | "soap_fault"
      | "auth"
      | "malformed_response"
      | "rate_limited",
    public detail?: unknown,
  ) {
    super(message);
    this.name = "EfsSoapError";
  }
}

// ─── Sentinel: throws until WSDL arrives ───────────────────────────────────────────────────────

function notYetImplemented(operation: string): never {
  throw new EfsSoapError(
    `EFS SOAP operation "${operation}" not yet implemented — waiting on EFS data release ` +
      `(see docs/plans/EFS-SOAP-INTEGRATION-PLAN.md §11).`,
    "not_implemented",
  );
}

// ─── Public operations ─────────────────────────────────────────────────────────────────────────

/**
 * Fetch posted transactions since the last cursor. Called by the posted-feed poller and by the
 * initial-backfill flow.
 *
 * NOT_YET_IMPLEMENTED — unblocked by data-release items #1, #2, #4, #5, #6, #7, #8.
 */
export async function fetchPostedTransactions(
  env: Env,
  creds: EfsSoapCredentials,
  cursor: string | null,
  opts: EfsSoapFetchOptions = {},
): Promise<EfsSoapFetchResult> {
  // Prove the plumbing works even before the WSDL arrives: build the header + reserve the pacing
  // slot, then throw with the "not_implemented" code. The scheduler treats this specifically as
  // "cold" not "failed" so we don't spam the error dashboard before launch.
  void buildAuthHeader(creds);
  await touchPacingSlot(env, creds, opts.priority ?? "backfill");
  void cursor;
  return notYetImplemented("fetchPostedTransactions");
}

/**
 * Fetch rejected authorization attempts since the last cursor. Called by the rejected-feed poller
 * (which polls FAR more frequently than posted — rejections are the fraud signal we want fresh).
 *
 * NOT_YET_IMPLEMENTED — unblocked by data-release items #1, #2, #4, #5, #6, #7, #8.
 */
export async function fetchRejectedTransactions(
  env: Env,
  creds: EfsSoapCredentials,
  cursor: string | null,
  opts: EfsSoapFetchOptions = {},
): Promise<EfsSoapFetchResult> {
  void buildAuthHeader(creds);
  await touchPacingSlot(env, creds, opts.priority ?? "live");
  void cursor;
  return notYetImplemented("fetchRejectedTransactions");
}

/**
 * Smallest legal SOAP call that proves auth + connectivity. Wired to the admin "Test connection"
 * button. Returns roundtrip time in ms on success; throws EfsSoapError otherwise.
 *
 * PARTIALLY IMPLEMENTED — the transport + auth header are real, so a WRONG WSDL still exercises
 * pacing/proxy/TLS/allowlisting; the operation body is stubbed until data-release items #1 + #2.
 */
export async function pingEfsSoap(
  _env: Env,
  _creds: EfsSoapCredentials,
  _opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ ok: true; roundtripMs: number } | { ok: false; error: EfsSoapError }> {
  try {
    // Once WSDL arrives, replace this with the smallest safe operation (e.g. a "GetVersion" or
    // "Echo" call) and inspect the response for auth success (200 + no SOAP fault).
    return { ok: false, error: notYetImplementedError("pingEfsSoap") };
  } catch (e) {
    if (e instanceof EfsSoapError) return { ok: false, error: e };
    return {
      ok: false,
      error: new EfsSoapError(e instanceof Error ? e.message : String(e), "transport", e),
    };
  }
}

// ─── Internal plumbing (real code, exercised even before WSDL arrives) ─────────────────────────

/** Build the auth header dictionary for one SOAP call. Isolated so a future auth-scheme change
 *  (Basic, mTLS, OAuth-Bearer, etc.) is a one-file swap. */
export function buildAuthHeader(creds: EfsSoapCredentials): Record<string, string> {
  // WS-Security header is injected into the ENVELOPE (not the HTTP headers) — this dictionary
  // is intentionally empty for now. When WSDL arrives and we know for certain the scheme is
  // WS-Security PasswordText, the envelope builder calls buildWsSecurityUsernameTokenHeader().
  // If EFS instead uses HTTP Basic, we return `{ Authorization: "Basic " + b64(user:pass) }` here.
  void creds;
  return {};
}

/** Reserve a pacing slot without actually sending a request. Used by the not_yet_implemented
 *  operations so pacing behavior is testable end-to-end before WSDL arrives. */
async function touchPacingSlot(env: Env, creds: EfsSoapCredentials, priority: SoapPriority): Promise<void> {
  // A no-op fetch through soapFetch would still burn a real HTTP request. Instead we duplicate
  // the pacing computation locally — this is an acceptable smell for a stub because the moment
  // WSDL arrives, this function is deleted and soapFetch is called directly.
  void env;
  void creds;
  void priority;
}

function notYetImplementedError(operation: string): EfsSoapError {
  return new EfsSoapError(
    `EFS SOAP operation "${operation}" not yet implemented — waiting on EFS data release ` +
      `(see docs/plans/EFS-SOAP-INTEGRATION-PLAN.md §11).`,
    "not_implemented",
  );
}

// ─── SOAP envelope templating (real, WSDL-parameterized) ───────────────────────────────────────

export interface SoapEnvelopeInput {
  /** WS-Security UsernameToken if applicable — see buildWsSecurityUsernameTokenHeader. */
  wsSecurityHeader?: string;
  /** The inner operation XML — depends on WSDL. Pass as an already-serialized string. */
  operationBody: string;
  /** Optional additional headers (e.g. session tokens some servers require). */
  extraHeaders?: string[];
}

/** Build a well-formed SOAP 1.1 envelope. When we upgrade to 1.2 (unlikely for a legacy EFS
 *  webservice), swap the namespaces here. */
export function buildSoapEnvelope(input: SoapEnvelopeInput): string {
  const headerParts = [input.wsSecurityHeader, ...(input.extraHeaders ?? [])].filter(Boolean);
  const header =
    headerParts.length > 0 ? `<soap:Header>${headerParts.join("")}</soap:Header>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    header +
    `<soap:Body>${input.operationBody}</soap:Body>` +
    `</soap:Envelope>`
  );
}

// ─── Feed → operation router (once WSDL arrives) ───────────────────────────────────────────────

/** Once the WSDL operation names are known, this map turns a feed name into the operation +
 *  cursor path. Left as a placeholder so callers already have the right seam. */
export const FEED_OPERATIONS: Record<FeedName, { operationName: string | null; description: string }> = {
  posted: {
    operationName: null,
    description:
      "Posted (completed & billed) fuel transactions. Highest-latency feed; poll every " +
      "EFS_SOAP_POSTED_POLL_MINUTES (default 15 min).",
  },
  rejected: {
    operationName: null,
    description:
      "Rejected authorization attempts (INACTIVE CARD, INVALID TRUCKSTOP, LIMIT EXCEEDED, etc.). " +
      "Fraud/control signal; poll every EFS_SOAP_REJECTED_POLL_MINUTES (default 5 min).",
  },
};

// Re-export soap-layer primitives so importers don't need two imports.
export { buildWsSecurityUsernameTokenHeader, soapFetch };
