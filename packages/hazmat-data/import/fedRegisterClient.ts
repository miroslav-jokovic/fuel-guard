/**
 * Federal Register API client (Phase H1) — the amendment-monitor fetch layer.
 *
 * Node-only, dependency-free, NO API KEY (the FR API is fully open). Base:
 * https://www.federalregister.gov/api/v1 (docs: federalregister.gov/developers/documentation/api/v1).
 *
 * Role per D5 v5: the CURRENCY tripwire. eCFR/GovInfo tell us what the reg says *now*; the Federal
 * Register tells us what is *about to change* — a PHMSA final or proposed rule amending the HMR, with
 * its effective date. That is what lets a release be re-cut BEFORE an effective date passes rather
 * than discovering the drift after the fact.
 *
 * Response shapes below were verified field-by-field against the live API (2026-07), including a real
 * PHMSA HMR final rule (document 2026-10962). The offline tests pin them.
 */

export const FR_BASE_URL = "https://www.federalregister.gov/api/v1";

// ── response shapes (verified against the live API 2026-07) ───────────────────
export interface FrAgency {
  id: number;
  name: string;
  short_name: string | null;
  slug: string;
  url: string;
  json_url?: string;
  parent_id: number | null;
  description?: string;
  recent_articles_url?: string;
}

/** A reference inside a document's `cfr_references`. NB: `title` is a number, `part` is a string. */
export interface FrCfrReference {
  title: number;
  part: string | null;
  chapter: string | null;
  citation_url: string | null;
}

/** An agency stub as it appears on a document. */
export interface FrAgencyRef {
  raw_name?: string;
  name?: string;
  id?: number;
  slug?: string;
  url?: string;
  json_url?: string;
  parent_id?: number | null;
}

/**
 * A Federal Register document. Search results carry a small default field set; the single-document
 * endpoint returns the full object. Request extra fields on search via `fields`. Permissive by design
 * (the API has many fields we don't use).
 */
export interface FrDocument {
  document_number: string;
  title: string;
  type: string; // "Rule" | "Proposed Rule" | "Notice" | "Presidential Document"
  subtype?: string | null;
  abstract?: string | null;
  action?: string | null;
  citation?: string | null;
  dates?: string | null;
  /** ISO date the rule takes effect, or null (e.g. proposed rules). */
  effective_on?: string | null;
  publication_date?: string;
  comments_close_on?: string | null;
  cfr_references?: FrCfrReference[];
  agencies?: FrAgencyRef[];
  regulation_id_numbers?: string[];
  docket_ids?: string[];
  html_url?: string;
  pdf_url?: string;
  full_text_xml_url?: string;
  significant?: boolean;
  topics?: string[];
  [key: string]: unknown;
}

export interface FrDocumentsResponse {
  count: number;
  description?: string;
  total_pages: number;
  next_page_url: string | null;
  results: FrDocument[];
}

/** FR document type filter CODES (distinct from the human-readable `type` on a result). */
export type FrTypeCode = "RULE" | "PRORULE" | "NOTICE" | "PRESDOCU";

export interface DocumentSearchParams {
  term?: string;
  /** conditions[agencies][] — agency slug(s). */
  agencySlugs?: string[];
  /** conditions[agency_ids][] — numeric agency id(s), e.g. 408 for PHMSA. */
  agencyIds?: number[];
  /** conditions[type][] — RULE / PRORULE / NOTICE / PRESDOCU. */
  types?: FrTypeCode[];
  /** conditions[cfr][title] */
  cfrTitle?: number;
  /** conditions[cfr][part] */
  cfrPart?: string | number;
  publicationDateGte?: string; // conditions[publication_date][gte]
  publicationDateLte?: string;
  effectiveDateGte?: string; // conditions[effective_date][gte]
  effectiveDateLte?: string;
  /** fields[] — request non-default result fields (effective_on, cfr_references, action, …). */
  fields?: string[];
  perPage?: number; // per_page (max 1000)
  page?: number;
  order?: "newest" | "oldest" | "relevance" | "executive_order_number";
}

export class FrApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "FrApiError";
  }
}

export interface FrClientOptions {
  baseUrl?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryBaseMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_UA = "FuelGuard-HazmatGuard/0.1 (+regulatory amendment monitor; contact: ops@fuelguard)";
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Build the `conditions[...]` / `fields[]` query for a document search. */
export function buildDocumentQuery(p: DocumentSearchParams): URLSearchParams {
  const q = new URLSearchParams();
  if (p.term) q.set("conditions[term]", p.term);
  for (const s of p.agencySlugs ?? []) q.append("conditions[agencies][]", s);
  for (const id of p.agencyIds ?? []) q.append("conditions[agency_ids][]", String(id));
  for (const t of p.types ?? []) q.append("conditions[type][]", t);
  if (p.cfrTitle != null) q.set("conditions[cfr][title]", String(p.cfrTitle));
  if (p.cfrPart != null) q.set("conditions[cfr][part]", String(p.cfrPart));
  if (p.publicationDateGte) q.set("conditions[publication_date][gte]", p.publicationDateGte);
  if (p.publicationDateLte) q.set("conditions[publication_date][lte]", p.publicationDateLte);
  if (p.effectiveDateGte) q.set("conditions[effective_date][gte]", p.effectiveDateGte);
  if (p.effectiveDateLte) q.set("conditions[effective_date][lte]", p.effectiveDateLte);
  for (const f of p.fields ?? []) q.append("fields[]", f);
  if (p.perPage != null) q.set("per_page", String(p.perPage));
  if (p.page != null) q.set("page", String(p.page));
  if (p.order) q.set("order", p.order);
  return q;
}

export class FrClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: FrClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? FR_BASE_URL).replace(/\/+$/, "");
    this.userAgent = opts.userAgent ?? DEFAULT_UA;
    const f = opts.fetchImpl ?? globalThis.fetch;
    if (typeof f !== "function") throw new Error("No fetch implementation available — pass opts.fetchImpl on Node < 18.");
    this.fetchImpl = f;
    this.maxRetries = opts.maxRetries ?? 4;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ── agencies ─────────────────────────────────────────────────────────────────
  getAgencies(): Promise<FrAgency[]> {
    return this.json<FrAgency[]>("/agencies.json");
  }
  getAgency(slug: string): Promise<FrAgency> {
    return this.json<FrAgency>(`/agencies/${slug}.json`);
  }

  // ── documents ────────────────────────────────────────────────────────────────
  searchDocuments(params: DocumentSearchParams): Promise<FrDocumentsResponse> {
    return this.json<FrDocumentsResponse>(`/documents.json?${buildDocumentQuery(params).toString()}`);
  }
  getDocument(documentNumber: string, fields: string[] = []): Promise<FrDocument> {
    const q = fields.length ? `?${fieldsQuery(fields)}` : "";
    return this.json<FrDocument>(`/documents/${documentNumber}.json${q}`);
  }
  getDocuments(documentNumbers: string[], fields: string[] = []): Promise<FrDocumentsResponse> {
    const q = fields.length ? `?${fieldsQuery(fields)}` : "";
    return this.json<FrDocumentsResponse>(`/documents/${documentNumbers.join(",")}.json${q}`);
  }
  /** Counts of matching documents grouped by a facet (e.g. "agency", "type", "topic"). */
  getDocumentsFacet(facet: string, params: DocumentSearchParams): Promise<Record<string, unknown>> {
    return this.json<Record<string, unknown>>(`/documents/facets/${facet}?${buildDocumentQuery(params).toString()}`);
  }

  /** Follow `next_page_url` to collect every page (bounded). Returns the flattened results. */
  async searchAllDocuments(params: DocumentSearchParams, maxPages = 20): Promise<FrDocument[]> {
    const out: FrDocument[] = [];
    let res = await this.searchDocuments(params);
    out.push(...res.results);
    for (let page = 1; page < maxPages && res.next_page_url; page++) {
      res = await this.json<FrDocumentsResponse>(res.next_page_url);
      out.push(...res.results);
    }
    return out;
  }

  // ── public inspection (earliest warning — filed, not yet published) ────────────
  getCurrentPublicInspection(): Promise<FrDocumentsResponse> {
    return this.json<FrDocumentsResponse>("/public-inspection-documents/current.json");
  }
  searchPublicInspection(params: DocumentSearchParams): Promise<FrDocumentsResponse> {
    return this.json<FrDocumentsResponse>(`/public-inspection-documents.json?${buildDocumentQuery(params).toString()}`);
  }

  // ── issues ───────────────────────────────────────────────────────────────────
  getIssueTableOfContents(publicationDate: string): Promise<Record<string, unknown>> {
    return this.json<Record<string, unknown>>(`/issues/${publicationDate}.json`);
  }

  // ── transport ────────────────────────────────────────────────────────────────
  private async json<T>(pathOrUrl: string): Promise<T> {
    const res = await this.request(pathOrUrl);
    return (await res.json()) as T;
  }

  private async request(pathOrUrl: string): Promise<Response> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: "GET",
          headers: { "User-Agent": this.userAgent, Accept: "application/json" },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) return res;
        if (RETRYABLE_STATUS.has(res.status) && attempt < this.maxRetries) {
          await this.sleep(this.backoffMs(attempt, res.headers.get("retry-after")));
          continue;
        }
        throw new FrApiError(res.status, url, `Federal Register ${res.status} for ${url}`);
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof FrApiError) throw err;
        lastErr = err;
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoffMs(attempt, null));
          continue;
        }
      }
    }
    throw new FrApiError(0, url, `Federal Register request failed after ${this.maxRetries + 1} attempts: ${String(lastErr)}`);
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

function fieldsQuery(fields: string[]): string {
  const q = new URLSearchParams();
  for (const f of fields) q.append("fields[]", f);
  return q.toString();
}
