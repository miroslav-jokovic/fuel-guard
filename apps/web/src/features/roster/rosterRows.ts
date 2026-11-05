import { sortRows, type SortState } from "@silvicom/ui";
import {
  FILE_FILTERS,
  compareDqUrgency,
  fileChip,
  matchesDqFilters,
  matchesFileFilter,
  type DqRosterColumnKey,
  type Driver,
  type DriverOverviewRow,
  type FileFilterKind,
} from "@silvicom/shared";

/**
 * The roster's rows: which drivers pass the toolbar, how many would pass each File word, and in what
 * order (DQ-INTO-DRIVERS-PLAN DD1). Pure, so the three answers are tested together, and out of
 * `DriversPage.vue`, which stood at 399 lines against a 500-line budget with DD2 still to come.
 *
 * ── WHY THE COUNTS AND THE FILTER ARE ONE FUNCTION (D-DQ18) ─────────────────────────────────────
 * "Expired (4)" is a promise: choose it and four rows appear. So a count is computed by the very
 * predicate the list applies, with every OTHER control as it is set — search, status, archived, seat,
 * due — and only the File word varied. Counted over the whole fleet instead, the number would be
 * right on an empty toolbar and wrong the moment anything else was set.
 */
export interface RosterRowFilters {
  term: string;
  status: string;
  showArchived: boolean;
  /** "none" = only drivers no vehicle seats. */
  seat: string;
  seated: ReadonlySet<string>;
  file: string;
  due: string;
  req: string;
}

/** Everything but the File word: the half of the predicate the counts hold still. */
function matchesExceptFile(
  d: Driver,
  overview: ReadonlyMap<string, DriverOverviewRow>,
  f: RosterRowFilters,
): boolean {
  if (Boolean(d.archived_at) !== f.showArchived) return false;
  if (f.status && d.status !== f.status) return false;
  if (f.seat === "none" && f.seated.has(d.id)) return false;
  if (f.due || f.req) {
    const row = overview.get(d.id);
    if (!row || !matchesDqFilters(row, { due: f.due, req: f.req })) return false;
  }
  const term = f.term.toLowerCase();
  if (!term) return true;
  return [d.full_name, d.employee_id, d.phone, d.samsara_username]
    .filter(Boolean)
    .some((x) => x!.toLowerCase().includes(term));
}

export function filterRoster(
  drivers: readonly Driver[],
  overview: ReadonlyMap<string, DriverOverviewRow>,
  f: RosterRowFilters,
): Driver[] {
  return drivers.filter((d) => {
    if (!matchesExceptFile(d, overview, f)) return false;
    if (!f.file) return true;
    // A driver the rollup does not return (an EFS stub, a terminated file) has no §391.51 picture to
    // match against, so a File word excludes them rather than admitting them as "nothing wrong".
    const row = overview.get(d.id);
    return Boolean(row) && matchesFileFilter(fileChip(row!), f.file);
  });
}

/** How many rows each File word would leave, the other controls as set (D-DQ18). */
export function fileFilterCounts(
  drivers: readonly Driver[],
  overview: ReadonlyMap<string, DriverOverviewRow>,
  f: RosterRowFilters,
): Record<FileFilterKind, number> {
  const counts = Object.fromEntries(FILE_FILTERS.map((k) => [k, 0])) as Record<FileFilterKind, number>;
  for (const d of drivers) {
    const row = overview.get(d.id);
    if (!row || !matchesExceptFile(d, overview, f)) continue;
    const chip = fileChip(row);
    for (const k of FILE_FILTERS) if (matchesFileFilter(chip, k)) counts[k] += 1;
  }
  return counts;
}

/** The three expiry columns, by the requirement each one reads (R4, D-ROS9). */
export const EXPIRY_SORT_KEYS: Record<string, DqRosterColumnKey> = {
  cdl_expiry: "cdl",
  medical_expiry: "medical_card",
  hazmat_expiry: "endorsement_hazmat",
};

/**
 * The roster in the order the URL asks for.
 *
 * - `file` — the File column: worst file first, then soonest due (`compareDqUrgency`, the order the
 *   qualification list opened in), name breaking ties. Descending reverses the files; a driver the
 *   rollup does not return stays last either way, as a blank cell does under `sortRows`.
 * - `cdl_expiry` / `medical_expiry` / `hazmat_expiry` — the date the requirement stops being good,
 *   from the same rollup the cell draws. A requirement with no date sorts last, `sortRows`'s rule.
 * - anything else is a field on the driver, handed to `sortRows` unchanged.
 */
export function sortRoster(
  rows: readonly Driver[],
  sort: SortState,
  overview: ReadonlyMap<string, DriverOverviewRow>,
): Driver[] {
  if (sort.key === "file") {
    const known = rows.filter((d) => overview.has(d.id));
    const unknown = rows.filter((d) => !overview.has(d.id));
    const dir = sort.dir === "desc" ? -1 : 1;
    const ordered = [...known].sort(
      (a, b) =>
        dir * compareDqUrgency(overview.get(a.id)!, overview.get(b.id)!) || a.full_name.localeCompare(b.full_name),
    );
    return [...ordered, ...unknown];
  }
  const requirement = sort.key ? EXPIRY_SORT_KEYS[sort.key] : undefined;
  if (requirement) {
    return sortRows([...rows], sort, (d) =>
      overview.get(d.id)?.requirements.find((r) => r.key === requirement)?.goodUntil ?? null,
    );
  }
  return sortRows([...rows], sort);
}
