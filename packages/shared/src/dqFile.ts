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
import type { DqGroup, DqItemSpec, DqItemState } from "./dqCatalogue.js";

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

/**
 * One line of work: this driver, this requirement, this soon. The queue is a list of these, and the
 * driver file ranks its own rows with the same comparator — so the two surfaces can never disagree
 * about what matters most, which is the failure mode of computing urgency twice.
 */
export interface DqAttentionItem {
  key: string;
  label: string;
  citation: string;
  group: DqGroup;
  state: DqItemState;
  goodUntil: string | null;
  evidenceDate: string | null;
  /** Negative when overdue. Null when the item never expires and is simply absent. */
  daysRemaining: number | null;
}

const DAY_MS = 86_400_000;

function daysBetween(today: string, until: string): number {
  return Math.round(
    (Date.parse(`${until}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / DAY_MS,
  );
}

/**
 * Rank: expired first, then missing, then soonest-expiring. Overdue beats absent because a lapsed
 * medical card grounds a driver today, while a road-test certificate that was never filed has been
 * absent for years and will keep — an ordering that flatters the file over the driver is worse than
 * no ordering.
 */
const STATE_RANK: Record<DqItemState, number> = { expired: 0, missing: 1, expiring: 2, current: 3 };

export function dqAttention(file: DqFileSummary, today: string): DqAttentionItem[] {
  return file.items
    .filter((i) => i.state !== "current")
    .map((i) => ({
      key: i.spec.key,
      label: i.spec.label,
      citation: i.spec.citation,
      group: i.spec.group,
      state: i.state,
      goodUntil: i.goodUntil,
      evidenceDate: i.evidenceDate,
      daysRemaining: i.goodUntil ? daysBetween(day(today), i.goodUntil) : null,
    }))
    .sort(compareAttention);
}

export function compareAttention(a: DqAttentionItem, b: DqAttentionItem): number {
  const byState = STATE_RANK[a.state] - STATE_RANK[b.state];
  if (byState !== 0) return byState;
  // Within a state, soonest first; an item with no date sorts last rather than as "due today".
  if (a.daysRemaining === null && b.daysRemaining === null) return a.label.localeCompare(b.label);
  if (a.daysRemaining === null) return 1;
  if (b.daysRemaining === null) return -1;
  return a.daysRemaining - b.daysRemaining;
}

export interface DqGroupSummary {
  group: DqGroup;
  label: string;
  counts: Record<DqItemState, number>;
  /** The group's own worst state — what the summary card shows in one word. */
  state: DqItemState;
}

/** Per-group rollup for the file's summary strip (D-DQ8). A group with nothing wrong reads `current`. */
export function dqGroups(file: DqFileSummary): DqGroupSummary[] {
  const out: DqGroupSummary[] = [];
  for (const group of DQ_GROUPS) {
    const items = file.items.filter((i) => i.spec.group === group);
    if (items.length === 0) continue; // hazmat, on a carrier without the module
    const counts: Record<DqItemState, number> = { current: 0, expiring: 0, expired: 0, missing: 0 };
    for (const i of items) counts[i.state] += 1;
    const state: DqItemState =
      counts.expired > 0
        ? "expired"
        : counts.missing > 0
          ? "missing"
          : counts.expiring > 0
            ? "expiring"
            : "current";
    out.push({ group, label: DQ_GROUP_LABELS[group], counts, state });
  }
  return out;
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
export function dqCapturableSpecs(input: { includeHazmat: boolean; hasCdl?: boolean }): DqItemSpec[] {
  return DQ_ITEMS.filter(
    (spec) =>
      (spec.scope === "always" || input.includeHazmat) &&
      !(spec.appliesWhen === "no_cdl" && input.hasCdl),
  );
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

function stateFor(
  present: boolean,
  goodUntil: string | null,
  today: string,
  horizon: string,
): DqItemState {
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

  const items: DqFileItem[] = DQ_ITEMS.filter(
    (spec) =>
      (spec.scope === "always" || input.includeHazmat) &&
      // §391.51(b)(8) sunset for CDL holders (D8 / G33): the item does not exist for their file.
      !(spec.appliesWhen === "no_cdl" && input.hasCdl),
  )
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
    })
    // Advisory items exist only when evidence does (D8): tracked-not-required must never read
    // "missing", never enter the attention feed, and never hold a file back from `complete`.
    .filter((i) => !(i.spec.advisory && i.state === "missing"));

  const counts: Record<DqItemState, number> = { current: 0, expiring: 0, expired: 0, missing: 0 };
  for (const i of items) counts[i.state] += 1;

  const nothingFiled = input.certs.length === 0 && input.records.length === 0;
  return {
    items,
    state: nothingFiled
      ? "not_started"
      : counts.missing + counts.expired === 0
        ? "complete"
        : "incomplete",
    counts,
  };
}
