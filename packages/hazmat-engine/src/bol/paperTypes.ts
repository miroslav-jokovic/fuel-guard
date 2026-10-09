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
 * paper-format requirements that have no table behind them (a basic description has an id, an emergency
 * number includes its area code) — and since the 2026-10-09 audit against eCFR (owner ruling Q-DR15) each
 * of those states the regulation's own words, with its exceptions, quoted in the rule that applies it.
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
  "paper_package_count",
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
  /**
   * The line's printed description as one string, in reading order ("RQ, UN1203, Gasoline, 3, II, Ltd
   * Qty"). The reader's contract does not carry it yet (Q-DR13); until it does, the rules that need the
   * printed ORDER — §172.202(b)'s sequence, §172.203(b)'s "following the basic description" — say they
   * did not verify it rather than guess.
   */
  readonly descriptionText?: string | null;
}
export interface PrintedPaper {
  readonly identity: {
    readonly pageOf: { readonly page: number | null; readonly of: number | null } | null;
    /**
     * The page marker printed on each image, one entry per image in capture order ("Page 1 of 2", "2",
     * null for an image that prints none, as the contract writes it; "" is read the same) — what §172.201(c)'s "each page is consecutively numbered" is
     * checked against. Named as the reader's contract will name it (`identity.printedPageNumbers`), so
     * the seam test binds the two the day the contract gains it.
     */
    readonly printedPageNumbers?: readonly (string | null)[] | null;
  };
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
  /** The offeror's Excepted Quantity claim (§173.4a) from outside the paper — §172.604(d)(1). */
  readonly claimedExceptedQuantity?: boolean | null;
  /**
   * How many HAZARDOUS materials the mixture or solution holds, from the SDS or the offeror — §172.203(k)(1)
   * asks for two names only of "a mixture or solution of two or more hazardous materials". null = unknown.
   */
  readonly hazardousComponents?: number | null;
  /** The material is oil subject to 49 CFR part 130 (§130.2) — §172.203(l)(3)'s exception. null = unknown. */
  readonly subjectToPart130?: boolean | null;
  /** Liquid or solid, from the SDS — §171.4(c)(2)'s 5 L / 5 kg turns on it. null = derive from the row. */
  readonly physicalState?: "liquid" | "solid" | "gas" | null;
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
  /**
   * A §172.204(b)(1) exception applies. Derive it with `certificationExemptionFrom` (certificationExemption.ts),
   * never by hand: true only for a carrier-supplied cargo tank, or a private carrier once "not reshipped or
   * transferred" and "not a hazardous waste" are both confirmed (owner ruling Q-DR16).
   */
  readonly certificationExempt?: boolean | null;
  /** Every page number the reader saw across the document's images; null = not counted. */
  readonly pagesPresent?: readonly number[] | null;
  /** How many images of the paper's pages the reader was given; null = not counted. */
  readonly imageCount?: number | null;
  /** On a mixed paper, the hazmat entries are listed before every other item — §172.201(a)(1)(i). */
  readonly hazmatEntriesFirst?: boolean | null;
  /**
   * The vehicle or container holds fumigated lading, displays the FUMIGANT marking, and carries no other
   * hazardous material — §172.604(d)(3). null = not known.
   */
  readonly fumigatedUnitNoOtherHazmat?: boolean | null;
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
