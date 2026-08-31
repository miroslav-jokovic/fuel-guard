import { computed, type ComputedRef } from "vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { useQueryState } from "@/composables/useQueryState";

/**
 * Which columns of a table this reader wants to see (R3b, D-ROS3/D-ROS15).
 *
 * ── WHY IT STORES WHAT IS HIDDEN, NOT WHAT IS SHOWN ──────────────────────────────────────────────
 * `useSidebarSections` learned this the hard way and wrote it down; the same reasoning applies here
 * exactly. Nothing is stored until somebody expresses a preference, so the stored set starts empty —
 * and the table starts with every column showing. A list of VISIBLE columns would make "empty" mean
 * "no columns", the opposite of the default, and every reader would have to be special-cased on
 * first visit.
 *
 * The second reason is the one that matters legally. R4 adds CDL, medical and hazmat expiry columns.
 * With a stored visible-list, every reader who had ever touched the picker would silently NOT get
 * them — a new column that a §391.51 file depends on, missing from the roster of the people who
 * customised their table most. With a hidden-list, a new column appears for everybody, and only the
 * columns somebody deliberately turned off stay off.
 *
 * ── WHERE IT LIVES: THE URL, WITH localStorage AS THE STICKY DEFAULT ─────────────────────────────
 * The URL so a saved view can capture it (D-ROS14 — a view IS a URL, and a view that cannot say
 * which columns it wants is a view of a different table). `localStorage` so the choice survives a
 * reload of a bare `/drivers`, which is how a person actually returns to a page.
 *
 * Both are written on every toggle, so they cannot disagree about what this reader wants. They can
 * still differ on ARRIVAL, and the rule then is deliberate: **a link's columns win for that visit,
 * and are not written to the reader's own default.** Following somebody's link should not silently
 * reshape your table forever. The corollary is that a link which hides nothing lets the reader's own
 * hidden columns stand — filters and sort are what a link is about, because they change which rows
 * you are looking at; columns only change how you look at them.
 */

/** The identifier column is never hideable: it is the row's name, and the card view's heading. */
const PINNED_INDEX = 0;

const storageKey = (tableId: string) => `fg.cols.${tableId}`;

function readStored(tableId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(tableId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // No storage — Safari private mode throws, and this project's own jsdom has none at all.
    return [];
  }
}

function writeStored(tableId: string, hidden: string[]): void {
  try {
    localStorage.setItem(storageKey(tableId), JSON.stringify(hidden));
  } catch {
    // A preference that cannot be stored still applies for this visit.
  }
}

export interface TableColumns {
  /** What the table should render, in the author's declared order. */
  visible: ComputedRef<DataTableColumn[]>;
  /** Every column, with whether it shows and whether it may be turned off. */
  choices: ComputedRef<{ column: DataTableColumn; shown: boolean; locked: boolean }[]>;
  /** How many the reader has turned off. Zero means "not customised". */
  hiddenCount: ComputedRef<number>;
  toggle: (key: string) => void;
  showAll: () => void;
}

export function useTableColumns(
  tableId: string,
  columns: () => DataTableColumn[],
): TableColumns {
  const { one, list, set } = useQueryState();

  /** The link's answer if it has one, else this reader's own. */
  const hidden = computed<Set<string>>(
    () => new Set(one("hide") !== undefined ? list("hide") : readStored(tableId)),
  );

  const lockedKey = () => columns()[PINNED_INDEX]?.key;

  const visible = computed(() =>
    columns().filter((c) => c.key === lockedKey() || !hidden.value.has(c.key)),
  );

  const choices = computed(() =>
    columns().map((column) => ({
      column,
      shown: column.key === lockedKey() || !hidden.value.has(column.key),
      locked: column.key === lockedKey(),
    })),
  );

  /**
   * The one place a hidden-set is written. Two things are stripped here rather than at each caller:
   * keys for columns that no longer exist (so a preference cannot haunt a table for ever) and the
   * identifier column (so no route into this function can turn it off).
   */
  const apply = (next: Set<string>): void => {
    const keys = columns().map((c) => c.key);
    const cleaned = keys.filter((k) => next.has(k) && k !== lockedKey());
    writeStored(tableId, cleaned);
    set({ hide: cleaned.length ? cleaned.join(",") : undefined });
  };

  const toggle = (key: string): void => {
    const next = new Set(hidden.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
  };

  const showAll = (): void => apply(new Set());

  return {
    visible,
    choices,
    hiddenCount: computed(() => choices.value.filter((c) => !c.shown).length),
    toggle,
    showAll,
  };
}
