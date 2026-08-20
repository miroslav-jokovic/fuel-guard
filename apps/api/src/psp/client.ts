import {
  describeError,
  needsOperatorAction,
  parsePspReport,
  type PspReport,
  type PspRequestDraft,
} from "@fuelguard/shared";
import { pspApiKey, pspApiKeyVar, type Env } from "../env.js";

/**
 * The FMCSA PSP vendor edge, and nothing else (HIRING-PLAN H7 / PSP-PLAN P4).
 *
 * ── THREE PROPERTIES THAT ARE STRUCTURAL RATHER THAN REMEMBERED ─────────────────────────────────
 *
 * 1. **`POST /Records` is never retried.** There is no idempotency header, and nothing in the guide
 *    says PSP de-duplicates on `internalRefId`. A connection reset after PSP processed the request is
 *    indistinguishable from one before it, and §8 has already charged us either way. So a transport
 *    failure returns `indeterminate` for a human rather than trying again — and that is a property of
 *    this module, not a policy a caller passes in and might forget.
 *
 * 2. **`GET /Token` is not called by anything automatic.** §4.3: "A new token was created and
 *    returned." It MINTS. The guide never says whether minting invalidates the current token, so a
 *    connectivity check that used it could take the integration down. `renewToken` exists, it is
 *    exported, and its own comment says who may call it: a human doing a deliberate rotation.
 *
 * 3. **HTTP status and body status are BOTH checked, and neither is assumed.** `GET /DayMonitored45`
 *    answers a bad key with a real HTTP 401 (observed 2026-08-19), while §8 puts record-request
 *    outcomes in the body of a 200. PSP is neither uniformly REST-shaped nor uniformly
 *    SambaSafety-shaped, so the client reads both and lets the caller see what it found.
 */

const HOSTS = {
  uat: "https://rest-api.uat.psp.tylerapp.com",
  production: "https://www.psp.fmcsa.dot.gov/PspRestService",
} as const;

export type PspEnvironment = keyof typeof HOSTS;

export class PspNotConfiguredError extends Error {
  /**
   * Names the variable for the environment actually selected, not a generic one. The failure this
   * replaces looked identical whichever key was missing, and "PSP is not configured" sent more than
   * one reader to the wrong file.
   */
  constructor(variable = "PSP_API_KEY_UAT") {
    super(`PSP is not configured: ${variable} is unset`);
    this.name = "PspNotConfiguredError";
  }
}

/**
 * A vendor failure the caller must distinguish from a report.
 *
 * `charged` is the field that matters: `false` means we are confident nothing was billed (PSP
 * refused it, or we never reached them). `null` means we do not know, which is the state a transport
 * failure after dispatch leaves us in and the reason `indeterminate` exists in the ledger.
 */
export class PspError extends Error {
  readonly detail: number | null;
  readonly httpStatus: number | null;
  readonly charged: boolean | null;
  readonly operatorAction: boolean;
  constructor(opts: {
    message: string;
    detail?: number | null;
    httpStatus?: number | null;
    charged: boolean | null;
  }) {
    super(opts.message);
    this.name = "PspError";
    this.detail = opts.detail ?? null;
    this.httpStatus = opts.httpStatus ?? null;
    this.charged = opts.charged;
    this.operatorAction = opts.detail != null && needsOperatorAction(opts.detail);
  }
}

export interface PspClientOptions {
  /** Milliseconds. Generous by default: a slow answer still cost us, so giving up early buys nothing. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface PspRecordsResult {
  report: PspReport;
  /** Kept verbatim — the evidence P7's derived rows are rebuilt from, never re-purchased. */
  raw: unknown;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** PSP wants the date of birth as `M/D/YYYY` (§9.1.1's test data); we hold ISO everywhere else. */
export function toPspDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

export function pspHost(env: Env): string {
  // No `?? "uat"` here: the schema already defaults it, and a second fallback is a second source of
  // truth for the same value — which is what `env.test.ts` refuses. Getting this one wrong is not
  // cosmetic: the two hosts differ by whether a request bills.
  return HOSTS[env.PSP_ENVIRONMENT as PspEnvironment];
}

function apiKey(env: Env): string {
  // The token is chosen BY the environment, so the host and the account it authenticates against
  // cannot disagree. `pspHost` reads the same `PSP_ENVIRONMENT` two lines up.
  const key = pspApiKey(env);
  if (!key) throw new PspNotConfiguredError(pspApiKeyVar(env));
  return key;
}

async function call(
  env: Env,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; accept?: string },
  opts: PspClientOptions,
): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  return doFetch(`${pspHost(env)}${path}`, {
    method: init.method,
    headers: {
      "api-key": apiKey(env),
      accept: init.accept ?? "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
}

/**
 * Request ONE driver record. **This is the call that bills.**
 *
 * One driver, never a batch: §5 says "if there are any validation issues with any of the driver
 * record requests, the entire request is cancelled", so a batch of 200 dies on one bad date of birth.
 * The endpoint takes an array; we send an array of one.
 *
 * The caller is expected to have run `validatePspRequest` already — this does not re-run it, because
 * a client that silently corrected its input could never measure what the input was.
 */
export async function requestRecord(
  env: Env,
  draft: PspRequestDraft,
  opts: PspClientOptions = {},
): Promise<PspRecordsResult> {
  const body = [
    {
      authCode: "",
      dotNumber: draft.dotNumber ?? "",
      driverConsent: draft.driverConsent,
      driverFirstName: draft.driverFirstName,
      driverLastName: draft.driverLastName,
      driverDOB: toPspDate(draft.driverDOB),
      motorCarrierId: draft.motorCarrierId ?? "",
      internalRefId: draft.internalRefId,
      licenseQueries: draft.licenseQueries.map((q) => ({
        dlFirstName: q.dlFirstName,
        dlLastName: q.dlLastName,
        dlNum: q.dlNum,
        dlState: q.dlState.toUpperCase(),
      })),
      userIPAddress: draft.userIPAddress ?? "",
      monitor: draft.monitor === true,
    },
  ];

  // Configuration is checked BEFORE the try, or a missing key comes back through the catch below as
  // `charged: null` — "we do not know whether PSP billed us" — when the truth is that we never left
  // the building. Caught by "refuses to call anything without a key".
  apiKey(env);

  let res: Response;
  try {
    res = await call(env, "/Records", { method: "POST", body }, opts);
  } catch (e) {
    // NOT RETRIED, and `charged: null` is the honest answer: we do not know whether PSP processed it.
    throw new PspError({
      message: `PSP did not answer: ${e instanceof Error ? e.message : String(e)}`,
      charged: null,
    });
  }

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PspError({
      message: `PSP returned a body that is not JSON (HTTP ${res.status})`,
      httpStatus: res.status,
      // We reached them and they answered; whether the transaction landed is unknowable from here.
      charged: null,
    });
  }

  // A validation refusal comes back as an array of `{originalRequest, validationIssues}` (§5.4.2),
  // not as a driver record. It is an Error status, so §8 does not charge for it.
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  const issues = (first as { validationIssues?: unknown })?.validationIssues;
  if (Array.isArray(issues) && issues.length > 0) {
    const detail = Number((issues[0] as { statusDetail?: unknown }).statusDetail ?? NaN);
    throw new PspError({
      message: `PSP rejected the request: ${describeError(detail)}`,
      detail: Number.isFinite(detail) ? detail : null,
      httpStatus: res.status,
      charged: false,
    });
  }

  const report = parsePspReport(first);

  // Status 2 is an Error, and §8 does not bill it — but it is still not a report, so it must not be
  // filed as one. Surfaced as a typed failure here so no `judge` further down has to notice.
  if (report.outcome === "error") {
    const detail = report.statusDetail;
    throw new PspError({
      message: detail == null ? "PSP returned an error" : describeError(detail),
      detail,
      httpStatus: res.status,
      charged: false,
    });
  }

  // An HTTP failure with no usable body: reached them, no record, unknown charge.
  if (!res.ok && report.outcome === "unknown") {
    throw new PspError({
      message: `PSP answered HTTP ${res.status}`,
      httpStatus: res.status,
      charged: null,
    });
  }

  return { report, raw: parsed };
}

/**
 * Fetch the PDF for a record already requested (§7).
 *
 * **Call this in the same job that made the request.** The `authCode` dies after 5 days / 120 hours
 * (§8.5 detail 28), so there is no "download later" — designing one would build an affordance that
 * stops working without telling anybody.
 */
export async function fetchRecordPdf(
  env: Env,
  authCode: string,
  opts: PspClientOptions = {},
): Promise<Buffer> {
  const res = await call(
    env,
    "/Record",
    { method: "POST", body: { authCode, returnType: "PDF" }, accept: "application/pdf" },
    opts,
  );
  const buf = Buffer.from(await res.arrayBuffer());

  // §7.1: "In cases where there is an error, the PDF ReturnType will return a string that starts with
  // 'ERROR'." A client that piped this straight to storage would file a text file with a .pdf name
  // and a perfectly valid sha256. The magic number is the only thing that actually says it is a PDF.
  if (buf.subarray(0, 4).toString("latin1") !== "%PDF") {
    const head = buf.subarray(0, 200).toString("utf8");
    throw new PspError({
      message: `PSP returned no PDF: ${head.slice(0, 120)}`,
      httpStatus: res.status,
      charged: false,
    });
  }
  return buf;
}

export interface PspMonitoredRecord {
  authCode: string;
  lastName: string;
  internalRefId: string;
  timeStamp: string;
  changeDetected: boolean;
}

/**
 * The 45-day monitoring report (§6) — read-only, and the ONLY endpoint that neither bills nor mints.
 * That is what makes it the connectivity probe as well as the poll.
 */
export async function fetchMonitoringReport(
  env: Env,
  opts: PspClientOptions = {},
): Promise<PspMonitoredRecord[]> {
  const res = await call(env, "/DayMonitored45", { method: "GET" }, opts);
  const body = (await res.json().catch(() => null)) as
    | { success?: number; report?: unknown; errorCode?: number; errorDescription?: string }
    | null;

  if (!body || body.success !== 1) {
    // Observed 2026-08-19: a bad key answers HTTP 401 with errorCode 32 here, so both are read.
    throw new PspError({
      message: body?.errorDescription || `PSP monitoring report failed (HTTP ${res.status})`,
      detail: typeof body?.errorCode === "number" ? body.errorCode : null,
      httpStatus: res.status,
      charged: false,
    });
  }
  return (Array.isArray(body.report) ? body.report : []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      authCode: String(row.authCode ?? ""),
      lastName: String(row.lastName ?? ""),
      internalRefId: String(row.internalRefId ?? ""),
      timeStamp: String(row.timeStamp ?? ""),
      changeDetected: row.changeDetected === true,
    };
  });
}

/**
 * Rotate the API token (§4.3). **Nothing automatic may call this.**
 *
 * The response says "A new token was created and returned", and the guide never states whether
 * minting invalidates the current one. So this is a deliberate act by a person who is ready to store
 * the result — never a health check, never a scheduler, and never a retry on a 401. Whoever calls it
 * must persist `token` before the process ends or the integration is down until somebody logs in to
 * PSP behind Login.gov and MFA.
 */
export async function renewToken(env: Env, opts: PspClientOptions = {}): Promise<string> {
  const res = await call(env, "/Token", { method: "GET" }, opts);
  const body = (await res.json().catch(() => null)) as
    | { success?: number; token?: string; errorCode?: number; errorDescription?: string }
    | null;
  if (!body || body.success !== 1 || !body.token) {
    throw new PspError({
      message: body?.errorDescription || `Token renewal failed (HTTP ${res.status})`,
      detail: typeof body?.errorCode === "number" ? body.errorCode : null,
      httpStatus: res.status,
      charged: false,
    });
  }
  return body.token;
}
