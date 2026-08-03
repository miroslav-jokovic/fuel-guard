import { createHash } from "node:crypto";
import { DOMParser, type Element as XmlElement, type Node as XmlNode } from "@xmldom/xmldom";
import type { Env } from "../env.js";
import type { EfsSoapCredentials, FeedName } from "../services/efsSoapCredentials.js";
import { buildWsSecurityUsernameTokenHeader, classifyTlsError, describeTlsMaterial, soapFetch, type EfsTlsMaterial, type SoapPriority } from "./soapClient.js";

/**
 * EFS CardManagementWS operations. The production WSDL defines SOAP 1.1 operations:
 * `login(user,password)` → session `clientId`, `getMCTransExtLocV2` for posted transactions,
 * `getTranRejects(clientId, search)` for rejected authorizations, and `logout(clientId)`.
 * Responses are normalized into the same row shape used by the existing XLSX/CSV ingest path.
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
}

export interface EfsSoapFetchOptions {
  priority?: SoapPriority;
  /** Maximum request windows to fetch in one call (defaults to one; each window obeys EFS's account limit). */
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
      | "rate_limited"
      | "tls",
    public detail?: unknown,
  ) {
    super(message);
    this.name = "EfsSoapError";
  }
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
    const session = await login(env, effective, "live", opts.fetchImpl);
    await logout(env, effective, session.clientId, "live", opts.fetchImpl, session.cookie);
    return { ok: true, roundtripMs: Date.now() - started, tls };
  } catch (e) {
    const error = e instanceof EfsSoapError
      ? e
      : new EfsSoapError(e instanceof Error ? e.message : String(e), "transport", e);
    return { ok: false, error, tls };
  }
}

// ─── EFS SOAP session + response plumbing ───────────────────────────────────────────────────────

/** EFS uses login(user,password) → clientId, not WS-Security UsernameToken. Keep this compatibility
 * export for callers/tests that imported the old seam; the HTTP headers are intentionally empty. */
export function buildAuthHeader(_creds: EfsSoapCredentials): Record<string, string> {
  return {};
}

type SoapValue = string | null | Record<string, unknown> | SoapValue[];

const SOAP_ACTIONS = {
  login: "login",
  logout: "logout",
  posted: "getMCTransExtLocV2",
  rejected: "getTranRejects",
} as const;

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function localName(node: XmlNode): string {
  return (node as XmlElement).localName ?? node.nodeName.split(":").pop() ?? node.nodeName;
}

function childElements(element: XmlElement): XmlElement[] {
  const children: XmlElement[] = [];
  for (let i = 0; i < element.childNodes.length; i++) {
    const node = element.childNodes.item(i);
    if (node && node.nodeType === 1) children.push(node as XmlElement);
  }
  return children;
}

function findDescendant(root: XmlElement, wanted: string): XmlElement | null {
  for (const child of childElements(root)) {
    if (localName(child) === wanted) return child;
    const nested = findDescendant(child, wanted);
    if (nested) return nested;
  }
  return null;
}

function elementToValue(element: XmlElement): SoapValue {
  if (element.getAttribute("xsi:nil") === "true" || element.getAttribute("nil") === "true") return null;
  const children = childElements(element);
  if (children.length === 0) return (element.textContent ?? "").trim() || null;
  const record: Record<string, unknown> = {};
  for (const child of children) {
    const key = localName(child);
    const value = elementToValue(child);
    const previous = record[key];
    record[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return record;
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object");
  return value && typeof value === "object" ? [value as Record<string, unknown>] : [];
}

function textValue(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return textValue(value[0]);
  if (typeof value === "object") return null;
  const text = String(value).trim();
  return text || null;
}

function parseSoap(xml: string): XmlElement {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (!doc.documentElement || findDescendant(doc.documentElement, "parsererror")) {
    throw new EfsSoapError("EFS returned malformed XML", "malformed_response");
  }
  const fault = findDescendant(doc.documentElement, "Fault");
  if (fault) {
    const message = textValue(elementToValue(findDescendant(fault, "faultstring") ?? fault)) ?? "EFS SOAP fault";
    const lower = message.toLowerCase();
    const code = /rate|limit|429/.test(lower)
      ? "rate_limited"
      : /auth|login|password|user|credential|clientid/.test(lower)
        ? "auth"
        : "soap_fault";
    throw new EfsSoapError(message, code);
  }
  return doc.documentElement;
}

function responseValues(xml: string): Record<string, unknown>[] {
  const root = parseSoap(xml);
  const result = findDescendant(root, "result");
  if (!result) return [];
  return childElements(result)
    .filter((child) => localName(child) === "value")
    .map((child) => elementToValue(child))
    .flatMap(asRecords);
}

function responseResult(xml: string): string {
  const root = parseSoap(xml);
  const result = findDescendant(root, "result");
  const value = result ? textValue(elementToValue(result)) : null;
  if (!value) throw new EfsSoapError("EFS login response did not contain a clientId", "auth");
  return value;
}

async function requestXml(
  env: Env,
  creds: EfsSoapCredentials,
  operation: string,
  body: string,
  priority: SoapPriority,
  fetchImpl?: typeof fetch,
  retry = true,
  cookie?: string | null,
): Promise<{ body: string; headers: Headers }> {
  try {
    const response = await soapFetch(env, `${creds.orgId}:${creds.endpointUrl}`, {
      url: creds.endpointUrl,
      body: buildSoapEnvelope({ operationBody: body }),
      soapAction: operation,
      headers: cookie ? { Cookie: cookie } : undefined,
      priority,
      // Per-org client certificate resolved by getEfsSoapCredentials; undefined means "fall back to
      // the deploy-wide env material", which is what a single-tenant install uses.
      tls: creds.tls,
      fetchImpl,
      retry,
    });
    if (response.status === 401 || response.status === 403) {
      throw new EfsSoapError(`EFS rejected the ${operation} request`, "auth", response.status);
    }
    // EFS may return a SOAP Fault with HTTP 500. Parse the body before classifying the status so the
    // caller receives the documented fault code/message instead of an opaque transport error.
    parseSoap(response.body);
    if (response.status === 429) {
      throw new EfsSoapError(`EFS rate-limited the ${operation} request`, "rate_limited", response.status);
    }
    if (response.status >= 400) {
      throw new EfsSoapError(`EFS returned HTTP ${response.status} for ${operation}`, "transport", response.status);
    }
    return { body: response.body, headers: response.headers };
  } catch (error) {
    if (error instanceof EfsSoapError) throw error;
    // A handshake failure is the single most likely mTLS symptom and the least self-explanatory, so
    // it never reaches the operator as a bare "transport" error. classifyTlsError turns an OpenSSL
    // alert code into the action that fixes it.
    const tlsFailure = classifyTlsError(error);
    if (tlsFailure.kind !== "unknown") {
      throw new EfsSoapError(
        `EFS ${operation} failed at the TLS layer: ${tlsFailure.message}`,
        tlsFailure.kind === "network" ? "transport" : "tls",
        { code: tlsFailure.code, kind: tlsFailure.kind },
      );
    }
    throw new EfsSoapError(`EFS ${operation} request failed`, "transport", error);
  }
}

interface EfsSession {
  clientId: string;
  cookie: string | null;
}

function cookieHeader(headers: Headers): string | null {
  const raw = headers.get("set-cookie");
  if (!raw) return null;
  return raw
    .split(/,(?=[^;,]+=)/)
    .map((part) => part.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ") || null;
}

async function login(env: Env, creds: EfsSoapCredentials, priority: SoapPriority, fetchImpl?: typeof fetch): Promise<EfsSession> {
  const body = `<CardManagementEP_login><user>${xmlEscape(creds.soapUsername)}</user><password>${xmlEscape(creds.soapPassword)}</password></CardManagementEP_login>`;
  const response = await requestXml(env, creds, SOAP_ACTIONS.login, body, priority, fetchImpl);
  return { clientId: responseResult(response.body), cookie: cookieHeader(response.headers) };
}

async function logout(env: Env, creds: EfsSoapCredentials, clientId: string, priority: SoapPriority, fetchImpl?: typeof fetch, cookie?: string | null): Promise<void> {
  try {
    await requestXml(env, creds, SOAP_ACTIONS.logout, `<CardManagementEP_logout><clientId>${xmlEscape(clientId)}</clientId></CardManagementEP_logout>`, priority, fetchImpl, false, cookie);
  } catch {
    // Session cleanup is best effort; never hide a successful data response behind logout failure.
  }
}

function maxRequestDays(env: Env): number {
  return env.EFS_SOAP_MAX_DAYS_PER_REQUEST ?? 30;
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

async function fetchFeed(env: Env, creds: EfsSoapCredentials, feed: FeedName, cursor: string | null, opts: EfsSoapFetchOptions): Promise<EfsSoapFetchResult> {
  const { start, end } = dateWindow(env, cursor);
  const priority = opts.priority ?? (feed === "posted" ? "backfill" : "live");
  const maxPages = Math.max(1, opts.maxPages ?? 1);
  const session = await login(env, creds, priority, opts.fetchImpl);
  const rows: Record<string, string | number | null>[] = [];
  const responseHash = createHash("sha256");
  let pageStart = start;
  let pagesFetched = 0;
  let nextCursor = cursor;
  try {
    while (pagesFetched < maxPages && pageStart < end) {
      // EFS confirmed a 30-day maximum for this production account. The cursor lets a bounded poll
      // walk a larger initial backfill over multiple scheduler/manual runs.
      const pageEnd = new Date(Math.min(
        pageStart.getTime() + maxRequestDays(env) * 24 * 60 * 60 * 1000,
        end.getTime(),
      ));
      const body = feed === "posted"
        ? `<CardManagementEP_getMCTransExtLocV2><clientId>${xmlEscape(session.clientId)}</clientId><begDate>${isoDateTime(pageStart)}</begDate><endDate>${isoDateTime(pageEnd)}</endDate></CardManagementEP_getMCTransExtLocV2>`
        : `<CardManagementEP_getTranRejects><clientId>${xmlEscape(session.clientId)}</clientId><search><startDate>${isoDateTime(pageStart)}</startDate><endDate>${isoDateTime(pageEnd)}</endDate><cardNum></cardNum><invoice></invoice><locationId>0</locationId></search></CardManagementEP_getTranRejects>`;
      const response = await requestXml(env, creds, SOAP_ACTIONS[feed], body, priority, opts.fetchImpl, true, session.cookie);
      responseHash.update(response.body);
      const values = responseValues(response.body);
      rows.push(...(feed === "posted" ? transactionRows(values) : rejectedRows(values)));
      pagesFetched += 1;
      nextCursor = pageEnd.toISOString();
      pageStart = pageEnd;
    }
    return {
      rows,
      nextCursor,
      responseHash: responseHash.digest("hex"),
      pagesFetched,
    };
  } finally {
    await logout(env, creds, session.clientId, priority, opts.fetchImpl, session.cookie);
  }
}


/** Every session and data request goes through soapFetch, so pacing applies to login, feed calls,
 * and logout as one credential-scoped sequence. */


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

// Re-export soap-layer primitives so importers don't need two imports.
export { buildWsSecurityUsernameTokenHeader, soapFetch };
