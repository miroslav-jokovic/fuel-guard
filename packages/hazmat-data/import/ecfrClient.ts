/**
 * eCFR API client (Phase H1, deliverable 2) — the official-source fetch layer.
 *
 * A Node-only, dependency-free typed client for the eCFR public REST API
 * (https://www.ecfr.gov/developers/documentation/api/v1). No API key is required. This is the
 * PRIMARY source per D5 v5 (official government data only): the eCFR versioner service is the
 * legally authoritative, machine-readable copy of Title 49.
 *
 * Boundary: this client only FETCHES. It never parses regulatory content into dataset rows — that
 * is the parser's job (`parseHmt.ts`), which must run against a captured real XML fixture, never a
 * guessed structure. Keeping fetch and parse separate is what lets the parser be tested offline
 * with frozen fixtures (RELEASING.md step 2).
 *
 * Every response interface below was verified field-by-field against the live API (2026-07); the
 * shapes are pinned by the offline tests in `ecfrClient.test.ts`. If the API drifts, those tests
 * fail loudly rather than a bad shape silently poisoning a downstream parse.
 */

export const ECFR_BASE_URL = "https://www.ecfr.gov";

// ── response shapes (verified against live API 2026-07) ───────────────────────

/** One entry of `/api/versioner/v1/titles.json` — the currency signal per title. */
export interface TitleSummary {
  number: number;
  name: string;
  /** ISO date of the most recent amendment to ANY content in the title. The RELEASING step-1 poll. */
  latest_amended_on: string | null;
  latest_issue_date: string | null;
  /** The date the title's content is current as of — the safe point-in-time date for `full` requests. */
  up_to_date_as_of: string | null;
  reserved: boolean;
}
export interface TitlesResponse {
  titles: TitleSummary[];
  meta?: unknown;
}

/** One entry of `/api/versioner/v1/versions/title-{n}.json` — a dated version of a section/appendix. */
export interface VersionRecord {
  date: string;
  amendment_date: string;
  issue_date: string;
  /** The section or appendix identifier, e.g. "172.101". */
  identifier: string;
  name: string;
  part: string;
  substantive: boolean;
  removed: boolean;
  subpart: string | null;
  title: string;
  type: string;
}
export interface VersionsResponse {
  content_versions: VersionRecord[];
  meta?: unknown;
}

export type EcfrNodeType =
  | "title"
  | "subtitle"
  | "chapter"
  | "subchapter"
  | "part"
  | "subpart"
  | "subject_group"
  | "section"
  | "appendix";

/** A node in `/api/versioner/v1/structure/...` (nested via `children`) or `/ancestry/...` (flat). */
export interface EcfrHierarchyNode {
  identifier: string;
  label: string;
  label_level: string;
  label_description: string;
  reserved: boolean;
  type: EcfrNodeType;
  size: number;
  volumes?: string[];
  received_on?: string;
  generated_id?: string;
  descendant_range?: string;
  children?: EcfrHierarchyNode[];
}
export interface AncestryResponse {
  ancestors: EcfrHierarchyNode[];
}

/** One reference inside an eCFR correction record. */
export interface CorrectionReference {
  cfr_reference: string;
  hierarchy: Record<string, string>;
}
/** One entry of `/api/admin/v1/corrections/title/{n}.json`. */
export interface CorrectionRecord {
  id: number;
  cfr_references: CorrectionReference[];
  corrective_action: string;
  error_corrected: string | null;
  error_occurred: string | null;
  fr_citation: string | null;
  position: number;
  display_in_toc: boolean;
  title: number;
  year: number;
  last_modified: string;
}
export interface CorrectionsResponse {
  ecfr_corrections: CorrectionRecord[];
}

/**
 * A CFR subset selector — the query parameters the versioner accepts to narrow a request below the
 * title level. Passed to `full`, `versions`, and `ancestry`. All optional; provide the deepest ones
 * you need (e.g. `{ section: "172.101" }`).
 */
export interface CfrSubset {
  subtitle?: string;
  chapter?: string;
  subchapter?: string;
  part?: string;
  subpart?: string;
  subjectGroup?: string;
  section?: string;
  appendix?: string;
}

// ── errors ────────────────────────────────────────────────────────────────────

/** A non-retryable HTTP failure (4xx) or a retry-exhausted failure — carries the status + URL. */
export class EcfrApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "EcfrApiError";
  }
}

// ── client ────────────────────────────────────────────────────────────────────

export interface EcfrClientOptions {
  /** Override the base URL (tests point this at a fake). Default https://www.ecfr.gov */
  baseUrl?: string;
  /** Sent on every request — the eCFR asks callers to identify themselves. */
  userAgent?: string;
  /** Inject a fetch implementation (tests). Defaults to the global fetch (Node 18+). */
  fetchImpl?: typeof fetch;
  /** Max retry attempts on a retryable failure (429/5xx/network/timeout). Default 4. */
  maxRetries?: number;
  /** Base backoff in ms; delay = retryBaseMs * 2^attempt (deterministic — no jitter). Default 500. */
  retryBaseMs?: number;
  /** Per-request timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** Injectable sleep (tests pass a no-op to avoid real waits). */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_UA = "FuelGuard-HazmatGuard/0.1 (+regulatory dataset importer; contact: ops@fuelguard)";
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class EcfrClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: EcfrClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? ECFR_BASE_URL).replace(/\/+$/, "");
    this.userAgent = opts.userAgent ?? DEFAULT_UA;
    // Bind so a passed global fetch keeps its receiver.
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

  // ── versioner ──────────────────────────────────────────────────────────────

  /** Summary of every CFR title, incl. `latest_amended_on` / `up_to_date_as_of`. */
  async getTitles(): Promise<TitlesResponse> {
    return this.requestJson<TitlesResponse>("/api/versioner/v1/titles.json");
  }

  /** The summary for one title. Throws if the number is absent (e.g. a bad title). */
  async getTitleSummary(title: number): Promise<TitleSummary> {
    const { titles } = await this.getTitles();
    const found = titles.find((t) => t.number === title);
    if (!found) {
      throw new Error(`Title ${title} not present in eCFR titles.json`);
    }
    return found;
  }

  /** Every dated version of every section/appendix in a title, optionally narrowed by subset. */
  async getVersions(title: number, subset: CfrSubset = {}): Promise<VersionsResponse> {
    const qs = buildSubsetQuery(subset);
    return this.requestJson<VersionsResponse>(`/api/versioner/v1/versions/title-${title}.json${qs}`);
  }

  /** The nested structure tree of a title at a point in time. */
  async getStructure(date: string, title: number): Promise<EcfrHierarchyNode> {
    return this.requestJson<EcfrHierarchyNode>(`/api/versioner/v1/structure/${date}/title-${title}.json`);
  }

  /** The ancestor chain (title → … → section) for a subset at a point in time. */
  async getAncestry(date: string, title: number, subset: CfrSubset = {}): Promise<AncestryResponse> {
    const qs = buildSubsetQuery(subset);
    return this.requestJson<AncestryResponse>(`/api/versioner/v1/ancestry/${date}/title-${title}.json${qs}`);
  }

  /**
   * The source XML for a title or (with a subset) a part/subpart/section/appendix. Returns the raw
   * XML string — deliberately NOT parsed here. This is the raw material the parser consumes.
   */
  async getFullXml(date: string, title: number, subset: CfrSubset = {}): Promise<string> {
    const qs = buildSubsetQuery(subset);
    return this.requestText(`/api/versioner/v1/full/${date}/title-${title}.xml${qs}`, "application/xml");
  }

  // ── admin ────────────────────────────────────────────────────────────────────

  /** Every eCFR correction across all titles. */
  async getCorrections(): Promise<CorrectionsResponse> {
    return this.requestJson<CorrectionsResponse>("/api/admin/v1/corrections.json");
  }

  /** Corrections for one title — the audit signal that a shipped row may need a re-check. */
  async getCorrectionsForTitle(title: number): Promise<CorrectionsResponse> {
    return this.requestJson<CorrectionsResponse>(`/api/admin/v1/corrections/title/${title}.json`);
  }

  // ── transport ────────────────────────────────────────────────────────────────

  private async requestJson<T>(path: string): Promise<T> {
    const res = await this.request(path, "application/json");
    return (await res.json()) as T;
  }

  private async requestText(path: string, accept: string): Promise<string> {
    const res = await this.request(path, accept);
    return res.text();
  }

  /**
   * One request with timeout + bounded retry. Retries on network error, timeout, 429 and 5xx (honoring
   * `Retry-After` when present); 4xx (other than 429) fail fast — a bad path should not be hammered.
   */
  private async request(path: string, accept: string): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
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

        if (RETRYABLE_STATUS.has(res.status) && attempt < this.maxRetries) {
          await this.sleep(this.backoffMs(attempt, res.headers.get("retry-after")));
          continue;
        }
        throw new EcfrApiError(res.status, url, `eCFR ${res.status} for ${url}`);
      } catch (err) {
        clearTimeout(timer);
        // A thrown EcfrApiError from a non-retryable status: surface it as-is.
        if (err instanceof EcfrApiError) throw err;
        // Network failure or abort/timeout: retry until exhausted.
        lastErr = err;
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoffMs(attempt, null));
          continue;
        }
      }
    }
    throw new EcfrApiError(0, url, `eCFR request failed after ${this.maxRetries + 1} attempts: ${String(lastErr)}`);
  }

  /** Exponential backoff, or the server's `Retry-After` (seconds or HTTP-date) when it gives one. */
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

// ── helpers ────────────────────────────────────────────────────────────────────

/** Build the `?part=…&section=…` query for a subset selector (only defined keys, API-cased). */
export function buildSubsetQuery(subset: CfrSubset): string {
  const map: Array<[keyof CfrSubset, string]> = [
    ["subtitle", "subtitle"],
    ["chapter", "chapter"],
    ["subchapter", "subchapter"],
    ["part", "part"],
    ["subpart", "subpart"],
    ["subjectGroup", "subject_group"],
    ["section", "section"],
    ["appendix", "appendix"],
  ];
  const params = new URLSearchParams();
  for (const [key, apiKey] of map) {
    const value = subset[key];
    if (value != null && value !== "") params.set(apiKey, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
