<script setup lang="ts" generic="Row extends Record<string, any>">
import { AppIcon } from "@silvicom/ui";
import { ChevronUpIcon, ChevronDownIcon, ChevronUpDownIcon } from "@silvicom/ui/icons";
import { computed, useSlots } from "vue";
import { useMediaQuery } from "@vueuse/core";
import { AppCard as BaseCard } from "@silvicom/ui";
import TableSkeleton from "@/components/TableSkeleton.vue";
import DataTableCards from "@/components/ui/DataTableCards.vue";
import ErrorState from "@/components/ErrorState.vue";
import type { SortState } from "@/lib/sort";
import { cellValue, isBlank } from "@/components/ui/dataTable";

/**
 * The one data table. Column-definition driven so alignment, selection,
 * sorting and the actions column are consistent everywhere.
 *
 *   <DataTable :columns="cols" :rows="pageRows" row-key="id"
 *              :loading="isLoading" :error="errMsg" :retrying="isFetching"
 *              :sort="sort" @sort="onSort" @retry="refetch"
 *              selectable :selected="selected" @update:selected="selected = $event"
 *              empty-text="No vehicles match these filters.">
 *     <template #cell-unit_number="{ row }">
 *       <RouterLink :to="`/vehicles/${row.id}`" class="font-medium text-link hover:text-link-hover">…</RouterLink>
 *     </template>
 *     <template #actions="{ row }">
 *       <KebabMenu><BaseButton class="kebab-item" @click="openEdit(row)">Edit</BaseButton></KebabMenu>
 *     </template>
 *     <template #footer><TablePagination … /></template>
 *   </DataTable>
 *
 * Column contract (enterprise table conventions):
 *  - text columns left-aligned (the default — omit `align`); `numeric: true` → right-aligned +
 *    tabular-nums; headers follow their column. `align` overrides, and `align: "center"` is for
 *    control columns only — checkbox, icon, status dot — never for text or numbers (D-DS1)
 *  - `sortable: true` renders the standard sort button + direction indicator
 *  - `width` sets the column's minimum width from a named scale (D-DS5); `headerClass` is for
 *    everything else. A fixed `w-32` still goes in `headerClass` — that is a different intent.
 *  - cells default to `row[key]` with an ink-subtle "—" for null/empty;
 *    override per column with #cell-<key>="{ row, value }"
 * Selection appears ONLY when `selectable` (i.e. the page has bulk actions).
 * The header checkbox selects/clears the current page; indeterminate when partial.
 * Sticky header: thead pins while the table's own scroll area (max-h-[70vh]) scrolls.
 * Expandable rows: pass `expanded` (a Set of row keys) and an #expanded="{ row }" slot; each
 * expanded row renders a full-width detail row beneath it. The page owns the Set — the table
 * only renders.
 * Pinned lead column: `pin-first-column` keeps the first data column in place while the rest scroll
 * sideways, and puts `group` on every row so the pinned cell follows its row's hover. Do not
 * hand-write `sticky left-0` on a column — that is what this replaced.
 */
export interface DataTableColumn {
  key: string;
  label: string;
  sortable?: boolean;
  /** Quantity column: right-aligned + tabular-nums, so figures line up on the digit. */
  numeric?: boolean;
  /** Override the default (text → left, `numeric` → right). `center` is for control columns only. */
  align?: "left" | "right" | "center";
  /** Extra th classes — widths live here (min-w-[8rem], w-32, …). */
  /**
   * Minimum column width, from the scale below. Replaces 173 hand-picked `min-w-[Nrem]` values
   * spread across 26 files in 15 different sizes, none of which agreed with each other (D-DS5).
   */
  width?: ColumnWidth;
  headerClass?: string;
  /** Extra td classes — truncation, tone overrides, … */
  cellClass?: string;
}

/**
 * The column-width scale.
 *
 * ── How these seven numbers were chosen ─────────────────────────────────────────────────────────
 * Not by taste. The 173 existing widths were counted, and every candidate scale scored against that
 * distribution for how many columns it would move and in which direction. Every six-step scale moved
 * roughly half of them, some SHRINKING by up to 8rem — and a shrinking min-width is the dangerous
 * direction, because that is where text starts to wrap. This scale is the one that rounds strictly
 * UP: 94 columns widen, by at most 4rem, and none narrow. In a table that already scrolls
 * horizontally, widening costs a little scroll and cannot clip or overlap anything.
 *
 * The values map onto Tailwind's own spacing steps, so the component holds no arbitrary values
 * either: 4rem = min-w-16, 6rem = min-w-24, 8rem = min-w-32, 11rem = min-w-44, 14rem = min-w-56,
 * 18rem = min-w-72, 24rem = min-w-96.
 */
export type ColumnWidth = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

const WIDTHS: Record<ColumnWidth, string> = {
  xs: "min-w-16", // 4rem  — short counts, flags
  sm: "min-w-24", // 6rem  — codes, short statuses
  md: "min-w-32", // 8rem  — dates, amounts
  lg: "min-w-44", // 11rem — names, stations
  xl: "min-w-56", // 14rem — descriptions
  "2xl": "min-w-72", // 18rem
  "3xl": "min-w-96", // 24rem — the widest column a table should carry
};

const props = withDefaults(
  defineProps<{
    columns: DataTableColumn[];
    rows: Row[];
    /** Property name or accessor used for selection + v-for keys. */
    rowKey?: string | ((row: Row) => string);
    loading?: boolean;
    error?: string | null;
    retrying?: boolean;
    emptyText?: string;
    /** Bulk-action tables only — renders the leading checkbox column. */
    selectable?: boolean;
    selected?: Set<string>;
    /** Controlled sort state (lib/sort). Emits `sort` with the column key. */
    sort?: SortState | null;
    /** text-xs density for audit/sub tables. */
    dense?: boolean;
    /** Set false for tables whose cells should wrap. */
    nowrap?: boolean;
    /** Pin the header while the table scrolls (default on). */
    stickyHeader?: boolean;
    /** Extra classes per row (tints, cursor). Selected tint is built in. */
    rowClass?: (row: Row) => string;
    embedded?: boolean;
    /** Row keys whose #expanded detail row is currently shown. */
    expanded?: Set<string>;
    /**
     * Keep the first column visible while the rest scroll sideways.
     *
     * Promoted at R3b. It was already real on three pages — `FuelLogPage`, `TransactionsPage` and
     * `RejectionsPage` — as byte-identical copies of two class strings AND a `row-class` returning
     * `group`, which each page spelled differently. The third part is the trap: without `group` on
     * the row, `group-hover:bg-surface-subtle` never fires and the pinned cell silently stops
     * following its own row on hover. Three coordinated pieces that had to agree across three files
     * is what a prop is for (D-ROS11: a value copied is a workaround with a delay fuse).
     *
     * Pins the first DATA column. A table that also sets `selectable` puts its checkbox column at
     * `left-0` as well, so the two would overlap; no caller does both, and the day one wants to,
     * the offset is the change to make rather than a second class string.
     */
    pinFirstColumn?: boolean;
  }>(),
  {
    rowKey: "id",
    loading: false,
    error: null,
    retrying: false,
    emptyText: "No results.",
    selectable: false,
    selected: undefined,
    sort: null,
    dense: false,
    nowrap: true,
    stickyHeader: true,
    rowClass: undefined,
    embedded: false,
    expanded: undefined,
    pinFirstColumn: false,
  },
);

const emit = defineEmits<{
  retry: [];
  sort: [key: string];
  "update:selected": [selected: Set<string>];
  "row-click": [row: Row];
}>();

const slots = useSlots();
const hasActions = computed(() => !!slots.actions);

const keyOf = (row: Row): string =>
  typeof props.rowKey === "function" ? props.rowKey(row) : String(row[props.rowKey]);

/* ── selection ────────────────────────────────────────────────────────── */
const pageKeys = computed(() => props.rows.map(keyOf));
const allSelected = computed(
  () => pageKeys.value.length > 0 && pageKeys.value.every((k) => props.selected?.has(k)),
);
const someSelected = computed(
  () => !allSelected.value && pageKeys.value.some((k) => props.selected?.has(k)),
);
function toggleAll() {
  const next = new Set(props.selected ?? []);
  if (allSelected.value) pageKeys.value.forEach((k) => next.delete(k));
  else pageKeys.value.forEach((k) => next.add(k));
  emit("update:selected", next);
}
function toggleRow(row: Row) {
  const k = keyOf(row);
  const next = new Set(props.selected ?? []);
  if (next.has(k)) next.delete(k);
  else next.add(k);
  emit("update:selected", next);
}
const isSelected = (row: Row) => props.selected?.has(keyOf(row)) ?? false;

/* ── alignment & padding (headers follow their column) ────────────────── */
/**
 * Words left, quantities right, centre only for controls (D-DS1).
 *
 * ── What this replaced, and why it mattered ─────────────────────────────────────────────────────
 * This function used to fall through to `text-center` when `align` was absent — and
 * `apps/web/CLAUDE.md` told every author to omit `align`. The result: 376 of 387 column definitions
 * in the app rendered centred, including every gallons, amount, MPG and count column in a product
 * whose whole job is comparing numbers down a column. The docstring above claimed the opposite
 * behaviour, so nothing read like a bug; it took mounting the component to see it (audit
 * 2026-08-23). No gate caught it — `lint:tokens` checks colour, not layout.
 *
 * `numeric` now carries alignment as well as `tabular-nums`, because the two are one decision:
 * right-aligned tabular figures line up on the digit, which is the entire reason to mark a column
 * numeric. An explicit `align` still wins, for the columns that genuinely need it.
 */
const alignCls = (col: DataTableColumn): string => {
  if (col.align === "left") return "text-left";
  if (col.align === "right") return "text-right";
  if (col.align === "center") return "text-center";
  return col.numeric ? "text-right" : "text-left";
};

const pad = computed(() => (props.dense ? "px-4 py-2" : "px-4 py-3"));

/** Edge padding: first/last cells align content with the card's p-5/p-6 gutters. */
const cellCls = (col: DataTableColumn, i: number): string[] => [
  pad.value,
  alignCls(col),
  col.numeric ? "tabular-nums" : "",
  i === 0 && !props.selectable ? "pl-6" : "",
  i === props.columns.length - 1 && !hasActions.value ? "pr-6" : "",
];

/**
 * The pinned-column classes, in one place so the three pages that had them inline can stop agreeing
 * with each other by hand. `z-sticky-lead` outranks the sticky header's `z-sticky` at the corner
 * where both pin, and the cell repeats the surface colour because a transparent cell would let the
 * scrolled columns show through underneath it.
 */
const PIN_HEADER = "sticky left-0 z-sticky-lead bg-surface-subtle border-r border-edge";
const PIN_CELL =
  "sticky left-0 z-raised border-r border-edge bg-surface font-medium text-ink group-hover:bg-surface-subtle";
const pinCls = (i: number, which: string) => (props.pinFirstColumn && i === 0 ? which : "");

const skeletonCols = computed(
  () => props.columns.length + (props.selectable ? 1 : 0) + (hasActions.value ? 1 : 0),
);

const isExpanded = (row: Row) => props.expanded?.has(keyOf(row)) ?? false;

/* ── narrow screens get cards, not a table ────────────────────────────────────────────────────────
 * A seven-column table on a 375px phone is a horizontal scroll with two columns visible, which is
 * not a table any more — it is a puzzle. Below `md` each row becomes a card, rendered by
 * `DataTableCards.vue` (extracted at R3b so column management fits in this file's budget).
 *
 * Rendered through a media query rather than `hidden md:block` on two copies of the markup, because
 * duplicating means every row exists twice in the DOM. `display: none` does keep the hidden copy out
 * of the accessibility tree, so duplication would not have been an a11y bug — it would have been a
 * weight bug, and on the pages that carry these tables the row count is exactly what is large.
 */
const isWide = useMediaQuery("(min-width: 768px)");

</script>

<template>
  <component :is="embedded ? 'div' : BaseCard" :padding="embedded ? undefined : 'none'">
    <TableSkeleton v-if="loading" :cols="skeletonCols" />
    <ErrorState v-else-if="error" :message="error" :retrying="retrying" @retry="emit('retry')" />
    <div v-else-if="rows.length === 0" class="px-6 py-10 text-center text-sm text-ink-muted">
      <slot name="empty">{{ emptyText }}</slot>
    </div>
    <DataTableCards
      v-else-if="!isWide"
      :columns="columns"
      :rows="rows"
      :key-of="keyOf"
      :selectable="selectable"
      :selected="selected"
      :sort="sort"
      :expanded="expanded"
      :has-actions="hasActions"
      @sort="emit('sort', $event)"
      @toggle-row="toggleRow"
    >
      <!-- Every slot verbatim, so a `#cell-<key>` written for the table reaches the card unchanged.
           Forwarding by name rather than listing them is the only form that survives a page adding
           a cell slot the table never hears about. -->
      <template v-for="(_, name) in $slots" #[name]="slotProps">
        <slot :name="name" v-bind="slotProps ?? {}" />
      </template>
    </DataTableCards>

    <template v-else>
      <div class="overflow-x-auto" :class="stickyHeader ? 'max-h-[70vh] overflow-y-auto' : ''">
        <table
          class="min-w-full"
          :class="[dense ? 'text-xs' : 'text-sm', nowrap ? 'whitespace-nowrap' : '']"
        >
          <thead
            class="bg-surface-subtle text-ink-muted shadow-sticky-edge"
            :class="stickyHeader ? 'sticky top-0 z-sticky' : ''"
          >
            <tr>
              <th v-if="selectable" scope="col" class="w-10 pl-6 pr-2" :class="dense ? 'py-2' : 'py-3'">
                <input
                  type="checkbox"
                  class="size-4 rounded-control border-edge-control accent-brand-600"
                  :checked="allSelected"
                  :indeterminate="someSelected"
                  aria-label="Select all rows"
                  @change="toggleAll"
                />
              </th>
              <th
                v-for="(col, i) in columns"
                :key="col.key"
                scope="col"
                class="font-medium"
                :class="[...cellCls(col, i), col.width ? WIDTHS[col.width] : '', pinCls(i, PIN_HEADER), col.headerClass]"
              >
                <button
                  v-if="col.sortable"
                  type="button"
                  class="group inline-flex items-center gap-1 hover:text-ink-secondary"
                  @click="emit('sort', col.key)"
                >
                  {{ col.label }}
                  <AppIcon v-if="sort?.key === col.key && sort?.dir === 'asc'" :icon="ChevronUpIcon" class="size-3.5 text-ink-muted" />
                  <AppIcon v-else-if="sort?.key === col.key && sort?.dir === 'desc'" :icon="ChevronDownIcon" class="size-3.5 text-ink-muted" />
                  <AppIcon v-else :icon="ChevronUpDownIcon" class="size-3.5 text-ink-tertiary group-hover:text-ink-tertiary" />
                </button>
                <template v-else>{{ col.label }}</template>
              </th>
              <th v-if="hasActions" scope="col" class="w-12 pl-2 pr-6">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-edge-subtle">
            <template v-for="row in rows" :key="keyOf(row)">
            <tr
              class="hover:bg-surface-subtle"
              :class="[isSelected(row) ? 'bg-brand-50/40' : '', pinFirstColumn ? 'group' : '', rowClass?.(row)]"
              @click="emit('row-click', row)"
            >
              <td v-if="selectable" class="w-10 pl-6 pr-2" :class="dense ? 'py-2' : 'py-3'" @click.stop>
                <input
                  type="checkbox"
                  class="size-4 rounded-control border-edge-control accent-brand-600"
                  :checked="isSelected(row)"
                  :aria-label="`Select row ${keyOf(row)}`"
                  @change="toggleRow(row)"
                />
              </td>
              <td
                v-for="(col, i) in columns"
                :key="col.key"
                :class="[...cellCls(col, i), pinCls(i, PIN_CELL), col.cellClass]"
              >
                <slot :name="`cell-${col.key}`" :row="row" :value="cellValue(row, col.key)">
                  <span v-if="isBlank(cellValue(row, col.key))" class="text-ink-tertiary">—</span>
                  <template v-else>{{ cellValue(row, col.key) }}</template>
                </slot>
              </td>
              <td v-if="hasActions" class="w-12 pl-2 pr-6 text-right" :class="dense ? 'py-1.5' : 'py-2'" @click.stop>
                <slot name="actions" :row="row" />
              </td>
            </tr>
            <tr v-if="isExpanded(row)" class="bg-surface-subtle/60">
              <td :colspan="skeletonCols" class="px-6 py-3">
                <slot name="expanded" :row="row" />
              </td>
            </tr>
            </template>
          </tbody>
        </table>
      </div>
      <slot name="footer" />
    </template>
  </component>
</template>
