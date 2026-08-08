/**
 * The electronic driver qualification file — §391.51 as a checklist (DQF plan, DQ2). PURE: the API
 * and the dashboard both read it, and it is unit-testable without a database.
 *
 * WHAT THIS IS NOT. `qualificationGate.ts` decides whether a driver may haul a placardable hazmat
 * load right now (§10.4). This decides whether their qualification FILE is complete for an audit
 * (§391.51). The two overlap on the CDL and the medical certificate and diverge everywhere else: an
 * auditor asks for the employment application and the previous-employer responses, which no gate
 * cares about; the gate demands a tank endorsement for a cargo-tank load, which is a fact about the
 * equipment on that trip and not about the driver's file. Keeping them separate is deliberate —
 * merging them would mean one of the two silently answering the other's question.
 *
 * RETENTION IS RECORDED, NOT ENFORCED. §391.51(c) keeps the file for three years past the end of
 * employment, and §391.51(d) lets a few items be purged on their own clock. Each item carries its
 * rule as text so the UI can show it; nothing here deletes anything. Purging compliance records is a
 * deliberate, audited operation, never a side effect of rendering a page.
 */

/** Where an item's evidence lives: a `certifications` row, or a `qualification_records` row. */
export type DqEvidenceSource = "certification" | "record";

/**
 * How an item goes stale.
 *   expiry     — the evidence carries its own expiry date (CDL, medical certificate)
 *   annual     — good for one year from the date it happened (§391.25 review, §382.701(b) query)
 *   triennial  — good for three years from the date it was issued (§172.704(c)(2) training)
 *   one_time   — a hiring-time event that never expires (application, road test, pre-employment MVR)
 */
export type DqRecurrence = "expiry" | "annual" | "triennial" | "one_time";

/** `hazmat` items only apply to a carrier running the HazmatGuard module. */
export type DqScope = "always" | "hazmat";

export type DqItemState = "current" | "expiring" | "expired" | "missing";

export interface DqItemSpec {
  key: string;
  label: string;
  citation: string;
  source: DqEvidenceSource;
  /** Any one of these `kind` values satisfies the item — §391.51(b)(4) accepts a road test OR the
   *  §391.33 licence equivalency, which is one requirement with two lawful evidences. */
  evidenceKinds: string[];
  /** Endorsements: any of these qualifier letters satisfies it. */
  qualifiers?: string[];
  /** Hazmat training: the §172.704(a) type this item is about. */
  trainingType?: string;
  recurrence: DqRecurrence;
  scope: DqScope;
  /** The retention rule, as text. Shown, never acted on. */
  retention: string;
}

/**
 * §391.51(b) and its companions, in the order an auditor works through them: hire, licence, medical,
 * then the recurring obligations. `eldt` and the Clearinghouse items are not in §391.51(b) itself but
 * are asked for alongside it and have nowhere else to live.
 *
 * Deliberately absent: the tank endorsement (equipment-dependent, the gate's business, not the
 * file's) and the §391.27 annual list of violations (removed in 2020, superseded by the
 * Clearinghouse query — filing it would be teaching a carrier a requirement that no longer exists).
 */
export const DQ_ITEMS: readonly DqItemSpec[] = [
  {
    key: "employment_application", label: "Employment application",
    citation: "49 CFR §391.21 / §391.51(b)(1)",
    source: "record", evidenceKinds: ["employment_application"], recurrence: "one_time", scope: "always",
    retention: "Retained for the duration of employment plus 3 years (§391.51(c)).",
  },
  {
    key: "mvr_preemployment", label: "Pre-employment driving record inquiry",
    citation: "49 CFR §391.23(a)(1) / §391.51(b)(2)",
    source: "record", evidenceKinds: ["mvr"], recurrence: "one_time", scope: "always",
    retention: "Retained for the duration of employment plus 3 years (§391.51(c)).",
  },
  {
    key: "previous_employer_inquiry", label: "Previous-employer safety inquiry sent",
    citation: "49 CFR §391.23(a)(2)",
    source: "record", evidenceKinds: ["previous_employer_inquiry"], recurrence: "one_time", scope: "always",
    retention: "Retained for the duration of employment plus 3 years (§391.51(c)).",
  },
  {
    key: "previous_employer_response", label: "Previous-employer response (or documented non-response)",
    citation: "49 CFR §391.23(d)",
    source: "record", evidenceKinds: ["previous_employer_response"], recurrence: "one_time", scope: "always",
    retention: "Retained for the duration of employment plus 3 years (§391.51(c)).",
  },
  {
    key: "road_test", label: "Road test certificate, or licence equivalency",
    citation: "49 CFR §391.31 / §391.33 / §391.51(b)(4)-(5)",
    source: "record", evidenceKinds: ["road_test", "cdl_equivalency"], recurrence: "one_time", scope: "always",
    retention: "Retained for the duration of employment plus 3 years (§391.51(c)).",
  },
  {
    key: "eldt", label: "Entry-level driver training",
    citation: "49 CFR §380.725",
    source: "record", evidenceKinds: ["eldt"], recurrence: "one_time", scope: "always",
    retention: "Retained for the duration of employment plus 3 years (§391.51(c)).",
  },
  {
    key: "cdl", label: "Commercial driver's licence",
    citation: "49 CFR §391.51(b)(6)",
    source: "certification", evidenceKinds: ["cdl"], recurrence: "expiry", scope: "always",
    retention: "Superseded copies are retained; the file keeps the chain (§391.51(c)).",
  },
  {
    key: "medical_card", label: "Medical examiner's certificate",
    citation: "49 CFR §391.43 / §391.51(b)(7)",
    source: "certification", evidenceKinds: ["medical_card"], recurrence: "expiry", scope: "always",
    retention: "Retained for 3 years from the date of issue (§391.51(d)(2)).",
  },
  {
    key: "medical_registry_verification", label: "National Registry examiner verification",
    citation: "49 CFR §391.23(m)",
    source: "record", evidenceKinds: ["medical_registry_verification"], recurrence: "one_time", scope: "always",
    retention: "Retained for 3 years from the date of the verification (§391.23(m)(2)).",
  },
  {
    key: "drug_test_preemployment", label: "Pre-employment controlled-substances test",
    citation: "49 CFR §382.301",
    source: "record", evidenceKinds: ["drug_test"], recurrence: "one_time", scope: "always",
    retention: "Held in the confidential DOT testing file, separate from the DQ file (§40.333).",
  },
  {
    key: "clearinghouse_preemployment", label: "Clearinghouse full query (pre-employment)",
    citation: "49 CFR §382.701(a)",
    source: "record", evidenceKinds: ["clearinghouse_full"], recurrence: "one_time", scope: "always",
    retention: "Retained for 3 years (§382.701(d)).",
  },
  {
    key: "annual_mvr_review", label: "Annual review of driving record",
    citation: "49 CFR §391.25 / §391.51(b)(8)",
    source: "record", evidenceKinds: ["annual_mvr_review"], recurrence: "annual", scope: "always",
    retention: "Retained for 3 years from the date of the review (§391.51(d)(1)).",
  },
  {
    key: "clearinghouse_annual", label: "Clearinghouse limited query (annual)",
    citation: "49 CFR §382.701(b)",
    source: "record", evidenceKinds: ["clearinghouse_limited"], recurrence: "annual", scope: "always",
    retention: "Retained for 3 years (§382.701(d)).",
  },
  {
    key: "endorsement_hazmat", label: "Hazmat endorsement (H or X)",
    citation: "49 CFR §383.93",
    source: "certification", evidenceKinds: ["endorsement"], qualifiers: ["H", "X"],
    recurrence: "expiry", scope: "hazmat",
    retention: "Superseded copies are retained; the file keeps the chain (§391.51(c)).",
  },
  {
    key: "training_general_awareness", label: "Hazmat training — general awareness",
    citation: "49 CFR §172.704(a)(1)",
    source: "certification", evidenceKinds: ["hazmat_training"], trainingType: "general_awareness",
    recurrence: "triennial", scope: "hazmat",
    retention: "Retained while employed and for 90 days afterwards (§172.704(d)).",
  },
  {
    key: "training_function_specific", label: "Hazmat training — function specific",
    citation: "49 CFR §172.704(a)(2)",
    source: "certification", evidenceKinds: ["hazmat_training"], trainingType: "function_specific",
    recurrence: "triennial", scope: "hazmat",
    retention: "Retained while employed and for 90 days afterwards (§172.704(d)).",
  },
  {
    key: "training_safety", label: "Hazmat training — safety",
    citation: "49 CFR §172.704(a)(3)",
    source: "certification", evidenceKinds: ["hazmat_training"], trainingType: "safety",
    recurrence: "triennial", scope: "hazmat",
    retention: "Retained while employed and for 90 days afterwards (§172.704(d)).",
  },
  {
    key: "training_security_awareness", label: "Hazmat training — security awareness",
    citation: "49 CFR §172.704(a)(4)",
    source: "certification", evidenceKinds: ["hazmat_training"], trainingType: "security_awareness",
    recurrence: "triennial", scope: "hazmat",
    retention: "Retained while employed and for 90 days afterwards (§172.704(d)).",
  },
] as const;

// ── inputs ────────────────────────────────────────────────────────────────────────────────────────

/** A current `certifications` row, narrowed to what the checklist reads. */
export interface DqCertInput {
  kind: string;
  qualifier: string | null;
  trainingType: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  documentId: string | null;
}

/** A `qualification_records` row. Append-only, so the newest occurrence wins. */
export interface DqRecordInput {
  kind: string;
  occurredOn: string;
  coversUntil: string | null;
  documentId: string | null;
}

/** A `documents` row, so an item can say whether the scan behind it actually exists. */
export interface DqDocumentInput {
  id: string;
  kind: string;
}

export interface DqFileInput {
  today: string;
  certs: DqCertInput[];
  records: DqRecordInput[];
  documents: DqDocumentInput[];
  /** Include the §172.704 / §383.93 items. False for a carrier without the hazmat module. */
  includeHazmat: boolean;
  /** How far ahead counts as "expiring". The product's fixed 30-day lead time. */
  expiringWithinDays?: number;
}

// ── output ────────────────────────────────────────────────────────────────────────────────────────

export interface DqFileItem {
  spec: DqItemSpec;
  state: DqItemState;
  /** The date this item stops being good, when that is knowable. */
  goodUntil: string | null;
  /** When the evidence is dated — issued, or occurred. */
  evidenceDate: string | null;
  /** True when the evidence exists but records no expiry: a data defect, not an eternal licence. */
  expiryUnknown: boolean;
  /** The scan behind it, if one has been filed. */
  documentId: string | null;
}

export interface DqFileSummary {
  items: DqFileItem[];
  /** `not_started` means literally nothing has been filed — see qualificationGate's identical rule. */
  state: "not_started" | "incomplete" | "complete";
  counts: Record<DqItemState, number>;
}

const DEFAULT_EXPIRING_DAYS = 30;

const day = (iso: string): string => iso.slice(0, 10);

function addYears(iso: string, years: number): string {
  const d = new Date(day(iso) + "T00:00:00.000Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(day(iso) + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function matchCert(spec: DqItemSpec, certs: DqCertInput[]): DqCertInput | undefined {
  return certs.find((c) =>
    spec.evidenceKinds.includes(c.kind)
    && (!spec.qualifiers || (c.qualifier != null && spec.qualifiers.includes(c.qualifier)))
    && (!spec.trainingType || c.trainingType === spec.trainingType));
}

/** The most recent occurrence — `qualification_records` is append-only, so a correction is a new row. */
function matchRecord(spec: DqItemSpec, records: DqRecordInput[]): DqRecordInput | undefined {
  return records
    .filter((r) => spec.evidenceKinds.includes(r.kind))
    .sort((a, b) => day(b.occurredOn).localeCompare(day(a.occurredOn)))[0];
}

/** When the evidence stops being good — null when the item never expires or records no date. */
function goodUntilFor(spec: DqItemSpec, cert?: DqCertInput, record?: DqRecordInput): string | null {
  switch (spec.recurrence) {
    case "expiry":
      return cert?.expiresAt ? day(cert.expiresAt) : null;
    case "annual":
      // An explicit `covers_until` wins: an MVR review can be issued to cover an unusual period, and
      // the row saying so is better evidence than arithmetic on the date it happened.
      if (record?.coversUntil) return day(record.coversUntil);
      return record ? addYears(record.occurredOn, 1) : null;
    case "triennial":
      // §172.704(c)(2) runs from the date the training was ISSUED, not from when it was filed.
      return cert?.issuedAt ? addYears(cert.issuedAt, 3) : null;
    case "one_time":
      return null;
  }
}

function stateFor(present: boolean, goodUntil: string | null, today: string, horizon: string): DqItemState {
  if (!present) return "missing";
  if (goodUntil == null) return "current";
  if (goodUntil < today) return "expired";
  if (goodUntil <= horizon) return "expiring";
  return "current";
}

/**
 * Build one driver's qualification file.
 *
 * `today` is a parameter rather than read from the clock, so the same file can be rendered "as at"
 * an audit date — which is the question an auditor actually asks, and is impossible to answer from a
 * function that looks at the wall clock.
 */
export function buildDqFile(input: DqFileInput): DqFileSummary {
  const today = day(input.today);
  const horizon = addDays(today, input.expiringWithinDays ?? DEFAULT_EXPIRING_DAYS);
  const docIds = new Set(input.documents.map((d) => d.id));

  const items: DqFileItem[] = DQ_ITEMS
    .filter((spec) => spec.scope === "always" || input.includeHazmat)
    .map((spec) => {
      const cert = spec.source === "certification" ? matchCert(spec, input.certs) : undefined;
      const record = spec.source === "record" ? matchRecord(spec, input.records) : undefined;
      const present = Boolean(cert ?? record);
      const goodUntil = goodUntilFor(spec, cert, record);
      // A filed document id that points at nothing is not a filed document. The register and the
      // bytes can drift (a failed upload leaves a row behind), and a checklist that trusts the id
      // would report a scan the auditor cannot open.
      const rawDocId = cert?.documentId ?? record?.documentId ?? null;
      return {
        spec,
        state: stateFor(present, goodUntil, today, horizon),
        goodUntil,
        evidenceDate: cert?.issuedAt ? day(cert.issuedAt) : record ? day(record.occurredOn) : null,
        expiryUnknown: spec.recurrence === "expiry" && present && goodUntil == null,
        documentId: rawDocId && docIds.has(rawDocId) ? rawDocId : null,
      };
    });

  const counts: Record<DqItemState, number> = { current: 0, expiring: 0, expired: 0, missing: 0 };
  for (const i of items) counts[i.state] += 1;

  const nothingFiled = input.certs.length === 0 && input.records.length === 0;
  return {
    items,
    state: nothingFiled ? "not_started" : counts.missing + counts.expired === 0 ? "complete" : "incomplete",
    counts,
  };
}
