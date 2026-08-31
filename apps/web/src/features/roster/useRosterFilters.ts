import { computed, type ComputedRef, type WritableComputedRef } from "vue";
import type { SortState } from "@/lib/sort";
import { toggleSort } from "@/lib/sort";
import { useQueryState } from "@/composables/useQueryState";

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

export interface RosterFilters {
  search: WritableComputedRef<string>;
  status: WritableComputedRef<string>;
  /** §391.51 file status — the SAME vocabulary the compliance fleet table uses (R4b). */
  dqState: WritableComputedRef<string>;
  /** Expiry horizon, same vocabulary again. */
  dqDue: WritableComputedRef<string>;
  /**
   * Narrow the horizon to ONE requirement (`cdl`, `medical_card`, `endorsement_hazmat`).
   *
   * Set by the built-in views rather than by a control: "medical expiring in 30 days" is a named
   * view, not a third dropdown on a toolbar that already has five. It is read here because a view
   * IS a URL (D-ROS14) — there is nowhere else for it to live.
   */
  dqRequirement: WritableComputedRef<string>;
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

  const status = computed<string>({
    get: () => one("status") ?? "",
    set: (v) => setFiltering({ status: v || undefined }),
  });

  /**
   * The qualification filters (R4b). The vocabulary is `@silvicom/shared`'s, not this file's — the
   * roster and the compliance fleet table must not answer "is this driver behind on their file"
   * differently, and a second copy of the predicate is how they would.
   */
  const dqState = computed<string>({
    get: () => one("dq") ?? "",
    set: (v) => setFiltering({ dq: v || undefined }),
  });
  const dqDue = computed<string>({
    get: () => one("due") ?? "",
    set: (v) => setFiltering({ due: v || undefined }),
  });

  const dqRequirement = computed<string>({
    get: () => one("req") ?? "",
    set: (v) => setFiltering({ req: v || undefined }),
  });

  const showArchived = computed(() => one("show") === "archived");
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
    () => Boolean(one("q") || one("status") || one("show") || one("sort") || one("dq") || one("due") || one("req")),
  );

  const reset = (): void =>
    set({
      q: undefined, status: undefined, show: undefined, sort: undefined, dir: undefined,
      dq: undefined, due: undefined, req: undefined, page: undefined,
    });

  return {
    search, status, dqState, dqDue, dqRequirement,
    view, showArchived, sort, onSort, page, active, reset,
  };
}
