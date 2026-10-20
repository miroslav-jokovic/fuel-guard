/**
 * The one word a list's File cell says about a file, and the `?file=` filter that word opens
 * (UNIT-FILES-PLAN UF4). PURE, and subject-free: a truck's, a trailer's and (UF4b) a driver's cell all
 * read it, so "2 expiring" means the same count on every list.
 *
 * ── WORST STATE WINS, AND "DATE ONLY" SITS BETWEEN MISSING AND EXPIRING ─────────────────────────
 * The engine counts an item with no paper as `missing` even when McLeod has a typed date for it (D-UF3:
 * a date with nothing behind it is what an auditor writes up). The chip splits that count in two:
 * nothing at all is "missing"; a date with no paper is "date only" — the office knows the fact and
 * owes the scan, which is a smaller job than finding out. Expired outranks both: a truck past its
 * date is off the road today, whatever is or is not on file.
 *
 * The chip IS the filter: `matchesFileChip` compares `fileChip`'s answer and nothing else, so the number on the
 * chip a reader clicks and the rows the filter shows cannot disagree.
 */
import type { FileItemState } from "./fileEngine.js";
import type { UnitFileRow } from "./unitFileContract.js";

export const FILE_CHIPS = ["expired", "missing", "date_only", "expiring", "complete", "not_started"] as const;
export type FileChipKind = (typeof FILE_CHIPS)[number];

export const FILE_CHIP_LABELS: Record<FileChipKind, string> = {
  expired: "Expired",
  missing: "Missing",
  date_only: "Date only",
  expiring: "Expiring",
  complete: "Complete",
  not_started: "Not started",
};

export interface FileChip {
  kind: FileChipKind;
  /** How many items say it; 0 for `complete` and `not_started`, which are about the whole file. */
  n: number;
  /** "2 expiring", "Complete" — what the cell prints. */
  label: string;
}

export interface FileChipInput {
  state: "not_started" | "incomplete" | "complete";
  counts: Record<FileItemState, number>;
  /** Of `counts.missing`, how many have a typed date beside them (D-UF3). A driver's file has none. */
  dateOnly?: number;
}

const counted = (kind: FileChipKind, n: number): FileChip => ({
  kind,
  n,
  label: kind === "date_only" ? `${n} date only` : `${n} ${FILE_CHIP_LABELS[kind].toLowerCase()}`,
});

export function fileChip(file: FileChipInput): FileChip {
  if (file.state === "not_started") return { kind: "not_started", n: 0, label: FILE_CHIP_LABELS.not_started };
  const dateOnly = file.dateOnly ?? 0;
  const bare = file.counts.missing - dateOnly;
  if (file.counts.expired > 0) return counted("expired", file.counts.expired);
  if (bare > 0) return counted("missing", bare);
  if (dateOnly > 0) return counted("date_only", dateOnly);
  if (file.counts.expiring > 0) return counted("expiring", file.counts.expiring);
  return { kind: "complete", n: 0, label: FILE_CHIP_LABELS.complete };
}

/** The `?file=` filter. An unknown value is NO filter (a typed URL must not empty the fleet). */
export function matchesFileChip(chip: FileChip, filter: string): boolean {
  if (!(FILE_CHIPS as readonly string[]).includes(filter)) return true;
  return chip.kind === filter;
}

/** A unit's chip: its date-only items are counted out of its missing ones (D-UF3). */
export function unitFileChip(row: Pick<UnitFileRow, "state" | "counts" | "items">): FileChip {
  return fileChip({ state: row.state, counts: row.counts, dateOnly: row.items.filter((i) => i.state === "missing" && i.dateOnly).length });
}

/**
 * The File FILTER's words, on every list that shows a file — Drivers, the compliance fleet table,
 * Vehicles, Trailers (UNIT-FILES-PLAN Q-UF9, ruled (b) by the owner 2026-10-20). Every chip word,
 * plus one that is not a chip: "Needs attention", any file whose chip is not `complete`.
 *
 * It replaced the Drivers page's `?dq=` (`DQ_STATE_FILTERS`, "has ANY item in this state"), which
 * sat beside the chip's `?file=` and disagreed with it on two words: `dq=expiring` admitted a driver
 * whose cell says "1 expired", and `dq=complete` admitted one whose cell says "2 expiring". A list
 * whose File control and File cell answer differently is the disagreement D-UF7 refuses, so the
 * filter is the chip, and "Needs attention" is derived from the chip too rather than from a second
 * predicate.
 */
export const FILE_FILTERS = ["attention", ...FILE_CHIPS] as const;
export type FileFilterKind = (typeof FILE_FILTERS)[number];

export const FILE_FILTER_LABELS: Record<FileFilterKind, string> = {
  attention: "Needs attention",
  ...FILE_CHIP_LABELS,
};

/** Ready-made `FilterSelect` options, "Any" first, so no list hand-builds the list. */
export const fileFilterOptions = (): { value: string; label: string }[] => [
  { value: "", label: "Any" },
  ...FILE_FILTERS.map((value) => ({ value, label: FILE_FILTER_LABELS[value] })),
];

/** The `?file=` filter over a chip. An unknown word is NO filter, as `matchesFileChip`'s. */
export function matchesFileFilter(chip: FileChip, filter: string): boolean {
  if (filter === "attention") return chip.kind !== "complete";
  return matchesFileChip(chip, filter);
}
