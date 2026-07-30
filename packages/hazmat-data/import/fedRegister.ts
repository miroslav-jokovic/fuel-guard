/**
 * Federal Register monitor (Phase H1) — the HMR amendment tripwire (D5 v5 currency).
 *
 * Turns raw FR documents into a small, decision-ready view: which PHMSA rules amend the Hazardous
 * Materials Regulations, which in-scope CFR parts they touch, and — the load-bearing field — when
 * they take EFFECT. The release pipeline (RELEASING.md) uses this to answer "is a change coming that
 * I must re-cut the dataset for, before its effective date passes?".
 *
 * PHMSA is agency id 408 / slug `pipeline-and-hazardous-materials-safety-administration` (verified).
 * The HMR lives in 49 CFR Parts 171–180; the parts our dataset draws from are 172 (HMT, placards,
 * communications), 173 (classification / packing groups / flash points), and 177 (highway carriage /
 * segregation), with 178/180 (packaging) watched too.
 */

import {
  FrClient,
  type DocumentSearchParams,
  type FrDocument,
  type FrTypeCode,
} from "./fedRegisterClient.js";

export const PHMSA_SLUG = "pipeline-and-hazardous-materials-safety-administration";
export const PHMSA_AGENCY_ID = 408;
export const HMR_CFR_TITLE = 49;

/** CFR parts whose amendments can change our dataset. Default watch-list for the monitor. */
export const HMR_WATCH_PARTS = ["171", "172", "173", "177", "178", "180"] as const;

/** The fields the monitor needs on every search result (beyond the default set). */
const MONITOR_FIELDS = [
  "document_number",
  "title",
  "type",
  "action",
  "citation",
  "abstract",
  "publication_date",
  "effective_on",
  "cfr_references",
  "regulation_id_numbers",
  "docket_ids",
  "html_url",
  "pdf_url",
];

/** A decision-ready view of one HMR-relevant Federal Register document. */
export interface HmrAmendment {
  documentNumber: string;
  title: string;
  /** "Rule" (final) or "Proposed Rule". */
  type: string;
  action: string | null;
  citation: string | null;
  publicationDate: string | null;
  /** ISO effective date, or null (proposed rules have none). */
  effectiveOn: string | null;
  /** The 49 CFR parts this document amends (as strings, e.g. ["172","173"]). */
  cfrParts: string[];
  /** Parts from cfrParts that are on the watch-list — the ones that can move our dataset. */
  inScopeParts: string[];
  /** True when it touches at least one watched part. */
  touchesInScope: boolean;
  regulationIdNumbers: string[];
  docketIds: string[];
  htmlUrl: string | null;
  pdfUrl: string | null;
  abstract: string | null;
}

/** Extract the distinct 49 CFR parts a document references. */
export function cfrPartsOf(doc: FrDocument, title = HMR_CFR_TITLE): string[] {
  const parts = new Set<string>();
  for (const ref of doc.cfr_references ?? []) {
    if (ref.title === title && ref.part != null && ref.part !== "") parts.add(String(ref.part));
  }
  return [...parts].sort((a, b) => Number(a) - Number(b));
}

export function toHmrAmendment(doc: FrDocument, watchParts: readonly string[] = HMR_WATCH_PARTS): HmrAmendment {
  const cfrParts = cfrPartsOf(doc);
  const watch = new Set(watchParts);
  const inScopeParts = cfrParts.filter((p) => watch.has(p));
  return {
    documentNumber: doc.document_number,
    title: doc.title,
    type: doc.type,
    action: doc.action ?? null,
    citation: doc.citation ?? null,
    publicationDate: doc.publication_date ?? null,
    effectiveOn: doc.effective_on ?? null,
    cfrParts,
    inScopeParts,
    touchesInScope: inScopeParts.length > 0,
    regulationIdNumbers: doc.regulation_id_numbers ?? [],
    docketIds: doc.docket_ids ?? [],
    htmlUrl: doc.html_url ?? null,
    pdfUrl: doc.pdf_url ?? null,
    abstract: doc.abstract ?? null,
  };
}

export interface AmendmentQuery {
  /** Only documents published on/after this ISO date. */
  sinceDate: string;
  /** Include proposed rules too (default false — final rules only). */
  includeProposed?: boolean;
  /** Restrict to these CFR parts server-side (default: title-49-wide, filtered client-side). */
  cfrParts?: readonly string[];
  watchParts?: readonly string[];
  maxPages?: number;
}

/**
 * Every PHMSA HMR amendment published since a date, newest first, as decision-ready `HmrAmendment`s.
 * Final rules by default; pass `includeProposed` to also see what is coming.
 */
export async function listHmrAmendmentsSince(
  client: FrClient,
  query: AmendmentQuery,
): Promise<HmrAmendment[]> {
  const types: FrTypeCode[] = query.includeProposed ? ["RULE", "PRORULE"] : ["RULE"];
  const params: DocumentSearchParams = {
    agencyIds: [PHMSA_AGENCY_ID],
    types,
    cfrTitle: HMR_CFR_TITLE,
    publicationDateGte: query.sinceDate,
    fields: MONITOR_FIELDS,
    perPage: 100,
    order: "newest",
  };
  const docs = await client.searchAllDocuments(params, query.maxPages ?? 10);
  const watch = query.watchParts ?? HMR_WATCH_PARTS;
  return docs.map((d) => toHmrAmendment(d, watch));
}

export interface CurrencyReport {
  sinceDate: string;
  checkedAt: string | null;
  total: number;
  /** Amendments touching a watched part — the ones that can move the dataset. */
  relevant: HmrAmendment[];
  /** Relevant AND not yet effective — the "re-cut before this date" queue. */
  effectivePending: HmrAmendment[];
  /** Relevant AND already effective since `sinceDate` — the dataset may already be stale. */
  effectiveAlready: HmrAmendment[];
}

/**
 * The RELEASING/ops currency signal: given the date our last dataset was cut, what PHMSA HMR changes
 * have landed, which touch our parts, and which have a future effective date we must re-cut before.
 * `todayIso` is injected (tests) and used to split pending vs already-effective.
 */
export async function checkHmrCurrency(
  client: FrClient,
  opts: { sinceDate: string; todayIso: string; includeProposed?: boolean; watchParts?: readonly string[] },
): Promise<CurrencyReport> {
  const amendments = await listHmrAmendmentsSince(client, {
    sinceDate: opts.sinceDate,
    ...(opts.includeProposed !== undefined ? { includeProposed: opts.includeProposed } : {}),
    ...(opts.watchParts !== undefined ? { watchParts: opts.watchParts } : {}),
  });
  const relevant = amendments.filter((a) => a.touchesInScope);
  const today = opts.todayIso;
  const effectivePending = relevant.filter((a) => a.effectiveOn != null && a.effectiveOn > today);
  const effectiveAlready = relevant.filter((a) => a.effectiveOn != null && a.effectiveOn <= today);
  return {
    sinceDate: opts.sinceDate,
    checkedAt: null, // caller stamps
    total: amendments.length,
    relevant,
    effectivePending,
    effectiveAlready,
  };
}

/** One-line log form for an amendment. */
export function describeAmendment(a: HmrAmendment): string {
  const eff = a.effectiveOn ? `eff ${a.effectiveOn}` : "no eff date";
  const scope = a.touchesInScope ? `parts ${a.inScopeParts.join(",")}` : `parts ${a.cfrParts.join(",") || "—"} (out of scope)`;
  return `${a.publicationDate ?? "????-??-??"} ${a.type.padEnd(13)} ${a.documentNumber}  ${eff}  [${scope}]  ${a.title}`;
}
