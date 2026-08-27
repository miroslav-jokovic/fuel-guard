import { createHash } from "node:crypto";
import type { Env } from "../../../env.js";
import type { EfsSoapCredentials, FeedName } from "../services/efsSoapCredentials.js";
import {
  EfsSoapError,
  efsLogin,
  efsLogout,
  requestXml,
  responseValues,
} from "./efsSoapSession.js";
import { asRecords, textValue, xmlEscape } from "./efsXml.js";
import { buildWsSecurityUsernameTokenHeader, describeTlsMaterial, soapFetch, type EfsTlsMaterial, type SoapPriority } from "./soapClient.js";

/**
 * EFS CardManagementWS TRANSACTION FEEDS. The production WSDL defines SOAP 1.1 operations:
 * `login(user,password)` → session `clientId`, `getMCTransExtLocV2` for posted transactions,
 * `getTranRejects(clientId, search)` for rejected authorizations, and `logout(clientId)`.
 * Responses are normalized into the same row shape used by the existing XLSX/CSV ingest path.
 *
 * Session handling, XML primitives, fault classification and the login circuit breaker live in
 * `efsSoapSession.ts` — they are shared with card control (`efsCardOps.ts`), which talks to the SAME
 * endpoint with the SAME service account. That sharing is deliberate: a login storm from either side
 * would lock the account and take the other one down with it.
 *
 * EFS exposes date-range queries rather than a server cursor. We persist the last query end-time in
 * the existing cursor columns and overlap each subsequent query by 48 hours. File-level and
 * external_ref idempotency make the overlap safe while protecting against late settlements.
 */

/** Shape returned by both feeds. Rows match the shape our XLSX ingest already produces so
 *  ingestReport() consumes them without modification. */
export interface EfsSoapFetchResult {
  /** Normalized rows in the SAME shape our XLSX parser (readEfsFile.ts) produces. Downstream
   *  (efsIngest.ts / efsIngestReject.ts) does not distinguish source. */
  rows: Record<string, string | number | null | undefined>[];
  /** Last completed query end-time; subsequent calls overlap it by 48 hours. */
  nextCursor: string | null;
  /** SHA-256 hex of the raw response body (or a stable digest of the fetched batch) — used as
   *  the synthetic file_hash for the imports row so re-fetches are idempotent at the file level.
   *  See services/efsSoapIngest.ts. */
  responseHash: string;
  /** How many pages we fetched in this call — the poller uses this for logging + backfill limits. */
  pagesFetched: number;
  /** A budget stopped this poll before the cursor reached now; the next poll continues from here. */
  moreAvailable: boolean;
  /** Windows still between the cursor and now when this poll began — backfill progress, for logs. */
  windowsOutstanding: number;
}

export interface EfsSoapFetchOptions {
  priority?: SoapPriority;
  /** Maximum request windows to fetch in one call (defaults to one; each window obeys EFS's account limit). */
  maxPages?: number;
  /** Injectable fetch — tests pass a stub. */
  fetchImpl?: typeof fetch;
}

// ─── Public operations ─────────────────────────────────────────────────────────────────────────

/** Fetch the posted transaction report for the cursor window. EFS has no opaque delta token: its
 * contract is a date-time range, so the cursor is the last end-time used and each poll overlaps the
 * preceding 48 hours for late settlements. Existing external_ref dedup makes that overlap safe. */
export async function fetchPostedTransactions(
  env: Env,
  creds: EfsSoapCredentials,
  cursor: string | null,
  opts: EfsSoapFetchOptions = {},
): Promise<EfsSoapFetchResult> {
  return fetchFeed(env, creds, "posted", cursor, opts);
}

/** Fetch rejected authorization attempts for the cursor window. */
export async function fetchRejectedTransactions(
  env: Env,
  creds: EfsSoapCredentials,
  cursor: string | null,
  opts: EfsSoapFetchOptions = {},
): Promise<EfsSoapFetchResult> {
  return fetchFeed(env, creds, "rejected", cursor, opts);
}

/**
 * Login is the smallest legal EFS call and proves, in one round trip: DNS, egress allowlisting, the
 * TLS handshake (INCLUDING mutual-TLS client-certificate acceptance), SOAP routing, and credentials.
 * That is exactly why it is the pre-activation gate for a new client certificate — pass `tlsOverride`
 * to prove a PENDING certificate against the live endpoint before it takes over from the working one.
 *
 * Deliberately does NOT use `withEfsSession`: a probe that answered from a cached session would prove
 * nothing about the material it was asked to test. It does still consult the shared breaker, so a
 * probe can never be the thing that re-locks an already-locked account — a certificate test while
 * the password is wrong reports the password, which is the more useful answer anyway.
 */
export async function pingEfsSoap(
  env: Env,
  creds: EfsSoapCredentials,
  opts: { fetchImpl?: typeof fetch; tlsOverride?: EfsTlsMaterial | null } = {},
): Promise<{ ok: true; roundtripMs: number; tls: string } | { ok: false; error: EfsSoapError; tls: string }> {
  const effective: EfsSoapCredentials =
    opts.tlsOverride === undefined ? creds : { ...creds, tls: opts.tlsOverride };
  const tls = describeTlsMaterial(effective.tls);
  const started = Date.now();
  try {
    const session = await efsLogin(env, effective, "live", { fetchImpl: opts.fetchImpl });
    await efsLogout(env, effective, session, "live", { fetchImpl: opts.fetchImpl });
    return { ok: true, roundtripMs: Date.now() - started, tls };
  } catch (e) {
    const error = e instanceof EfsSoapError
      ? e
      : new EfsSoapError(e instanceof Error ? e.message : String(e), "transport", e);
    return { ok: false, error, tls };
  }
}

/** EFS uses login(user,password) → clientId, not WS-Security UsernameToken. Keep this compatibility
 * export for callers/tests that imported the old seam; the HTTP headers are intentionally empty. */
export function buildAuthHeader(_creds: EfsSoapCredentials): Record<string, string> {
  return {};
}

// ─── Feed plumbing ─────────────────────────────────────────────────────────────────────────────

const SOAP_ACTIONS = {
  posted: "getMCTransExtLocV2",
  rejected: "getTranRejects",
} as const;

function maxRequestDays(env: Env): number {
  return env.EFS_SOAP_MAX_DAYS_PER_REQUEST;
}

function dateWindow(env: Env, cursor: string | null): { start: Date; end: Date } {
  const end = new Date();
  const parsedCursor = cursor ? new Date(cursor) : null;
  let start = parsedCursor && !Number.isNaN(parsedCursor.getTime())
    ? new Date(parsedCursor.getTime() - 48 * 60 * 60 * 1000)
    : new Date(end.getTime() - env.EFS_SOAP_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  if (start > end) start = new Date(end.getTime() - maxRequestDays(env) * 24 * 60 * 60 * 1000);
  return { start, end };
}

function isoDateTime(value: Date): string {
  return value.toISOString();
}

function infoValue(infos: unknown, code: string): string | null {
  for (const info of asRecords(infos)) {
    if (textValue(info.type)?.toUpperCase() === code) return textValue(info.value);
  }
  return null;
}

function fuelItem(line: Record<string, unknown>): string | null {
  const category = textValue(line.category);
  if (category) return category;
  const fuelType = textValue(line.fuelType);
  if (["1", "2", "128", "256", "512", "8192"].includes(fuelType ?? "")) return "ULSD";
  if (["4", "8", "16", "2048"].includes(fuelType ?? "")) return "GASOLINE";
  return fuelType;
}

function transactionRows(values: Record<string, unknown>[]): Record<string, string | number | null>[] {
  return values.flatMap((transaction) => {
    const infos = transaction.infos;
    const lines = asRecords(transaction.lineItems);
    const date = textValue(transaction.POSDate) ?? textValue(transaction.transactionDate);
    return lines.map((line) => ({
      TransactionId: textValue(transaction.transactionId),
      "Stable Transaction ID": textValue(transaction.transactionId),
      "Tran Date": date,
      TransactionPOSTime: null,
      "Card #": textValue(transaction.cardNumber),
      Invoice: textValue(transaction.invoice),
      Unit: infoValue(infos, "UNIT"),
      "Driver Name": infoValue(infos, "NAME"),
      "Driver ID": infoValue(infos, "DRID"),
      "Control ID": infoValue(infos, "CNTN"),
      Odometer: infoValue(infos, "ODRD"),
      Hubometer: infoValue(infos, "HBRD"),
      "Trailer Number": infoValue(infos, "TRLR"),
      Trip: infoValue(infos, "TRIP"),
      SubFleet: infoValue(infos, "SSUB"),
      "Location ID": textValue(transaction.locationId),
      "Location Name": textValue(transaction.locationName),
      City: textValue(transaction.locationCity),
      "State/Prov": textValue(transaction.locationState),
      "Location Address": textValue(transaction.locationAddress),
      Latitude: textValue(transaction.locationLatitude),
      Longitude: textValue(transaction.locationLongitude),
      Item: fuelItem(line),
      "Unit Price": textValue(line.ppu),
      Qty: textValue(line.quantity),
      Amt: textValue(line.amount),
      Currency: textValue(transaction.billingCurrency) ?? textValue(transaction.locationCurrency),
      "Transaction ID": textValue(transaction.transactionId),
    }));
  });
}

function rejectedRows(values: Record<string, unknown>[]): Record<string, string | number | null>[] {
  return values.map((reject) => ({
    Date: textValue(reject.tranDate),
    Time: null,
    "Card Number": textValue(reject.cardNum),
    Invoice: textValue(reject.invoice),
    "Location ID": textValue(reject.locId),
    "Location Name": textValue(reject.locName),
    "Location City": textValue(reject.locCity),
    "State/Prov": textValue(reject.locState),
    "Error Code": textValue(reject.errorCode),
    "Error Description": textValue(reject.errorDesc),
    Unit: textValue(reject.unit),
    "Driver ID": null,
    "Driver Name": null,
  }));
}

function feedBody(feed: FeedName, clientId: string, pageStart: Date, pageEnd: Date): string {
  const id = xmlEscape(clientId);
  return feed === "posted"
    ? `<CardManagementEP_getMCTransExtLocV2><clientId>${id}</clientId><begDate>${isoDateTime(pageStart)}</begDate><endDate>${isoDateTime(pageEnd)}</endDate></CardManagementEP_getMCTransExtLocV2>`
    : `<CardManagementEP_getTranRejects><clientId>${id}</clientId><search><startDate>${isoDateTime(pageStart)}</startDate><endDate>${isoDateTime(pageEnd)}</endDate><cardNum></cardNum><invoice></invoice><locationId>0</locationId></search></CardManagementEP_getTranRejects>`;
}

async function fetchFeed(env: Env, creds: EfsSoapCredentials, feed: FeedName, cursor: string | null, opts: EfsSoapFetchOptions): Promise<EfsSoapFetchResult> {
  const { start, end } = dateWindow(env, cursor);
  const priority = opts.priority ?? (feed === "posted" ? "backfill" : "live");
  // How many windows does the outstanding range cover? One (or less) means we are in steady state
  // and a single page is correct. More means we are catching up — a first backfill, or a feed that
  // was disabled for a while — and waiting a full poll interval per window would turn a 180-day
  // backfill into a six-hour wait on timers rather than on EFS.
  const windowMs = maxRequestDays(env) * 24 * 60 * 60 * 1000;
  const windowsOutstanding = Math.ceil(Math.max(0, end.getTime() - start.getTime()) / windowMs);
  // Fall back to single-page / unbounded rather than NaN if a caller hands us a partial Env (tests,
  // or an older deploy that predates these keys). Degrading to the previous behaviour is safe;
  // arithmetic on undefined silently disables the loop, which is not.
  const catchUpPages = env.EFS_SOAP_BACKFILL_MAX_PAGES;
  const maxPages = Math.max(1, opts.maxPages ?? (windowsOutstanding > 1 ? catchUpPages : 1));
  const deadline = env.EFS_SOAP_BACKFILL_MAX_MS ? Date.now() + env.EFS_SOAP_BACKFILL_MAX_MS : Infinity;
  const rowBudget = env.EFS_SOAP_MAX_ROWS_PER_POLL;

  // The feeds keep login-per-poll rather than moving to withEfsSession(). Deliberate: a poller runs
  // every 5–15 minutes, so a session buys it nothing, and changing when it logs out would be a real
  // behaviour change dressed up as a refactor. What the feeds DO now share with card control is the
  // login CIRCUIT BREAKER — efsLogin() is the single choke point, so a bad credential pauses both
  // sides at once instead of letting them race into the vendor's lockout. That was the whole point.
  const session = await efsLogin(env, creds, priority, { fetchImpl: opts.fetchImpl });
  const rows: Record<string, string | number | null>[] = [];
  const responseHash = createHash("sha256");
  let pageStart = start;
  let pagesFetched = 0;
  let nextCursor = cursor;
  try {
    while (pagesFetched < maxPages && pageStart < end) {
      // Stop cleanly on either budget. The cursor has already advanced past every COMPLETED page, so
      // the next poll resumes exactly here — no gap, no re-fetch. Checked before dispatching rather
      // than after, so we never start a request we know we can't afford to finish.
      if (pagesFetched > 0 && (Date.now() >= deadline || rows.length >= rowBudget)) break;
      // Window size is capped by EFS_SOAP_MAX_DAYS_PER_REQUEST (7 per the EFS guide). The cursor
      // lets a larger initial backfill walk across several polls.
      const pageEnd = new Date(Math.min(
        pageStart.getTime() + maxRequestDays(env) * 24 * 60 * 60 * 1000,
        end.getTime(),
      ));
      const response = await requestXml(env, creds, SOAP_ACTIONS[feed], feedBody(feed, session.clientId, pageStart, pageEnd), priority, {
        fetchImpl: opts.fetchImpl,
        cookie: session.cookie,
      });
      responseHash.update(response.body);
      rows.push(...(feed === "posted" ? transactionRows(responseValues(response.body)) : rejectedRows(responseValues(response.body))));
      pagesFetched += 1;
      nextCursor = pageEnd.toISOString();
      pageStart = pageEnd;
    }
    return {
      rows,
      nextCursor,
      responseHash: responseHash.digest("hex"),
      pagesFetched,
      // True when a budget stopped us short. The caller logs it so a long backfill is visibly
      // "still working" rather than indistinguishable from "finished and found nothing".
      moreAvailable: pageStart < end,
      windowsOutstanding,
    };
  } finally {
    await efsLogout(env, creds, session, priority, { fetchImpl: opts.fetchImpl });
  }
}

// ─── Feed → operation router ───────────────────────────────────────────────────────────────────

/** WSDL operation names used by the two normalized feed paths. */
export const FEED_OPERATIONS: Record<FeedName, { operationName: string; description: string }> = {
  posted: {
    operationName: "getMCTransExtLocV2",
    description: "Posted transactions with location and line-item detail.",
  },
  rejected: {
    operationName: "getTranRejects",
    description: "Rejected authorization attempts and EFS rejection reasons.",
  },
};

// Re-export the session + XML + soap-layer primitives so existing importers don't need to change. The
// canonical homes are efsSoapSession.ts, efsXml.ts and soapClient.ts; new code imports from those.
export { EfsSoapError } from "./efsSoapSession.js";
export { buildSoapEnvelope, type SoapEnvelopeInput } from "./efsXml.js";
export { buildWsSecurityUsernameTokenHeader, soapFetch };
