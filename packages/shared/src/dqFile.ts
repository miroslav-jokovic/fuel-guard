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

import { DQ_ITEMS, DQ_GROUPS, DQ_GROUP_LABELS } from "./dqCatalogue.js";
import type { PaperThumb } from "./unitFileContract.js";
import type { DqGroup, DqItemSpec, DqItemState } from "./dqCatalogue.js";
import { returnToDutyCause } from "./returnToDuty.js";
import {
  buildFile,
  compareFileAttention,
  fileAttention,
  fileDay as day,
  fileDaysBetween as daysBetween,
  fileGroups,
  type FileAttentionItem,
  type FileEvidence,
  type FileGroupSummary,
  type FileItem,
  type FileSummary,
} from "./fileEngine.js";

// The catalogue is part of this module's public surface — a consumer should not have to know the
// vocabulary moved house.
export * from "./dqCatalogue.js";

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
  /** How far ahead counts as "expiring" in the qualification-state calculation. */
  expiringWithinDays?: number;
  /**
   * Whether the driver holds a CDL — derived from `drivers.cdl_number` (populated by the D6 sync).
   * Gates `appliesWhen: "no_cdl"` items: since 2025-06-22 the registry-verification note is a
   * non-CDL requirement only (D8 / G33). Defaults false, which DEMANDS the note — the safe reading
   * of an unknown licence status is the stricter file, never the laxer one.
   */
  hasCdl?: boolean;
  /**
   * Whether this driver owes §40.25(j) return-to-duty documentation — `drivers.return_to_duty_required`
   * (0237). Gates `appliesWhen: "return_to_duty"`.
   *
   * ⚠ **Defaults FALSE, which is the opposite of `hasCdl`'s default and is deliberate.** `hasCdl`
   * defaults to the stricter file because an unknown licence status should demand the extra note.
   * Here the stricter reading would demand return-to-duty paperwork from every driver in the fleet,
   * which is not caution — it is telling a clean carrier their whole roster is non-compliant. The
   * flag is a `not null default false` column; an absent value means the caller did not ask for it,
   * and the honest answer to "did this driver admit something" when nobody looked is no.
   */
  returnToDutyRequired?: boolean;
  /**
   * The collection day of the Med-Stop positive or refusal that holds this driver (`medstopViolationOn`,
   * MS2), or null. It raises the same item, and only a record dated ON OR AFTER it discharges it — the
   * dispatch door's own rule, `returnToDutyCause`, called below rather than restated. ⚠ A §382.401(a)
   * fact: callers pass it only for a reader `canReadTestingRecords` admits (MEDSTOP-PLAN §7A.15).
   */
  returnToDutyViolationOn?: string | null;
}

// ── output ────────────────────────────────────────────────────────────────────────────────────────

// The driver file's names for the engine's shapes (UNIT-FILES-PLAN D-UF1). They are the engine's types
// pinned to the §391.51 catalogue, kept under their old names so no caller had to move with the lift.
export type DqFileItem = FileItem<DqItemSpec>;
export type DqFileSummary = FileSummary<DqItemSpec>;
export type DqAttentionItem = FileAttentionItem<DqGroup>;

/** The driver queue's ranking — the engine's, so a truck and a driver are ranked by one rule. */
export function dqAttention(file: DqFileSummary, today: string): DqAttentionItem[] {
  return fileAttention<DqItemSpec, DqGroup>(file, today);
}

export const compareAttention: (a: DqAttentionItem, b: DqAttentionItem) => number = compareFileAttention;

/**
 * The requirements the ROSTER shows as their own column (R4, D-ROS9).
 *
 * ── WHY THIS IS A PROJECTION AND NOT A SECOND CALCULATION ────────────────────────────────────────
 * D-DQ6 and D-ROS9 both say the same thing from different ends: two sources of truth for a legal gate
 * IS the defect. So the roster's CDL / medical / hazmat cells are a projection of the SAME
 * `DqFileSummary` the driver page renders and the qualification queue ranks — never a read of
 * `drivers.cdl_expires_at`, which is a display field even when McLeod is the one writing it.
 *
 * ── WHY IT COULD NOT COME FROM `attention` ───────────────────────────────────────────────────────
 * The obvious route was the rollup's existing `attention` list, and it does not work: `dqAttention`
 * filters to `state !== "current"`, because its job is a queue of things to DO. A roster column has
 * to show a date for the driver whose CDL is perfectly fine — which is most of them — so the column
 * would have been empty for exactly the drivers with nothing wrong. Measured on the real shape
 * before building anything (2026-08-31).
 *
 * ⚠ These cells inherit §6 Q6 unchanged: a date synced from a TMS with no scan behind it reads
 * `current`, because `buildDqFile` computes presence from the certification rather than the
 * document. `documentId` was deliberately not projected here until UNIT-FILES-PLAN UF4b, and it is
 * projected now for ONE reader: the File cell's hover card, which joins a thumbnail to the item it
 * proves. Nothing reads it to decide a state — a cell with a date and no scan still reads `current`,
 * and Q6 remains its own step across the queue, these columns and the binder.
 */
/**
 * How much of this driver's §391.51 file has an actual SCAN behind it (R5).
 *
 * ── WHY THIS IS DERIVED HERE AND NOT COUNTED IN THE DATABASE ─────────────────────────────────────
 * R5's original note asked for a `documentCount` on the overview response and warned that a per-row
 * fetch would cost a signed-URL round trip per driver. It needs neither: `buildDqFile` already
 * resolves `documentId` per item while computing the file, so the count is a fold over work the
 * rollup has done anyway. A 287-driver roster adds ZERO queries.
 *
 * ── AND WHY THE DENOMINATOR IS THE DRIVER'S OWN CHECKLIST ────────────────────────────────────────
 * `of` is the number of items that APPLY to this driver, not the catalogue's length. A carrier
 * without the hazmat module, or a non-CDL driver, has a shorter checklist — showing "8/20" against
 * a fixed 20 would report them permanently behind on requirements nobody is asking them for.
 *
 * ⚠ This counts SCANS, and is therefore the one number on the roster that already distinguishes
 * what §6 Q6 is about: an item can be `current` from a synced date while contributing nothing here.
 * That is deliberate — it is a count, not a verdict, so it states a fact without asserting the file
 * is deficient before that question has a ruling.
 */
export interface DqDocumentCount {
  /** Items with a scan filed. */
  onFile: number;
  /** Items that apply to this driver at all. */
  of: number;
}

export function dqDocumentCount(file: DqFileSummary): DqDocumentCount {
  return {
    onFile: file.items.filter((i) => i.documentId !== null).length,
    of: file.items.length,
  };
}

export const DQ_ROSTER_COLUMN_KEYS = ["cdl", "medical_card", "endorsement_hazmat"] as const;
export type DqRosterColumnKey = (typeof DQ_ROSTER_COLUMN_KEYS)[number];

export interface DqRosterCell {
  key: DqRosterColumnKey;
  state: DqItemState;
  /** The date it stops being good. Null when the item is missing, or records no expiry at all. */
  goodUntil: string | null;
  /** Negative when overdue; null when there is no date to count to. */
  daysRemaining: number | null;
  /** True when evidence exists but carries no expiry — a data defect, not an eternal licence. */
  expiryUnknown: boolean;
  /**
   * The scan proving this item, when one is cited (UNIT-FILES-PLAN UF4b). The roster's File cell
   * draws a driver's newest papers and says, on the hover card, what each one proves and until when
   * — which is a join on this id against `papers`. Only these three keys carry it, none restricted.
   */
  documentId: string | null;
}

/**
 * The roster's cells for one driver's file. Items that do not APPLY (hazmat on a carrier without the
 * module, a CDL requirement on a non-CDL driver) are absent rather than `missing` — the column reads
 * "—", which is the truth, where "missing" would be an accusation.
 */
export function dqRosterCells(file: DqFileSummary, today: string): DqRosterCell[] {
  const wanted = new Set<string>(DQ_ROSTER_COLUMN_KEYS);
  return file.items
    .filter((i) => wanted.has(i.spec.key))
    .map((i) => ({
      key: i.spec.key as DqRosterColumnKey,
      state: i.state,
      goodUntil: i.goodUntil,
      // `day()` exactly as `dqAttention` does: the queue and these columns must not disagree
      // about what today is when the caller passes a full ISO timestamp.
      daysRemaining: i.goodUntil ? daysBetween(day(today), i.goodUntil) : null,
      expiryUnknown: i.expiryUnknown,
      documentId: i.documentId,
    }));
}

export type DqGroupSummary = FileGroupSummary<DqGroup>;

/**
 * Per-group rollup for the file's summary strip (D-DQ8). A group with nothing wrong reads `current`;
 * a group with nothing that applies (hazmat, on a carrier without the module) is absent.
 */
export function dqGroups(file: DqFileSummary): DqGroupSummary[] {
  return fileGroups<DqItemSpec, DqGroup>(file, DQ_GROUPS, DQ_GROUP_LABELS);
}

/** One driver's line in the fleet picture (D-DQ6). Ranked server-side; the client only renders. */
export interface DriverOverviewRow {
  driver_id: string;
  driver_name: string;
  driver_status: string;
  state: DqFileSummary["state"];
  counts: Record<DqItemState, number>;
  groups: DqGroupSummary[];
  attention: DqAttentionItem[];
  /**
   * The roster's own columns (R4). Present for EVERY driver, including the ones with nothing wrong —
   * which is why it cannot be derived from `attention`, and why it is carried separately.
   */
  requirements: DqRosterCell[];
  /** How much of the file has a scan behind it (R5) — a fold over work the rollup already did. */
  documents: DqDocumentCount;
  /**
   * The driver's newest papers, newest first, at most `PAPERS_PER_ROW`, with signed thumbnails — the
   * roster's File cell (UNIT-FILES-PLAN UF4b, D-UF7), the same shape a truck's row carries. Present
   * ONLY when the reader asked for papers: `GET /overview` does; the alert scheduler, the digest and
   * the dispatch board do not, so they never sign a URL nobody will open.
   */
  papers?: PaperThumb[];
  /** Every original on file for this driver that the reader may see — what "+N" counts past `papers`. */
  paper_count?: number;
}

export interface ComplianceOverviewResponse {
  drivers: DriverOverviewRow[];
  includesHazmat: boolean;
  /** True when the qualification-record read hit its cap — the picture is partial, and says so. */
  truncated: boolean;
}

/**
 * The specs a capture UI may offer for this driver — scope and applicability filtered, but WITHOUT
 * the advisory filter: an advisory item is absent from the checklist until evidence exists, and the
 * drop-card is exactly where that first evidence comes from (D8). One helper so the UI never
 * re-derives the applicability rules and drifts.
 */
export function dqCapturableSpecs(
  input: { includeHazmat: boolean; hasCdl?: boolean; returnToDutyRequired?: boolean; returnToDutyViolationOn?: string | null },
): DqItemSpec[] {
  return DQ_ITEMS.filter((spec) => (spec.scope === "always" || input.includeHazmat) && applies(spec, input));
}

/**
 * Does this conditional item apply to this driver?
 *
 * ⚠ One function, used by `dqCapturableSpecs` and by the file builder, because they must agree. They
 * did not have to before — `no_cdl` was the only condition and the two filters were two copies of one
 * line. A second condition is what turns a duplicated line into a place where a checklist can offer a
 * requirement the file does not have, or the other way round.
 */
function applies(
  spec: DqItemSpec,
  input: { hasCdl?: boolean; returnToDutyRequired?: boolean; returnToDutyViolationOn?: string | null },
): boolean {
  if (spec.appliesWhen === "no_cdl") return !input.hasCdl;
  if (spec.appliesWhen === "return_to_duty") return Boolean(input.returnToDutyRequired) || input.returnToDutyViolationOn != null;
  return true;
}

function matchCert(spec: DqItemSpec, certs: DqCertInput[]): DqCertInput | undefined {
  return certs.find(
    (c) =>
      spec.evidenceKinds.includes(c.kind) &&
      (!spec.qualifiers || (c.qualifier != null && spec.qualifiers.includes(c.qualifier))) &&
      (!spec.trainingType || c.trainingType === spec.trainingType),
  );
}

/** The most recent occurrence — `qualification_records` is append-only, so a correction is a new row. */
function matchRecord(spec: DqItemSpec, records: DqRecordInput[]): DqRecordInput | undefined {
  return records
    .filter((r) => spec.evidenceKinds.includes(r.kind))
    .sort((a, b) => day(b.occurredOn).localeCompare(day(a.occurredOn)))[0];
}

/**
 * Build one driver's qualification file.
 *
 * `today` is a parameter rather than read from the clock, so the same file can be rendered "as at"
 * an audit date — which is the question an auditor actually asks, and is impossible to answer from a
 * function that looks at the wall clock.
 */
export function buildDqFile(input: DqFileInput): DqFileSummary {
  return buildFile<DqItemSpec>({
    today: input.today,
    expiringWithinDays: input.expiringWithinDays,
    // Conditional items exist for some files and not others: §391.51(b)(8)'s note sunset for CDL
    // holders (D8 / G33), and §40.25(j)'s return-to-duty paperwork is owed only by a driver who
    // admitted something. `applies` is the one place that decides, shared with the capture list.
    specs: DQ_ITEMS.filter((spec) => (spec.scope === "always" || input.includeHazmat) && applies(spec, input)),
    evidenceFor: (spec) => evidenceFor(spec, input),
    documentIds: new Set(input.documents.map((d) => d.id)),
    nothingFiled: input.certs.length === 0 && input.records.length === 0,
  });
}

/** What the driver's rows say about one item — matched here, dated by the engine. */
function evidenceFor(spec: DqItemSpec, input: DqFileInput): FileEvidence | undefined {
  const cert = spec.source === "certification" ? matchCert(spec, input.certs) : undefined;
  const found = spec.source === "record" ? matchRecord(spec, input.records) : undefined;
  // A return-to-duty record older than the Med-Stop violation documents an EARLIER process, not
  // this one: the item stays missing exactly while dispatch stays stopped.
  const stale = spec.appliesWhen === "return_to_duty" && returnToDutyCause({
    returnToDutyRequired: Boolean(input.returnToDutyRequired), returnToDutyDocumented: Boolean(found),
    violationOn: input.returnToDutyViolationOn ?? null, lastReturnToDutyOn: found ? day(found.occurredOn) : null,
  }) !== null;
  const record = stale ? undefined : found;
  if (cert) {
    return { expiresAt: cert.expiresAt, issuedAt: cert.issuedAt, occurredOn: null, coversUntil: null, documentId: cert.documentId };
  }
  if (record) {
    return { expiresAt: null, issuedAt: null, occurredOn: record.occurredOn, coversUntil: record.coversUntil, documentId: record.documentId };
  }
  return undefined;
}
