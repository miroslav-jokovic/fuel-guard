import { computed, type ComputedRef, type WritableComputedRef } from "vue";
import { type DriverStatus, FILE_FILTERS } from "@silvicom/shared";
import { ANY_PARAM, type SortState, toggleSort, useQueryState } from "@silvicom/ui";

/**
 * Everything that decides which drivers the roster is showing, held in the URL (R3c, D-ROS14).
 *
 * ── WHY THIS MOVED OUT OF LOCAL REFS ─────────────────────────────────────────────────────────────
 * A saved view is a name plus a query string. Before this, the roster's search, status, archived
 * toggle, sort and page lived in component refs — so a saved view could have captured the COLUMNS
 * and nothing else, which is exactly the "half a feature" §6 Q3 warned about. It also meant the one
 * thing an office actually does with a filtered roster — send it to somebody — was impossible: a
 * screenshot of a filtered list is unreproducible by the person receiving it.
 *
 * ── WHY THE DEFAULTS ARE ABSENT RATHER THAN SPELLED OUT ──────────────────────────────────────────
 * `?show=live&page=1&dir=asc` is the same view as `/drivers`, and a link that carries it invites the
 * reader to think something has been narrowed. Every setter writes `undefined` when the value
 * returns to its default, so a URL only ever states what somebody chose. It is also what makes
 * "is this view customised" answerable by looking at the query rather than comparing values.
 *
 * ── WHY A FILTER CHANGE CLEARS THE PAGE IN THE SAME PATCH ────────────────────────────────────────
 * Filtering to eleven drivers while sitting on page 4 shows an empty table, which reads as "no
 * drivers match" rather than "you are past the end". It used to be a `watch` that set `page` after
 * the filters changed; here it is part of the same write, because two writes in one tick is the
 * exact hazard `useQueryState` exists for and re-introducing it through the back door would be a
 * poor way to use it.
 *
 * ── AND THEREFORE: ANYTHING CAN BE IN IT ─────────────────────────────────────────────────────────
 * A linkable URL is one a person can hand-edit, bookmark and forward months later. `?page=-4`,
 * `?dir=sideways` and `?show=banana` all have to mean something sensible, so every read is
 * normalised rather than trusted.
 */

export const ROSTER_PAGE_SIZE = 20;

/** The archived toggle's two positions. `live` is the default and is never written to the URL. */
export const VIEW_OPTIONS = [
  { value: "live", label: "On the roster" },
  { value: "archived", label: "Archived" },
];

/** What `/drivers` shows with no status in the URL: the employed fleet, not every row (2026-10-21). */
export const DEFAULT_ROSTER_STATUS: DriverStatus = "active";

export interface RosterFilters {
  search: WritableComputedRef<string>;
  status: WritableComputedRef<string>;
  /** What `status` reads as with nothing in the URL: active on the live roster, every status when archived. */
  defaultStatus: ComputedRef<string>;
  /** Expiry horizon — the SAME vocabulary the compliance fleet table uses (R4b). */
  dqDue: WritableComputedRef<string>;
  /**
   * Narrow the horizon to ONE requirement (`cdl`, `medical_card`, `endorsement_hazmat`).
   *
   * Set by the built-in views rather than by a control: "medical expiring in 30 days" is a named
   * view, not a third dropdown on a toolbar that already has five. It is read here because a view
   * IS a URL (D-ROS14) — there is nowhere else for it to live.
   */
  dqRequirement: WritableComputedRef<string>;
  /**
   * The File cell's chip, as a filter (UNIT-FILES-PLAN UF4b): `FILE_FILTERS` — every chip word plus
   * `attention` — the same vocabulary and the same `?file=` the Vehicles and Trailers lists and the
   * compliance fleet table carry, so "2 expiring" opens the same kind of list on all four. Set by
   * clicking a chip or by the File control; a word outside the vocabulary is no filter at all. Since
   * Q-UF9 it is the roster's ONLY file-status filter; `?dq=` is read for old links (below).
   */
  file: WritableComputedRef<string>;
  /**
   * `none` = active drivers holding no truck (`seatedDriverIds`). Set by the Operations tab's Seats
   * card rather than by a control, exactly as `req` is set by a view — and counted by the page's
   * "Clear filters" for the same reason: the reader needs the way back from a filter they did not pick.
   */
  seat: WritableComputedRef<string>;
  /** `live` or `archived` — the value the "Show" control binds to. */
  view: WritableComputedRef<string>;
  showArchived: ComputedRef<boolean>;
  sort: ComputedRef<SortState>;
  onSort: (key: string) => void;
  page: WritableComputedRef<number>;
  /** True when the reader has narrowed or reordered anything. */
  active: ComputedRef<boolean>;
  reset: () => void;
}

export function useRosterFilters(): RosterFilters {
  const { one, set } = useQueryState();

  /** A filter change always lands on page one, in the SAME patch. */
  const setFiltering = (patch: Record<string, string | undefined>) => set({ ...patch, page: undefined });

  const search = computed<string>({
    get: () => one("q") ?? "",
    set: (v) => setFiltering({ q: v.trim() ? v : undefined }),
  });

  /**
   * Employment status — and the one filter whose default is NOT "everything".
   *
   * Owner, 2026-10-21: the roster read "184 drivers" while McLeod and Med-Stop both said 178. The
   * 184 was 173 active plus 11 terminated drivers nobody had archived; the count answered "how many
   * rows are not archived" when the reader asks "how many drivers do we have". Archiving those 11 is
   * not the fix (0235: archiving is a person choosing to hide a row, kept apart from employment
   * status on purpose), so the default narrows on the status itself. The terminated stay one click
   * away under Status, for the §391.51(c) years their files are kept.
   *
   * The default is absent from the URL like every other default here, so `/drivers` means active,
   * and "All statuses" is written as `ANY_PARAM` — the spelling Vehicles and Recruitment already use
   * for the same situation. It is `useQueryState().param`'s rule written out rather than called,
   * because `param` writes only its own key and a roster filter must clear the page in the same
   * patch (above). A link saying `status=active` (the Seats card's door) reads as before; a link or
   * built-in view with no status now opens on active drivers, which is what "Medical expiring in 30
   * days" always meant — a terminated driver's lapsing card is nobody's morning problem.
   *
   * ⚠ The default is active on the LIVE roster only. The archived view opens on every status:
   * archived drivers are overwhelmingly terminated or inactive (production 2026-10-21: 102
   * terminated, 16 inactive, 1 applicant, 0 active), so an "active" default there would turn the
   * Archived toggle into an empty table that reads as "nobody has ever been archived".
   */
  const showArchived = computed(() => one("show") === "archived");
  const defaultStatus = computed(() => (showArchived.value ? "" : DEFAULT_ROSTER_STATUS));
  const status = computed<string>({
    get: () => {
      const raw = one("status");
      if (raw === undefined) return defaultStatus.value;
      return raw === ANY_PARAM ? "" : raw;
    },
    set: (v) => setFiltering({ status: v === defaultStatus.value ? undefined : v || ANY_PARAM }),
  });

  /**
   * The qualification filters (R4b). The vocabulary is `@silvicom/shared`'s, not this file's — the
   * roster and the compliance fleet table must not answer "is this driver behind on their file"
   * differently, and a second copy of the predicate is how they would.
   */
  const dqDue = computed<string>({
    get: () => one("due") ?? "",
    set: (v) => setFiltering({ due: v || undefined }),
  });

  const dqRequirement = computed<string>({
    get: () => one("req") ?? "",
    set: (v) => setFiltering({ req: v || undefined }),
  });

  /**
   * `?dq=` is the File status filter Q-UF9 retired (2026-10-20). A saved view is a stored query string
   * (D-ROS14) and a link can sit in an email for months, so an old `?dq=` still narrows the roster:
   * its words are all `FILE_FILTERS` words, read here with the chip's meaning. This is a migration
   * read, not a second filter — `?file=` wins when both are present, and any write clears `dq`, so a
   * view re-saved after one change no longer carries it. It can go when no saved view row's query
   * holds `dq=` (one SELECT on `saved_views`).
   */
  const file = computed<string>({
    get: () => {
      const v = one("file") ?? one("dq") ?? "";
      return (FILE_FILTERS as readonly string[]).includes(v) ? v : "";
    },
    set: (v) => setFiltering({ file: v || undefined, dq: undefined }),
  });

  const seat = computed<string>({
    get: () => (one("seat") === "none" ? "none" : ""),
    set: (v) => setFiltering({ seat: v === "none" ? "none" : undefined }),
  });

  const view = computed<string>({
    get: () => (showArchived.value ? "archived" : "live"),
    // Anything that is not the word `archived` means the live roster — including `?show=banana`.
    set: (v) => setFiltering({ show: v === "archived" ? "archived" : undefined }),
  });

  const sort = computed<SortState>(() => {
    const key = one("sort") ?? null;
    // A direction without a column is meaningless, and `desc` is the only other word we accept.
    return { key, dir: key && one("dir") === "desc" ? "desc" : "asc" };
  });
  function onSort(key: string): void {
    const next = toggleSort(sort.value, key);
    // Re-sorting keeps you on your page: unlike a filter, the row you were looking at is still here.
    set({ sort: next.key ?? undefined, dir: next.key && next.dir === "desc" ? "desc" : undefined });
  }

  const page = computed<number>({
    get: () => {
      const n = Number.parseInt(one("page") ?? "1", 10);
      return Number.isFinite(n) && n > 0 ? n : 1;
    },
    set: (v) => set({ page: v > 1 ? String(v) : undefined }),
  });

  const active = computed(
    () => Boolean(one("q") || one("status") || one("show") || one("dq") || one("due") || one("req") || one("file") || one("seat")),
  );

  // Clears what narrows the roster and keeps the sort: the sort orders the list rather than
  // narrowing it, and "Clear filters" means the same on every list (DESIGN-SYSTEM-CONTRACT §5.5).
  const reset = (): void =>
    set({
      q: undefined, status: undefined, show: undefined,
      dq: undefined, due: undefined, req: undefined, file: undefined, seat: undefined, page: undefined,
    });

  return {
    search, status, defaultStatus, dqDue, dqRequirement, file, seat,
    view, showArchived, sort, onSort, page, active, reset,
  };
}
