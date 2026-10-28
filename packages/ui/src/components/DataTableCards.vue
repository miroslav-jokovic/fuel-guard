<script setup lang="ts" generic="Row extends Record<string, any>">
import { computed } from "vue";
import type { DataTableColumn } from "./DataTable.vue";
import type { SortState } from "../lists/sort";
import { isBlank } from "../lists/dataTable";
import { useTouchTargets } from "../touchTargets";

/**
 * The narrow-screen half of `DataTable` — one card per row, no table.
 *
 * ── WHY CARDS AT ALL ─────────────────────────────────────────────────────────────────────────────
 * A seven-column table on a 375px phone is a horizontal scroll with two columns visible, which is not
 * a table any more — it is a puzzle. Below `md` each row becomes a card: the first column is the
 * heading, the rest are label/value pairs.
 *
 * ── WHY IT IS ITS OWN FILE (R3b, 2026-08-30) ─────────────────────────────────────────────────────
 * `DataTable.vue` stood at 454 lines against a 500-line budget (`lint:filesize`, warns at 450), and
 * R3 adds column management to it. This is the largest self-contained piece, and the one the table
 * path never touches. The parent still decides WHICH branch renders; this file only renders one.
 *
 * The parent forwards every slot verbatim, so a `#cell-<key>` written for the table reaches the card
 * too — that is what keeps the two branches showing the same thing. Pinned by
 * "renders the narrow card list unchanged" in `DataTable.test.ts`.
 *
 * ── THREE FACTS (DESIGN-SYSTEM-CONTRACT.md §9 rule 3, Maintenance M4) ───────────────────────────
 * When the page marks its columns (`card:` on `DataTableColumn`), a card is the row's identifier, the
 * one sentence that says why it is here, and one date or amount — and the whole card opens the row.
 * The identifier's link is stretched over the card (`TITLE` below), so the target is the card,
 * 70-odd px tall, not a 20 px line of text; a link or button inside a sentence or the row's actions
 * sits above the stretch (`OVER`). A card with no link emits `row-click`, as a table row does.
 */
const props = defineProps<{
  columns: DataTableColumn[];
  rows: Row[];
  /** Resolved by the parent, which owns the `rowKey` prop — never re-derived here. */
  keyOf: (row: Row) => string;
  selectable: boolean;
  selected?: Set<string>;
  sort?: SortState | null;
  expanded?: Set<string>;
  hasActions: boolean;
}>();

const emit = defineEmits<{ sort: [key: string]; "toggle-row": [row: Row]; "row-click": [row: Row] }>();

/** The page's three facts, when it has said which they are; null keeps the full card below. */
const facts = computed(() => {
  if (!props.columns.some((col) => col.card !== undefined)) return null;
  const of = (kind: DataTableColumn["card"]) => props.columns.filter((col) => col.card === kind);
  return { title: of("title"), sentence: of("sentence"), meta: of("meta") };
});
/**
 * The stretch, as classes rather than a scoped style: a scoped block would stamp a `data-v` attribute
 * on every element here, the unmarked card's included, and that card's markup is pinned unchanged.
 */
const TITLE = "[&_a]:after:absolute [&_a]:after:inset-0 [&_button]:after:absolute [&_button]:after:inset-0";
const OVER = "[&_a]:relative [&_a]:z-raised [&_button]:relative [&_button]:z-raised [&_input]:relative [&_input]:z-raised";
/** 48 px for the sort control and the checkbox's label under the touch floor (contract §9 rule 1). */
const touch = useTouchTargets();

const cellValue = (row: Row, key: string) => row[key];
const isSelected = (row: Row) => props.selected?.has(props.keyOf(row)) ?? false;
const isExpanded = (row: Row) => props.expanded?.has(props.keyOf(row)) ?? false;

/**
 * A column with no label is a CONTROL — an expand chevron, a "View" link — not a field (F25, US6b).
 * A table header can hold it in a narrow unlabelled cell; a card cannot, because a card names every
 * value it shows. When the qualification table's chevron came first it became the card's heading, and
 * every phone card opened with an empty row holding only the chevron. So controls sit on the card's
 * top line, beside the status, and the heading is the first column that has a name.
 */
const isControl = (col: DataTableColumn) => !col.label;
const headingColumn = computed(() => props.columns.find((col) => !isControl(col)) ?? props.columns[0]);
const controlColumns = computed(() =>
  props.columns.filter((col) => isControl(col) && col.key !== headingColumn.value?.key && !STATUS_KEYS.test(col.key)),
);
/**
 * The card's shape, decided from what a person actually scans on a phone.
 *
 * The heading row carries the identifier and — pulled out of the list — the STATUS, because status
 * is the one field someone is looking for when they scan a list of fills or loads. Left in the
 * label/value grid it read as just another row, which is what made the first version feel flat.
 *
 * A column counts as status when its key says so. That is a convention rather than a new flag on
 * `DataTableColumn`: 49 column arrays already exist, and a flag none of them set would be a
 * migration disguised as an option.
 */
const STATUS_KEYS = /^(status|state|result|outcome|severity|disposition)$/;
const statusColumn = computed(() => props.columns.find((col) => STATUS_KEYS.test(col.key)));
const bodyColumns = computed(() =>
  props.columns.filter(
    (col) => col.key !== headingColumn.value?.key && col.key !== statusColumn.value?.key && !isControl(col),
  ),
);

/** Quantities read as a block on their own row; words read better in a two-column grid. */
const numericBodyColumns = computed(() => bodyColumns.value.filter((c) => c.numeric));
const textBodyColumns = computed(() => bodyColumns.value.filter((c) => !c.numeric));

/**
 * Sorting is a header affordance, and cards have no headers — so without this it would simply
 * disappear below 768px. Losing the ability to order a list is a functional regression, not a
 * responsive trade-off, so the sortable columns come back as an explicit control.
 */
const sortableColumns = computed(() => props.columns.filter((col) => col.sortable));

/**
 * The column ordering the cards, or null for the page's own default order. A page may name a default
 * that is no column (Fuel Cards' `assignment`): bound straight to `sort.key`, the select matched no
 * option and opened blank on a phone (2026-10-15), beside an arrow for an order no header shows.
 */
const sortedColumn = computed(() => {
  const col = sortableColumns.value.find((c) => c.key === props.sort?.key);
  return col ? { key: col.key, dir: props.sort!.dir } : null;
});

/** A stable id so the card view's sort control can label itself without colliding across tables. */
const listId = `dt-${Math.random().toString(36).slice(2, 8)}`;

/** The select picks the COLUMN; the arrow beside it flips direction, matching the header's toggle. */
function onCardSort(key: string) {
  if (!key) return;
  emit("sort", key);
}
</script>

<template>
  <!-- Narrow: one card per row. Same slots, same data, no table. -->
  <div v-if="sortableColumns.length" class="flex items-center gap-2 border-b border-edge-subtle px-4 py-2.5">
    <label class="text-2xs font-medium uppercase tracking-wide text-ink-muted" :for="`${listId}-sort`">
      Sort
    </label>
    <select
      :id="`${listId}-sort`"
      class="min-w-0 flex-1 rounded-control bg-surface px-2 py-1.5 text-sm text-ink-secondary ring-1 ring-inset ring-edge-control"
      :class="touch && 'h-12'"
      :value="sortedColumn?.key ?? ''"
      @change="onCardSort(($event.target as HTMLSelectElement).value)"
    >
      <option value="">Default order</option>
      <option v-for="col in sortableColumns" :key="col.key" :value="col.key">{{ col.label }}</option>
    </select>
    <button
      v-if="sortedColumn"
      type="button"
      class="rounded-control px-2 py-1.5 text-sm font-medium text-ink-secondary ring-1 ring-inset ring-edge-control"
      :class="touch && 'size-12'"
      :aria-label="sortedColumn.dir === 'asc' ? 'Sorted ascending, switch to descending' : 'Sorted descending, switch to ascending'"
      @click="emit('sort', sortedColumn.key)"
    >
      {{ sortedColumn.dir === "asc" ? "↑" : "↓" }}
    </button>
  </div>

  <ul v-if="facts" class="divide-y divide-edge-subtle">
    <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -- the table row's own click, for a card whose title is not a link; a link title is the keyboard's way in -->
    <li v-for="row in rows" :key="keyOf(row)" class="relative px-4 py-3.5" @click="emit('row-click', row)">
      <div class="flex items-start gap-3">
        <label
          v-if="selectable"
          class="-my-3 -ml-3 flex shrink-0 items-center justify-center"
          :class="[OVER, touch ? 'size-12' : 'size-10']"
          @click.stop
        >
          <input
            type="checkbox"
            class="size-4 rounded-control border-edge-control accent-brand-600"
            :checked="isSelected(row)"
            :aria-label="`Select ${String(cellValue(row, facts.title[0]?.key ?? headingColumn!.key) ?? 'row')}`"
            @change="emit('toggle-row', row)"
          />
        </label>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-3">
            <div v-for="col in facts.title" :key="col.key" :class="TITLE" class="min-w-0 flex-1 truncate text-base font-semibold text-ink">
              <slot :name="`cell-${col.key}`" :row="row" :value="cellValue(row, col.key)">
                {{ isBlank(cellValue(row, col.key)) ? "—" : cellValue(row, col.key) }}
              </slot>
            </div>
            <div v-for="col in facts.meta" :key="col.key" :class="OVER" class="shrink-0 text-sm tabular-nums text-ink-secondary">
              <slot :name="`cell-${col.key}`" :row="row" :value="cellValue(row, col.key)">
                {{ isBlank(cellValue(row, col.key)) ? "—" : cellValue(row, col.key) }}
              </slot>
            </div>
          </div>
          <div v-for="col in facts.sentence" :key="col.key" :class="OVER" class="mt-1 text-sm text-ink-secondary">
            <slot :name="`cell-${col.key}`" :row="row" :value="cellValue(row, col.key)">
              {{ isBlank(cellValue(row, col.key)) ? "—" : cellValue(row, col.key) }}
            </slot>
          </div>
          <div v-if="isExpanded(row)" :class="OVER" class="mt-2.5">
            <slot name="expanded" :row="row" />
          </div>
        </div>
        <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -- stops the card's click; the menu inside is its own button -->
        <div v-if="hasActions" :class="OVER" class="relative z-raised shrink-0" @click.stop>
          <slot name="actions" :row="row" />
        </div>
      </div>
    </li>
  </ul>

  <ul v-else class="divide-y divide-edge-subtle">
    <li v-for="row in rows" :key="keyOf(row)" class="px-4 py-3.5">
      <div class="flex items-start gap-3">
        <input
          v-if="selectable"
          type="checkbox"
          class="mt-0.5 size-4 shrink-0 rounded-control border-edge-control accent-brand-600"
          :checked="isSelected(row)"
          :aria-label="`Select ${String(cellValue(row, headingColumn!.key) ?? 'row')}`"
          @change="emit('toggle-row', row)"
        />
        <div class="min-w-0 flex-1">
          <!-- Identifier and status share the top line: the two things a scan is looking for. -->
          <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
              <slot :name="`cell-${headingColumn!.key}`" :row="row" :value="cellValue(row, headingColumn!.key)">
                {{ isBlank(cellValue(row, headingColumn!.key)) ? "—" : cellValue(row, headingColumn!.key) }}
              </slot>
            </div>
            <div v-if="statusColumn" class="shrink-0">
              <slot :name="`cell-${statusColumn.key}`" :row="row" :value="cellValue(row, statusColumn.key)">
                {{ isBlank(cellValue(row, statusColumn.key)) ? "—" : cellValue(row, statusColumn.key) }}
              </slot>
            </div>
            <div v-for="col in controlColumns" :key="col.key" class="shrink-0">
              <slot :name="`cell-${col.key}`" :row="row" :value="cellValue(row, col.key)" />
            </div>
          </div>

          <!-- Quantities first, as a row of stacked label-over-value blocks: on a phone they are
               compared against each other, and a two-column grid puts them too far apart. -->
          <div v-if="numericBodyColumns.length" class="mt-2.5 flex flex-wrap gap-x-5 gap-y-2">
            <div v-for="col in numericBodyColumns" :key="col.key" class="min-w-0">
              <div class="text-2xs uppercase tracking-wide text-ink-muted">{{ col.label }}</div>
              <div class="mt-0.5 text-sm font-medium tabular-nums text-ink">
                <slot :name="`cell-${col.key}`" :row="row" :value="cellValue(row, col.key)">
                  {{ isBlank(cellValue(row, col.key)) ? "—" : cellValue(row, col.key) }}
                </slot>
              </div>
            </div>
          </div>

          <dl
            v-if="textBodyColumns.length"
            class="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-t border-edge-subtle pt-2.5"
          >
            <template v-for="col in textBodyColumns" :key="col.key">
              <dt class="truncate text-2xs uppercase tracking-wide text-ink-muted">{{ col.label }}</dt>
              <dd class="min-w-0 text-sm text-ink-secondary">
                <slot :name="`cell-${col.key}`" :row="row" :value="cellValue(row, col.key)">
                  {{ isBlank(cellValue(row, col.key)) ? "—" : cellValue(row, col.key) }}
                </slot>
              </dd>
            </template>
          </dl>
          <div v-if="isExpanded(row)" class="mt-2.5">
            <slot name="expanded" :row="row" />
          </div>
        </div>
        <div v-if="hasActions" class="shrink-0">
          <slot name="actions" :row="row" />
        </div>
      </div>
    </li>
  </ul>
  <slot name="footer" />
</template>

