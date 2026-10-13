import { z } from "zod";

/**
 * The Med-Stop HTTP client (MEDSTOP-PLAN.md §2, §5A). Nothing outside this module parses a Med-Stop
 * payload (D-ARC1): the rows leave here already mapped to the mirror's columns.
 *
 * Every convention below was MEASURED against the live account on 2026-10-13, not read off the
 * spec — the spec has no response schemas at all (§2.1.2):
 *
 * ── ⚠ 1. A LIST LIVES IN `rows[0]`, AND "NOTHING FOUND" IS A 404 ──────────────────────────────
 * Paging is `data.{page,pagemax,records}`; `pagesize` must be 5–100 here (4 → 400). An empty list
 * answers 404 (the guide) — that is "no rows", never an error, and treating it as one would turn a
 * carrier with no open selections into a failed sweep.
 *
 * ── ⚠ 2. 401 MEANS THREE THINGS AND THE CLIENT CANNOT TELL WHICH ──────────────────────────────
 * A wrong key, an expired key and (until 2026-10-13, Q-MS7) an IP filter evaluating Cloudflare's
 * address all answered the same byte-identical 401. So `auth` is reported as "Med-Stop refused the
 * key" with the expiry date beside it, never as "the key is wrong".
 *
 * ── ⚠ 3. A 403 MAY NOT BE JSON ────────────────────────────────────────────────────────────────
 * An address Med-Stop's firewall does not know gets an HTML "Access Denied" page; a key without the
 * security group gets a JSON 403 `AUTHORIZATION_NORIGHTS`. Two different fixes, so two kinds.
 * Cloudflare also refuses a default curl User-Agent, so every request names itself.
 *
 * ── ⚠ 4. 100 REQUESTS A MINUTE, 429 WITH NO `Retry-After` ─────────────────────────────────────
 * The guide says back off about a minute. A full sweep is ~25 pages, so pages are paced at 650 ms
 * and a 429 waits 60 s, at most twice.
 */

export type MedstopErrorKind = "auth" | "forbidden" | "ip_refused" | "rate_limited" | "validation" | "server" | "transport";

export class MedstopError extends Error {
  constructor(
    message: string,
    readonly kind: MedstopErrorKind,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "MedstopError";
  }
  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "server" || this.kind === "transport";
  }
}

export interface MedstopClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  pageDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const USER_AGENT = "Silvicom360/1.0 (+https://silvicom360.com)";
const PAGE_SIZE = 100;
const RATE_LIMIT_WAIT_MS = 60_000;

const listEnvelope = z.looseObject({
  data: z.looseObject({ pagemax: z.coerce.number().int().min(0) }).optional(),
  rows: z.array(z.array(z.unknown())).optional(),
});

export class MedstopClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly pageDelayMs: number;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Requests made, for the sweep's record. */
  requests = 0;

  constructor(opts: MedstopClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.pageDelayMs = opts.pageDelayMs ?? 650;
    this.doFetch = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** One GET; `null` for Med-Stop's "nothing found" 404. */
  private async get(path: string): Promise<unknown | null> {
    let attempt = 0;
    for (;;) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let error: MedstopError;
      try {
        this.requests++;
        const res = await this.doFetch(`${this.baseUrl}${path}`, {
          headers: { Authorization: `ApiKey ${this.apiKey}`, Accept: "application/json", "User-Agent": USER_AGENT },
          signal: controller.signal,
        });
        const text = await res.text();
        const body = parseJson(text);
        if (res.ok) {
          if (body === undefined) throw new MedstopError(`Med-Stop answered ${res.status} with a body that is not JSON`, "validation", res.status);
          return body;
        }
        if (res.status === 404) return null;
        error = errorFor(res.status, body);
      } catch (e) {
        if (e instanceof MedstopError) throw e;
        error = new MedstopError(
          controller.signal.aborted ? `Med-Stop did not answer within ${this.timeoutMs} ms` : e instanceof Error ? e.message : String(e),
          "transport",
          null,
        );
      } finally {
        clearTimeout(timer);
      }
      if (!error.retryable || attempt > this.maxRetries) throw error;
      await this.sleep(error.kind === "rate_limited" ? RATE_LIMIT_WAIT_MS : 2_000 * attempt);
    }
  }

  /** Every row of a list, page by page. `cap` bounds a list that would otherwise walk for ever. */
  async list<T>(path: string, row: z.ZodType<T>, cap = 5_000): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1, pagemax = 1; page <= pagemax && out.length < cap; page++) {
      if (page > 1) await this.sleep(this.pageDelayMs);
      const sep = path.includes("?") ? "&" : "?";
      const body = await this.get(`${path}${sep}page=${page}&pagesize=${PAGE_SIZE}`);
      if (body === null) break;
      const env = listEnvelope.safeParse(body);
      if (!env.success) throw new MedstopError(`Med-Stop list ${path} did not have the paging envelope`, "validation", 200);
      pagemax = env.data.data?.pagemax ?? 1;
      for (const raw of env.data.rows?.[0] ?? []) {
        const parsed = row.safeParse(raw);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          throw new MedstopError(`Med-Stop ${path} row did not match: ${issue?.path.join(".")} ${issue?.message}`, "validation", 200);
        }
        out.push(parsed.data);
      }
    }
    return out;
  }
}

function parseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function errorFor(status: number, body: unknown): MedstopError {
  if (status === 401) return new MedstopError("Med-Stop refused the API key (401)", "auth", status);
  if (status === 403) {
    return body === undefined
      ? new MedstopError("Med-Stop's firewall refused this server's address (403, not JSON)", "ip_refused", status)
      : new MedstopError("The key is valid but its security groups do not allow this call (403)", "forbidden", status);
  }
  if (status === 429) return new MedstopError("Med-Stop rate limit reached (429)", "rate_limited", status);
  if (status >= 500) return new MedstopError(`Med-Stop answered ${status}`, "server", status);
  return new MedstopError(`Med-Stop refused the request (${status})`, "validation", status);
}

// ── The rows we read, and only the fields we keep ─────────────────────────────────────────────────
// Loose objects: Med-Stop adds fields freely (4.9.x), and a new field must never fail a sweep.
const str = z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : null));
const day = z.string().nullish().transform((v) => (v ? v.slice(0, 10) : null));
const num = z.union([z.number(), z.string()]).nullish().transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)));

export const medstopEmployeeRow = z.looseObject({
  id: z.string(),
  fname: str,
  lname: str,
  birthdate: day,
  license: str,
  licensestate: str,
  dotstatus: str,
  status: str,
  applicationdate: day,
  hiredate: day,
  terminationdate: day,
  lastdrug: day,
  lastalcohol: day,
  medexpiration: day,
});
export type MedstopEmployeeRow = z.infer<typeof medstopEmployeeRow>;

export const medstopPoolRow = z.looseObject({
  id: z.string(),
  name: str,
  service: z.string(),
  category: str,
  dotstatus: str,
  poolyear: z.coerce.number().int(),
  startdate: day,
  enddate: day,
  frequency: str,
  targetpercent: num,
  currentpercent: num,
  members: num,
  membersavg: num,
  completedtests: num,
  scheduledtests: num,
  status: str,
});
export type MedstopPoolRow = z.infer<typeof medstopPoolRow>;

export const medstopSelectionRow = z.looseObject({
  id: z.string(),
  poolid: str,
  eeid: str,
  service: str,
  selectiondate: day,
  requestid: str,
  requestdate: day,
  testid: str,
  testdate: day,
  status: str,
});
export type MedstopSelectionRow = z.infer<typeof medstopSelectionRow>;

// ── MS2: requests, tests, and a test's status trail (§5A shapes, measured 2026-10-13) ─────────────
// Zoneless local stamps are kept to the second and passed through as written; the mirror stores
// them as `timestamp` without a zone, because nobody has told us Med-Stop's.
const stamp = z.string().nullish().transform((v) => (v && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v) ? v.slice(0, 19) : null));

export const medstopRequestRow = z.looseObject({
  id: z.string(),
  eeid: str,
  service: str,
  category: str,
  reason: str,
  observed: str,
  dotstatus: str,
  requestdate: stamp,
  payment: str,
  location: str,
  testid: str,
  testdate: stamp,
  status: str,
});
export type MedstopRequestRow = z.infer<typeof medstopRequestRow>;

export const medstopTestRow = z.looseObject({
  id: z.string(),
  eeid: str,
  service: str,
  category: str,
  reason: str,
  dotstatus: str,
  collectiondate: stamp,
  result: str,
  location: str,
  status: str,
});
export type MedstopTestRow = z.infer<typeof medstopTestRow>;

/** One step of `/Test/{id}/status` — Med-Stop answers it newest first. */
export const medstopTestStageRow = z.looseObject({
  status: z.string(),
  created: stamp,
});
export type MedstopTestStageRow = z.infer<typeof medstopTestStageRow>;
