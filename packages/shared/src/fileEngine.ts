/**
 * The file engine — how ANY compliance file (a driver's §391.51 file, a truck's, a trailer's) turns
 * evidence into a state. PURE, and subject-free (UNIT-FILES-PLAN D-UF1).
 *
 * ── WHY THIS IS ONE MODULE AND NOT ONE PER FILE ──────────────────────────────────────────────────
 * The driver, truck and trailer files are three CATALOGUES — what each must hold — and one
 * judgement. "Expiring" has to mean the same 30 days on a medical card and on a registration, an
 * unknown expiry has to be the same data defect on both, and the attention order has to rank a lapsed
 * cab card against a lapsed CDL by the same rule, because the alert scheduler and the fleet lists read
 * the two side by side. A second evaluator for equipment would agree with this one only until the day
 * somebody fixed a bug in one of them.
 *
 * So everything here is about an item and its evidence, never about who the subject is. The
 * subject's own rules — whether a driver holds a CDL, owes return-to-duty paperwork, works for a
 * hazmat carrier; whether a truck is owned or leased — stay in the subject's wrapper (`dqFile.ts`,
 * and the unit file beside it), which decides WHICH items apply and WHAT evidence each one has, then
 * hands both here.
 *
 * Lifted out of `dqFile.ts` unchanged in behaviour (UF0): `dqFile.test.ts` is the proof, run against
 * the wrapper exactly as it was before the lift.
 */

/** The four states an item can be in. `dqCatalogue`'s `DqItemState` is this type under its old name. */
export type FileItemState = "current" | "expiring" | "expired" | "missing";

/**
 * How an item goes stale.
 *   expiry     — the evidence carries its own expiry date (CDL, medical certificate, registration)
 *   annual     — good for one year from the date it happened (§391.25 review, §396.17 inspection)
 *   triennial  — good for three years from the date it was issued (§172.704(c)(2) training)
 *   one_time   — an event that never expires (an application, a title)
 */
export type FileRecurrence = "expiry" | "annual" | "triennial" | "one_time";

/** What the engine needs to know about an item's DEFINITION. Each catalogue's spec extends it. */
export interface FileItemSpecBase {
  key: string;
  label: string;
  citation: string;
  recurrence: FileRecurrence;
  group: string;
  /**
   * Tracked, not required (D8 / G33). An advisory item never reports `missing`, never enters the
   * attention feed, and never counts against `complete` — it renders only when evidence exists.
   */
  advisory?: boolean;
}

/**
 * What the subject's wrapper found for one item. The wrapper does the matching (which certification,
 * which record) because matching is where the subject-specific rules live; the engine only dates it.
 */
export interface FileEvidence {
  /** A certification's `expires_at`, for `expiry` items. */
  expiresAt: string | null;
  /** A certification's `issued_at`, for `triennial` items and for the evidence date. */
  issuedAt: string | null;
  /** A record's `occurred_on`, for `annual` items and for the evidence date. */
  occurredOn: string | null;
  /** A record's explicit `covers_until`, which beats arithmetic on `occurredOn`. */
  coversUntil: string | null;
  /** The scan the evidence cites, as filed — checked against the documents that actually exist. */
  documentId: string | null;
}

export interface FileItem<S extends FileItemSpecBase = FileItemSpecBase> {
  spec: S;
  state: FileItemState;
  /** The date this item stops being good, when that is knowable. */
  goodUntil: string | null;
  /** When the evidence is dated — issued, or occurred. */
  evidenceDate: string | null;
  /** True when the evidence exists but records no expiry: a data defect, not an eternal licence. */
  expiryUnknown: boolean;
  /** The scan behind it, if one has been filed AND exists. */
  documentId: string | null;
}

export interface FileSummary<S extends FileItemSpecBase = FileItemSpecBase> {
  items: FileItem<S>[];
  /** `not_started` means literally nothing has been filed — see qualificationGate's identical rule. */
  state: "not_started" | "incomplete" | "complete";
  counts: Record<FileItemState, number>;
}

/**
 * One line of work: this subject, this requirement, this soon. A queue is a list of these, and a
 * file ranks its own rows with the same comparator — so the two surfaces can never disagree about
 * what matters most, which is the failure mode of computing urgency twice.
 */
export interface FileAttentionItem<G extends string = string> {
  key: string;
  label: string;
  citation: string;
  group: G;
  state: FileItemState;
  goodUntil: string | null;
  evidenceDate: string | null;
  /** Negative when overdue. Null when the item never expires and is simply absent. */
  daysRemaining: number | null;
}

export interface FileGroupSummary<G extends string = string> {
  group: G;
  label: string;
  counts: Record<FileItemState, number>;
  /** The group's own worst state — what a summary card shows in one word. */
  state: FileItemState;
}

// ── calendar arithmetic ───────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** How far ahead counts as "expiring" when the caller does not say. */
export const DEFAULT_EXPIRING_DAYS = 30;

/** The calendar day of an ISO date or timestamp. A file is judged in days, never in instants. */
export const fileDay = (iso: string): string => iso.slice(0, 10);

export function fileDaysBetween(today: string, until: string): number {
  return Math.round(
    (Date.parse(`${until}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / DAY_MS,
  );
}

function addYears(iso: string, years: number): string {
  const d = new Date(fileDay(iso) + "T00:00:00.000Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(fileDay(iso) + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── the judgement ─────────────────────────────────────────────────────────────────────────────────

/** When the evidence stops being good — null when the item never expires or records no date. */
function goodUntilFor(recurrence: FileRecurrence, e: FileEvidence | undefined): string | null {
  switch (recurrence) {
    case "expiry":
      return e?.expiresAt ? fileDay(e.expiresAt) : null;
    case "annual":
      // An explicit `covers_until` wins: an MVR review can be issued to cover an unusual period, and
      // the row saying so is better evidence than arithmetic on the date it happened.
      if (e?.coversUntil) return fileDay(e.coversUntil);
      return e?.occurredOn ? addYears(e.occurredOn, 1) : null;
    case "triennial":
      // §172.704(c)(2) runs from the date the training was ISSUED, not from when it was filed.
      return e?.issuedAt ? addYears(e.issuedAt, 3) : null;
    case "one_time":
      return null;
  }
}

function stateFor(present: boolean, goodUntil: string | null, today: string, horizon: string): FileItemState {
  if (!present) return "missing";
  if (goodUntil == null) return "current";
  if (goodUntil < today) return "expired";
  if (goodUntil <= horizon) return "expiring";
  return "current";
}

export interface FileBuildInput<S extends FileItemSpecBase> {
  today: string;
  /** The items that APPLY to this subject, in display order — the wrapper has already filtered. */
  specs: readonly S[];
  /** What the wrapper found for each item; absent = no evidence. */
  evidenceFor: (spec: S) => FileEvidence | undefined;
  /** Ids of the documents that exist — a cited id outside this set is not a filed document. */
  documentIds: ReadonlySet<string>;
  /** True when the subject has no evidence of any kind on file (→ `not_started`). */
  nothingFiled: boolean;
  expiringWithinDays?: number;
}

/**
 * Build one subject's file.
 *
 * `today` is a parameter rather than read from the clock, so the same file can be rendered "as at"
 * an audit date — which is the question an auditor actually asks, and is impossible to answer from a
 * function that looks at the wall clock.
 */
export function buildFile<S extends FileItemSpecBase>(input: FileBuildInput<S>): FileSummary<S> {
  const today = fileDay(input.today);
  const horizon = addDays(today, input.expiringWithinDays ?? DEFAULT_EXPIRING_DAYS);

  const items: FileItem<S>[] = input.specs
    .map((spec) => {
      const e = input.evidenceFor(spec);
      const present = Boolean(e);
      const goodUntil = goodUntilFor(spec.recurrence, e);
      // A filed document id that points at nothing is not a filed document. The register and the
      // bytes can drift (a failed upload leaves a row behind), and a checklist that trusts the id
      // would report a scan the auditor cannot open.
      const rawDocId = e?.documentId ?? null;
      return {
        spec,
        state: stateFor(present, goodUntil, today, horizon),
        goodUntil,
        evidenceDate: e?.issuedAt ? fileDay(e.issuedAt) : e?.occurredOn ? fileDay(e.occurredOn) : null,
        expiryUnknown: spec.recurrence === "expiry" && present && goodUntil == null,
        documentId: rawDocId && input.documentIds.has(rawDocId) ? rawDocId : null,
      };
    })
    // Advisory items exist only when evidence does (D8): tracked-not-required must never read
    // "missing", never enter the attention feed, and never hold a file back from `complete`.
    .filter((i) => !(i.spec.advisory && i.state === "missing"));

  const counts = emptyCounts();
  for (const i of items) counts[i.state] += 1;

  return {
    items,
    state: input.nothingFiled
      ? "not_started"
      : counts.missing + counts.expired === 0
        ? "complete"
        : "incomplete",
    counts,
  };
}

/**
 * The state a bare DATE would give an item, with no evidence behind it — for the truck file's
 * "date only" line (D-UF3), where McLeod typed an expiry nobody has filed a paper for. The same
 * horizon and the same edges as an item, so "expiring" cannot mean two things on one screen.
 */
export function fileDateState(goodUntil: string, today: string, expiringWithinDays = DEFAULT_EXPIRING_DAYS): FileItemState {
  const t = fileDay(today);
  return stateFor(true, fileDay(goodUntil), t, addDays(t, expiringWithinDays));
}

export function emptyCounts(): Record<FileItemState, number> {
  return { current: 0, expiring: 0, expired: 0, missing: 0 };
}

// ── projections ───────────────────────────────────────────────────────────────────────────────────

/**
 * Rank: expired first, then missing, then soonest-expiring. Overdue beats absent because a lapsed
 * medical card grounds a driver today — and a lapsed registration grounds a truck — while a paper
 * that was never filed has been absent for years and will keep. An ordering that flatters the file
 * over the subject is worse than no ordering.
 */
const STATE_RANK: Record<FileItemState, number> = { expired: 0, missing: 1, expiring: 2, current: 3 };

export function compareFileAttention(a: FileAttentionItem, b: FileAttentionItem): number {
  const byState = STATE_RANK[a.state] - STATE_RANK[b.state];
  if (byState !== 0) return byState;
  // Within a state, soonest first; an item with no date sorts last rather than as "due today".
  if (a.daysRemaining === null && b.daysRemaining === null) return a.label.localeCompare(b.label);
  if (a.daysRemaining === null) return 1;
  if (b.daysRemaining === null) return -1;
  return a.daysRemaining - b.daysRemaining;
}

export function fileAttention<S extends FileItemSpecBase & { group: G }, G extends string>(
  file: FileSummary<S>,
  today: string,
): FileAttentionItem<G>[] {
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
      daysRemaining: i.goodUntil ? fileDaysBetween(fileDay(today), i.goodUntil) : null,
    }))
    .sort(compareFileAttention);
}

/** The worst state in a set of counts — what one word or one chip says about many items. */
export function worstFileState(counts: Record<FileItemState, number>): FileItemState {
  return counts.expired > 0
    ? "expired"
    : counts.missing > 0
      ? "missing"
      : counts.expiring > 0
        ? "expiring"
        : "current";
}

/** Per-group rollup, in the catalogue's group order. A group with no items that apply is absent. */
export function fileGroups<S extends FileItemSpecBase, G extends string>(
  file: FileSummary<S>,
  groups: readonly G[],
  labels: Record<G, string>,
): FileGroupSummary<G>[] {
  const out: FileGroupSummary<G>[] = [];
  for (const group of groups) {
    const items = file.items.filter((i) => i.spec.group === group);
    if (items.length === 0) continue;
    const counts = emptyCounts();
    for (const i of items) counts[i.state] += 1;
    out.push({ group, label: labels[group], counts, state: worstFileState(counts) });
  }
  return out;
}
