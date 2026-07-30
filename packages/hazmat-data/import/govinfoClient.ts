/**
 * GovInfo API client (Phase H1) — the official-legal-edition fetch layer.
 *
 * A Node-only, dependency-free typed client for the GovInfo public REST API
 * (https://api.govinfo.gov, docs: https://github.com/usgpo/api). Requires an api.data.gov key,
 * read from `GOVINFO_API_KEY` unless one is passed explicitly.
 *
 * GovInfo's role per D5 v5 (official sources only): it publishes the CFR **annual print edition** —
 * the officially published *legal* version of Title 49 — as PDF + XML + MODS. eCFR (the other client)
 * is the continuously-updated *unofficial* compilation. So GovInfo gives us three things:
 *   1. the official legal PDF the human transcriber reads from (Source B input),
 *   2. an auditable provenance anchor (package/granule id, dateIssued, lastModified, links),
 *   3. an independent XML rendering for the optional cross-check tripwire.
 * It is NOT a fully-independent automated second source on its own (it shares the OFR origin with
 * eCFR); the human transcription remains the second source of record for the in-scope launch set.
 *
 * SECURITY: the api_key is a secret. It is appended to the request URL (as the API requires), but
 * this client NEVER lets a URL containing the key reach an error message, a log line, or a thrown
 * value — every surfaced URL is passed through `redactKey()` first.
 *
 * Response shapes below follow GPO's published API documentation; the smoke script (`govinfoSmoke.ts`,
 * run with a real key) is what confirms them against the live service, and the offline tests pin them.
 */

export const GOVINFO_BASE_URL = "https://api.govinfo.gov";

// ── response shapes (per GPO docs; confirmed by the smoke script) ─────────────
export interface GovInfoCollection {
  collectionCode: string;
  collectionName: string;
  packageCount: number;
  granuleCount: number;
}
export interface CollectionsResponse {
  collections: GovInfoCollection[];
}

/** `/collections/{code}/{start}[/{end}]` — packages modified in a window (offsetMark-paginated). */
export interface CollectionUpdatesResponse {
  packageIds?: string[];
  /** Some deployments return objects instead of bare ids; tolerated. */
  packages?: Array<{ packageId: string; lastModified?: string; dateIssued?: string; title?: string }>;
  nextPage: string | null;
  count?: number;
}

export interface GovInfoDownload {
  pdfLink?: string;
  xmlLink?: string;
  modsLink?: string;
  premisLink?: string;
  txtLink?: string;
  zipLink?: string;
}

/** `/packages/{packageId}/summary`. Permissive — CFR adds fields (cfrTitle, volume, …) we don't require. */
export interface PackageSummary {
  packageId: string;
  title?: string;
  dateIssued?: string;
  lastModified?: string;
  collectionCode?: string;
  collectionName?: string;
  category?: string;
  branch?: string;
  detailsLink?: string;
  granulesLink?: string;
  download?: GovInfoDownload;
  [key: string]: unknown;
}

export interface GranuleRef {
  granuleId: string;
  title?: string;
  granuleClass?: string;
  granuleLink?: string;
}
export interface GranulesResponse {
  granules: GranuleRef[];
  nextPage: string | null;
  count?: number;
  offsetMark?: string;
}

export interface GranuleSummary extends PackageSummary {
  granuleId: string;
}

export interface PublishedResponse {
  count?: number;
  packages: Array<{ packageId: string; title?: string; dateIssued?: string; lastModified?: string; docClass?: string; [key: string]: unknown }>;
  nextPage: string | null;
}

export type GovInfoContentType = "pdf" | "xml" | "htm" | "mods" | "premis" | "zip" | "txt";

// ── errors ────────────────────────────────────────────────────────────────────
export class GovInfoApiError extends Error {
  constructor(
    readonly status: number,
    /** URL with the api_key already redacted — safe to log. */
    readonly safeUrl: string,
    message: string,
  ) {
    super(message);
    this.name = "GovInfoApiError";
  }
}

// ── options ────────────────────────────────────────────────────────────────────
export interface GovInfoClientOptions {
  /** api.data.gov key. Defaults to process.env.GOVINFO_API_KEY. */
  apiKey?: string;
  baseUrl?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryBaseMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_UA = "FuelGuard-HazmatGuard/0.1 (+regulatory dataset importer; contact: ops@fuelguard)";
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Replace the api_key value in a URL string with REDACTED — used everywhere a URL might be surfaced. */
export function redactKey(url: string): string {
  return url.replace(/([?&]api_key=)[^&]*/i, "$1REDACTED");
}

export class GovInfoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: GovInfoClientOptions = {}) {
    const key = opts.apiKey ?? (typeof process !== "undefined" ? process.env["GOVINFO_API_KEY"] : undefined);
    if (!key) {
      throw new Error(
        "GovInfo API key missing — set GOVINFO_API_KEY in the environment or pass { apiKey } to GovInfoClient.",
      );
    }
    this.apiKey = key;
    this.baseUrl = (opts.baseUrl ?? GOVINFO_BASE_URL).replace(/\/+$/, "");
    this.userAgent = opts.userAgent ?? DEFAULT_UA;
    const f = opts.fetchImpl ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new Error("No fetch implementation available — pass opts.fetchImpl on Node < 18.");
    }
    this.fetchImpl = f;
    this.maxRetries = opts.maxRetries ?? 4;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ── collections ──────────────────────────────────────────────────────────────
  getCollections(): Promise<CollectionsResponse> {
    return this.json<CollectionsResponse>("/collections", {});
  }

  /** Packages in a collection modified since `startIso` (ISO 8601, e.g. 2025-01-01T00:00:00Z). */
  getCollectionUpdates(
    code: string,
    startIso: string,
    opts: { endIso?: string; pageSize?: number; offsetMark?: string } = {},
  ): Promise<CollectionUpdatesResponse> {
    const path = opts.endIso
      ? `/collections/${code}/${startIso}/${opts.endIso}`
      : `/collections/${code}/${startIso}`;
    return this.json<CollectionUpdatesResponse>(path, {
      offsetMark: opts.offsetMark ?? "*",
      pageSize: String(opts.pageSize ?? 100),
    });
  }

  // ── published ────────────────────────────────────────────────────────────────
  getPublished(
    startDate: string,
    endDate: string,
    opts: { collection: string; pageSize?: number; offsetMark?: string; docClass?: string; modifiedSince?: string },
  ): Promise<PublishedResponse> {
    const query: Record<string, string> = {
      collection: opts.collection,
      offsetMark: opts.offsetMark ?? "*",
      pageSize: String(opts.pageSize ?? 100),
    };
    if (opts.docClass) query["docClass"] = opts.docClass;
    if (opts.modifiedSince) query["modifiedSince"] = opts.modifiedSince;
    return this.json<PublishedResponse>(`/published/${startDate}/${endDate}`, query);
  }

  // ── packages ─────────────────────────────────────────────────────────────────
  getPackageSummary(packageId: string): Promise<PackageSummary> {
    return this.json<PackageSummary>(`/packages/${packageId}/summary`, {});
  }
  /** Returns null on 404 rather than throwing — for existence probes (year/volume resolution). */
  tryGetPackageSummary(packageId: string): Promise<PackageSummary | null> {
    return this.jsonOrNull<PackageSummary>(`/packages/${packageId}/summary`, {});
  }
  /** Text content (xml / mods / htm / txt). */
  getPackageContent(packageId: string, type: GovInfoContentType): Promise<string> {
    return this.text(`/packages/${packageId}/${type}`, {});
  }
  /** Binary content (pdf / zip) as bytes. */
  getPackageContentBytes(packageId: string, type: GovInfoContentType): Promise<Uint8Array> {
    return this.bytes(`/packages/${packageId}/${type}`, {});
  }

  // ── granules ─────────────────────────────────────────────────────────────────
  getGranules(packageId: string, opts: { pageSize?: number; offsetMark?: string } = {}): Promise<GranulesResponse> {
    return this.json<GranulesResponse>(`/packages/${packageId}/granules`, {
      offsetMark: opts.offsetMark ?? "*",
      pageSize: String(opts.pageSize ?? 100),
    });
  }
  getGranuleSummary(packageId: string, granuleId: string): Promise<GranuleSummary> {
    return this.json<GranuleSummary>(`/packages/${packageId}/granules/${granuleId}/summary`, {});
  }
  tryGetGranuleSummary(packageId: string, granuleId: string): Promise<GranuleSummary | null> {
    return this.jsonOrNull<GranuleSummary>(`/packages/${packageId}/granules/${granuleId}/summary`, {});
  }
  getGranuleContent(packageId: string, granuleId: string, type: GovInfoContentType): Promise<string> {
    return this.text(`/packages/${packageId}/granules/${granuleId}/${type}`, {});
  }
  getGranuleContentBytes(packageId: string, granuleId: string, type: GovInfoContentType): Promise<Uint8Array> {
    return this.bytes(`/packages/${packageId}/granules/${granuleId}/${type}`, {});
  }

  // ── transport ────────────────────────────────────────────────────────────────
  private async json<T>(path: string, query: Record<string, string>): Promise<T> {
    const res = await this.request(path, query, "application/json");
    return (await res.json()) as T;
  }
  private async jsonOrNull<T>(path: string, query: Record<string, string>): Promise<T | null> {
    const res = await this.request(path, query, "application/json", { allow404: true });
    if (res.status === 404) return null;
    return (await res.json()) as T;
  }
  private async text(path: string, query: Record<string, string>): Promise<string> {
    const res = await this.request(path, query, "application/xml");
    return res.text();
  }
  private async bytes(path: string, query: Record<string, string>): Promise<Uint8Array> {
    const res = await this.request(path, query, "application/octet-stream");
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Build the full URL with api_key appended. */
  private buildUrl(path: string, query: Record<string, string>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    url.searchParams.set("api_key", this.apiKey);
    return url.toString();
  }

  private async request(
    path: string,
    query: Record<string, string>,
    accept: string,
    opts: { allow404?: boolean } = {},
  ): Promise<Response> {
    const url = this.buildUrl(path, query);
    const safeUrl = redactKey(url);
    let lastErr: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: "GET",
          headers: { "User-Agent": this.userAgent, Accept: accept },
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.ok) return res;
        if (opts.allow404 && res.status === 404) return res;

        if (RETRYABLE_STATUS.has(res.status) && attempt < this.maxRetries) {
          await this.sleep(this.backoffMs(attempt, res.headers.get("retry-after")));
          continue;
        }
        throw new GovInfoApiError(res.status, safeUrl, `GovInfo ${res.status} for ${safeUrl}`);
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof GovInfoApiError) throw err;
        lastErr = err;
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoffMs(attempt, null));
          continue;
        }
      }
    }
    // Never include the raw error if it might carry the URL+key; stringify defensively + redact.
    throw new GovInfoApiError(0, safeUrl, `GovInfo request failed after ${this.maxRetries + 1} attempts: ${redactKey(String(lastErr))}`);
  }

  private backoffMs(attempt: number, retryAfter: string | null): number {
    if (retryAfter) {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
      const when = Date.parse(retryAfter);
      if (Number.isFinite(when)) return Math.max(0, when - Date.now());
    }
    return this.retryBaseMs * 2 ** attempt;
  }
}
