/**
 * The printed-paper audit's contract (DOCUMENT-READER-PLAN.md D-DR6, §5.1; Q-DR2 answered 2026-10-08).
 *
 * `validateBol` (validate.ts) says what a shipping paper MUST carry for a resolved load. This audit is the
 * other half F-DR4 found missing: it reads what the shipper actually PRINTED and compares it, line by
 * line, with the Hazardous Materials Table row the line resolved to. No model judges anything here — the
 * reader transcribes, these rules decide.
 *
 * WHY THE ENGINE HAS ITS OWN INPUT SHAPES. The reader's contract is `PrintedHazmatLine` /
 * `ShippingDocument` in `@silvicom/shared`, and the resolver's is `ResolveLineResult` in `@hazmat/data`;
 * the engine may import neither (lint:boundaries, D3/G5). So the shapes below are STRUCTURAL subsets of
 * those, and `apps/api/src/modules/hazmat/paperAuditContract.test.ts` proves at type level that the real
 * contracts are assignable to them — a field renamed on either side breaks the build, not the audit
 * (test: "compiles the reader's and resolver's real types into the engine's input shapes").
 *
 * WHERE EACH REQUIREMENT COMES FROM (the owner's Q-DR2 ruling). Anything that depends on WHICH material
 * this is — its PSN, class, subsidiary, PG, the G symbol, column 8A, the Appendix A reportable quantity,
 * the Appendix B marine-pollutant list — is read from the dataset version the caller passes, never
 * restated here. When the dataset does not carry what a rule needs, the rule answers `cannot_tell` with
 * `requirement_not_in_dataset` rather than falling back on a constant. What the rules DO state are the
 * paper-format requirements that have no table behind them (a basic description has an id, a 24-hour
 * number has an area code) — the same elements `validateBol` has always listed.
 */

export const PAPER_RULE_IDS = [
  "paper_sequence",
  "paper_psn_matches_hmt",
  "paper_class_pg_match",
  "paper_technical_name",
  "paper_rq",
  "paper_lq",
  "paper_marine_pollutant",
  "paper_quantity_present",
  "paper_hm_column",
  "paper_er_phone",
  "paper_certification",
  "paper_page_complete",
] as const;
export type PaperRuleId = (typeof PAPER_RULE_IDS)[number];

export type PaperOutcome = "pass" | "fail" | "cannot_tell";

/** The reader's per-field confidence (`FIELD_STATUSES` in fieldEvidenceContract.ts). */
export type PaperFieldStatus = "read" | "check" | "not_read";
/**
 * Keyed by the shared field-path grammar (`hazmat.lines[0].pg`, `identity.pageOf.of`). A path absent from
 * the map is treated as `read` — a value a person typed has no evidence record and needs none.
 */
export type PaperFieldStates = Readonly<Record<string, PaperFieldStatus>>;

// ── printed (as transcribed; a structural subset of ShippingDocument) ───────────────────────────────
export interface PrintedPaperLine {
  readonly idText: string | null;
  readonly psn: string | null;
  readonly hazardClass: string | null;
  readonly pg: "I" | "II" | "III" | null;
  readonly technicalName: string | null;
  readonly quantity: { readonly value: number | null; readonly unit: string | null };
  readonly packageCount: number | null;
  readonly packaging: string | null;
  readonly hmColumnMark: "X" | "RQ" | null;
  readonly marks: readonly string[];
}
export interface PrintedPaper {
  readonly identity: { readonly pageOf: { readonly page: number | null; readonly of: number | null } | null };
  readonly hazmat: {
    readonly lines: readonly PrintedPaperLine[];
    readonly emergencyPhone: string | null;
    readonly shipperCertification: boolean | null;
  };
}

// ── resolved (what the resolver and the caller already derived; never re-derived here) ────────────────
/**
 * One line's resolution — a structural subset of `@hazmat/data`'s `ResolveLineResult`. The resolver is
 * where §172.101(c)(1)–(2)'s permitted PSN variations live (`normalizePsnForMatch`, versioned by
 * PSN_NORMALIZER_VERSION); this audit reads its verdict instead of keeping a second normaliser.
 */
export type PaperResolution =
  | {
      readonly ok: true;
      readonly entryId: string;
      readonly pg: "I" | "II" | "III" | null;
      readonly matchedName: string;
      /** The resolver's non-fatal flags: "pg_missing", "pg_mismatch", "pg_present_on_no_pg_entry". */
      readonly findings: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly candidates?: readonly { readonly entryId: string; readonly psn: string }[];
    };

export interface ResolvedPaperLine {
  /** null when the resolver was never run for this line. */
  readonly resolution: PaperResolution | null;
  /** The printed unit in the engine's closed set, as the caller's `normalizeUnit` read it. */
  readonly quantityUnit?: "gal" | "lb" | "kg" | "L" | null;
  /** Bulk or non-bulk, as the caller's packaging derivation read it; null = not known. */
  readonly packagingKind?: "bulk" | "non_bulk" | null;
  /** The offeror's Limited Quantity claim from outside the paper (order, calculator); null = none known. */
  readonly claimedLimitedQuantity?: boolean | null;
}

export interface ResolvedPaper {
  /** The dataset version on the run — read through `PaperDatasetView`, passed through whole. */
  readonly dataset: { readonly version: string; readonly [table: string]: unknown };
  /** Index-aligned with `printed.hazmat.lines`. */
  readonly lines: readonly ResolvedPaperLine[];
  /** Any leg by vessel (§171.4(c)(1)); null = not known. */
  readonly vesselLeg?: boolean | null;
  /** Non-hazardous items share this paper (§172.201(a)(1)); null = not known. */
  readonly mixedPaper?: boolean | null;
  /** A §172.204(b) exception applies (carrier-supplied cargo tank, private carrier's own product). */
  readonly certificationExempt?: boolean | null;
  /** Every page number the reader saw across the document's images; null = not counted. */
  readonly pagesPresent?: readonly number[] | null;
}

// ── output ──────────────────────────────────────────────────────────────────────────────────────────
export type PaperFactValue = string | number | boolean | null | readonly string[] | readonly number[];
export type PaperFacts = Readonly<Record<string, PaperFactValue>>;

export interface PaperRuleResult {
  readonly ruleId: PaperRuleId;
  readonly outcome: PaperOutcome;
  /** The printed line this is about; null for a document-level rule (phone, certification, pages). */
  readonly lineIndex: number | null;
  /** Why this outcome — a stable code the finding catalogue keys its sentence on. */
  readonly reason: string;
  /** What the sentence needs: printed values, the row's required values, the paths left unconfirmed. */
  readonly facts: PaperFacts;
}

export interface PaperAudit {
  readonly datasetVersion: string;
  readonly results: readonly PaperRuleResult[];
}

// ── the dataset, read through a minimal consumer view (the engine may not import @hazmat/data) ──────
export interface PaperDsEntry {
  entryId: string;
  /** Optional in the view so a dataset that omits it reads as "not carried", not as "no G symbol". */
  symbols?: string[];
  psnPrinted: string;
  psnAlternates?: string[];
  hazardClass: string | null;
  subsidiaryClasses?: string[];
  idPrefix: "UN" | "NA";
  idNumber: string;
  /** `exceptionsRef` is column 8A — ABSENT (not null) on datasets cut before 2026.08.0. */
  pgRows: Array<{ pg: "I" | "II" | "III" | null; exceptionsRef?: string | null }>;
}
export interface PaperDsView {
  entries: PaperDsEntry[];
  hazSubstances: Array<{ name?: string; nameNormalized: string; rqPounds?: number; rqKg?: number }>;
  marinePollutants: Array<{ name?: string; nameNormalized: string; severe: boolean }>;
}
