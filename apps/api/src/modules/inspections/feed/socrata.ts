/**
 * data.transportation.gov's Socrata API, as the FMCSA feed uses it (INSPECTION-CHALLENGE-PLAN IC1).
 *
 * ── TWO ENDPOINTS ─────────────────────────────────────────────────────────────────────────────
 * `/resource/{id}.json` returns rows (SoQL `$where`, `$order`, `$limit`, `$offset`); every value
 * arrives as a string, which is why rows are stored as received and typed only by the projector.
 * `/api/views/{id}.json` returns the dataset's metadata, of which we keep `rowsUpdatedAt` (epoch
 * seconds): when FMCSA last published, which is the freshness fact a stale feed is judged by.
 *
 * ── PAGING IS ORDERED ─────────────────────────────────────────────────────────────────────────
 * `$order=:id` (Socrata's internal row id) on every page. Without an order, offset paging over a
 * dataset that republishes mid-walk may skip or repeat a row, and a skipped row in a COMPLETE
 * snapshot is recorded as a vanish.
 *
 * ── FAILURE IS LOUD ───────────────────────────────────────────────────────────────────────────
 * 429, 5xx and network errors are retried twice with backoff; anything else, or a third failure,
 * throws `SocrataError` with the status. A body that is not a JSON array is an error, never `[]`:
 * the caller would otherwise record an empty snapshot.
 */
import type { FmcsaDataset, FmcsaScope } from "@silvicom/shared";

export const SOCRATA_BASE = "https://data.transportation.gov";
/** Rows per page. Socrata accepts up to 50,000; our largest dataset is ~2,800 rows. */
export const PAGE_SIZE = 5000;
/**
 * Inspection ids per `in (…)` request. 200 ids is ~2.4 KB of URL, well under every proxy's limit;
 * the 2026-09 `.in()` overflow (Node 22's 16 KB header cap) was a PostgREST URL ten times longer.
 */
export const ID_CHUNK = 200;
const RETRY_DELAYS_MS = [2_000, 8_000];
const TIMEOUT_MS = 60_000;

export class SocrataError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "SocrataError";
  }
}

export interface SocrataClientOptions {
  appToken?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
}

export class SocrataClient {
  /** Requests made, retries included — recorded on the run. */
  requestCount = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly baseUrl: string;

  constructor(private readonly opts: SocrataClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.baseUrl = opts.baseUrl ?? SOCRATA_BASE;
  }

  /** When FMCSA last published the dataset, or null when the metadata does not say. */
  async rowsUpdatedAt(dataset: FmcsaDataset): Promise<Date | null> {
    const meta = await this.getJson(`${this.baseUrl}/api/views/${dataset}.json`);
    const s = (meta as { rowsUpdatedAt?: unknown } | null)?.rowsUpdatedAt;
    return typeof s === "number" && Number.isFinite(s) ? new Date(s * 1000) : null;
  }

  /** Every row matching `where`, walked page by page in `:id` order. */
  async rows(dataset: FmcsaDataset, where: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const q = new URLSearchParams({
        $where: where,
        $order: ":id",
        $limit: String(PAGE_SIZE),
        $offset: String(offset),
      });
      const page = await this.getJson(`${this.baseUrl}/resource/${dataset}.json?${q}`);
      if (!Array.isArray(page)) throw new SocrataError(`${dataset}: the response is not a JSON array`, null);
      out.push(...(page as Record<string, unknown>[]));
      if (page.length < PAGE_SIZE) return out;
    }
  }

  private async getJson(url: string): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.opts.appToken) headers["X-App-Token"] = this.opts.appToken;
    for (let attempt = 0; ; attempt++) {
      this.requestCount++;
      let status: number | null = null;
      let reason: string;
      try {
        const res = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
        status = res.status;
        if (res.ok) return await res.json();
        reason = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
        if (res.status !== 429 && res.status < 500) throw new SocrataError(reason, status);
      } catch (e) {
        if (e instanceof SocrataError) throw e;
        reason = e instanceof Error ? e.message : String(e);
      }
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw new SocrataError(`${reason} (after ${attempt + 1} attempts)`, status);
      await this.sleep(delay);
    }
  }
}

/** The SoQL `$where` that scopes a dataset to one carrier, or to that carrier's inspection ids. */
export function scopeWhere(scope: FmcsaScope, value: string | readonly string[]): string {
  const lit = (v: string) => {
    // Our ids and USDOT numbers are digits; anything else is refused rather than escaped into SoQL.
    if (!/^\d+$/.test(v)) throw new Error(`not a numeric FMCSA identifier: ${JSON.stringify(v)}`);
    return scope.quoted ? `'${v}'` : v;
  };
  if (scope.by === "dot_number") {
    if (typeof value !== "string") throw new Error("a dot_number scope takes one USDOT number");
    return `dot_number = ${lit(value)}`;
  }
  const ids = typeof value === "string" ? [value] : value;
  if (!ids.length) throw new Error("an inspection_id scope needs at least one id");
  return `inspection_id in (${ids.map(lit).join(", ")})`;
}
