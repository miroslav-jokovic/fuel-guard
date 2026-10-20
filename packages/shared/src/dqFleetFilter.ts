import { DQ_ROSTER_COLUMN_KEYS, type DriverOverviewRow } from "./dqFile.js";
import { fileChip, matchesFileFilter } from "./fileChip.js";

/**
 * What "needs attention", "has expired items" and "due in 30 days" MEAN, for any surface that shows
 * a fleet of qualification files (R4b).
 *
 * ── WHY THIS IS SHARED AND NOT A COPY PER PAGE ───────────────────────────────────────────────────
 * The vocabulary was written inline in `QualificationFleetTable.vue`, and R4 gives the roster the
 * same filters. Two copies of a legal-ish predicate is the defect D-DQ6 and D-ROS9 both name from
 * their own ends: the compliance page and the roster would answer "is this driver behind on their
 * §391.51 file" differently, and neither would look wrong on its own screen.
 *
 * `dqSoonest` was ALREADY duplicated before this — once in the fleet table's row builder and once in
 * `attentionStrip.ts` — which is how the drift below started.
 *
 * ── A DISAGREEMENT THIS FILE RECORDS RATHER THAN RESOLVES ────────────────────────────────────────
 * `matchesDqDue` admits an OVERDUE driver into every horizon: it excludes only `soonest > days`. The
 * attention strip's own count does not — it requires `soonest >= 0`. So the tile reading "Due in 30
 * days: 2" opens a list of 3.
 *
 * Both behaviours are preserved exactly as they were, because which one is right is a product ruling
 * (is a lapsed item "due"?) and answering it inside a refactor would change what a compliance screen
 * reports without anyone deciding to. Recorded in DRIVER-ROSTER-PLAN.md §6 as Q7. Pinned by
 * "disagrees with the attention tile that sets it, for the overdue driver (recorded, not endorsed)"
 * in apps/web/src/features/compliance/QualificationFleetTable.test.ts.
 *
 * ── THE FILE-STATUS WORDS LEFT THIS FILE (Q-UF9, 2026-10-20) ─────────────────────────────────────
 * `DQ_STATE_FILTERS` and `matchesDqState` ("has ANY item in this state") are gone: the state filter
 * is the File chip's, `FILE_FILTERS` / `matchesFileFilter` in fileChip.ts, shared with the Vehicles
 * and Trailers lists. What stays here is what only a driver's file has — the due horizon and the
 * one-requirement narrowing.
 */

/** Due-horizon filter values. `""` means any time; the numbers are days. */
export const DQ_DUE_FILTERS = ["", "overdue", "7", "14", "30"] as const;
export type DqDueFilter = (typeof DQ_DUE_FILTERS)[number];

/**
 * The words on the Due control, shared for the same reason the values are.
 *
 * A filter that means the same thing on two pages must SAY the same thing on both, or the reader
 * reasonably concludes they are different filters. These are the compliance page's own labels,
 * moved rather than reworded.
 */
export const DQ_DUE_FILTER_LABELS: Record<DqDueFilter, string> = {
  "": "Due any time",
  overdue: "Overdue",
  "7": "Due in 7 days",
  "14": "Due in 14 days",
  "30": "Due in 30 days",
};

/** Ready-made `FilterSelect` options, so no page hand-builds the pair. */
export const dqDueFilterOptions = (): { value: string; label: string }[] =>
  DQ_DUE_FILTERS.map((value) => ({ value, label: DQ_DUE_FILTER_LABELS[value] }));

/**
 * Days until this driver's most urgent DATED item; negative when overdue, null when nothing they are
 * behind on carries a date at all.
 *
 * Reads `attention`, which is the list of everything not `current` — so a driver whose whole file is
 * in order answers `null`, not "a long time". That is the right answer for a queue and the wrong one
 * for a column, which is why the roster's expiry columns read `requirements` instead (R4a).
 */
export function dqSoonest(row: Pick<DriverOverviewRow, "attention">): number | null {
  const dated = row.attention.filter((a) => a.daysRemaining !== null);
  return dated.length ? Math.min(...dated.map((a) => a.daysRemaining as number)) : null;
}

/** Does this driver's most urgent item fall inside the chosen horizon? */
export function matchesDqDue(row: Pick<DriverOverviewRow, "attention">, filter: string): boolean {
  const soonest = dqSoonest(row);
  if (filter === "overdue") return soonest !== null && soonest < 0;
  if (filter === "7" || filter === "14" || filter === "30") {
    return soonest !== null && soonest <= Number(filter);
  }
  return true;
}

/**
 * Narrow to ONE requirement — "medical expiring in 30 days" rather than "anything expiring".
 *
 * Added at R4b because the two built-in views the plan names by name are per-requirement, and
 * writing them against the whole-file filters would have made the menu lie: `file=expiring` means
 * "some requirement is due soon", and calling that "Medical expiring in 30 days" would be a
 * different claim from what the list actually shows.
 *
 * Reads `requirements` (R4a), which is present for EVERY driver — including the ones with nothing
 * wrong — so it can answer about a current CDL. `attention` cannot: it filters `current` out.
 *
 * With a horizon, it means "this requirement lapses inside N days" (an already-lapsed one is
 * inside every horizon, exactly as `matchesDqDue` treats the whole file). Without one, it means
 * "this requirement is not current" — something is wrong with it, whatever that is.
 */
export function matchesDqRequirement(
  row: Pick<DriverOverviewRow, "requirements">,
  filter: { req?: string; due?: string },
): boolean {
  const key = filter.req ?? "";
  if (!key) return true;
  // A key outside the projected set can only come from a hand-edited link. No filter beats an empty
  // roster, for the same reason `matchesFileFilter` treats an unknown word as no filter.
  if (!(DQ_ROSTER_COLUMN_KEYS as readonly string[]).includes(key)) return true;

  const cell = (row.requirements ?? []).find((r) => r.key === key);
  // Absent means the requirement is not asked of this driver at all — they are not "behind" on it.
  if (!cell) return false;

  const due = filter.due ?? "";
  if (due === "7" || due === "14" || due === "30") {
    return cell.daysRemaining !== null && cell.daysRemaining <= Number(due);
  }
  if (due === "overdue") return cell.daysRemaining !== null && cell.daysRemaining < 0;
  return cell.state !== "current";
}

/** Both filters, which is how every caller wants them. */
export function matchesDqFilters(
  row: Pick<DriverOverviewRow, "state" | "counts" | "attention" | "requirements">,
  filters: { file?: string; due?: string; req?: string },
): boolean {
  // The File chip's word (Q-UF9): the same chip the row's File cell draws, so the two cannot disagree.
  const file = matchesFileFilter(fileChip(row), filters.file ?? "");
  // `req` REPLACES the whole-file horizon when it is set: "medical inside 30 days" is a question
  // about the medical card, and also applying the file-wide horizon would silently add "…and some
  // other requirement is also due", which is a different list.
  if (filters.req) return file && matchesDqRequirement(row, filters);
  return file && matchesDqDue(row, filters.due ?? "");
}
