<script setup lang="ts" generic="Row extends Record<string, any>">
import { computed, useSlots } from "vue";
import { ChevronUpIcon, ChevronDownIcon, ChevronUpDownIcon } from "@heroicons/vue/20/solid";
import BaseCard from "./BaseCard.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import type { SortState } from "@/lib/sort";

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
 *       <RouterLink :to="`/vehicles/${row.id}`" class="font-medium text-brand-600 hover:text-brand-500">…</RouterLink>
 *     </template>
 *     <template #actions="{ row }">
 *       <KebabMenu><button class="kebab-item" @click="openEdit(row)">Edit</button></KebabMenu>
 *     </template>
 *     <template #footer><TablePagination … /></template>
 *   </DataTable>
 *
 * Column contract (enterprise table conventions):
 *  - text columns left-aligned; `numeric: true` → right-aligned + tabular-nums
 *    (headers follow their column's alignment)
 *  - `sortable: true` renders the standard sort button + direction indicator
 *  - fixed-ish columns pass width via `headerClass` (e.g. "min-w-[6rem]" / "w-32")
 *  - cells default to `row[key]` with an ink-subtle "—" for null/empty;
 *    override per column with #cell-<key>="{ row, value }"
 * Selection appears ONLY when `selectable` (i.e. the page has bulk actions).
 * The header checkbox selects/clears the current page; indeterminate when partial.
 * Sticky header: thead pins while the table's own scroll area (max-h-[70vh]) scrolls.
 */
export interface DataTableColumn {
  key: string;
  label: string;
  sortable?: boolean;
  numeric?: boolean;
  align?: "left" | "right" | "center";
  /** Extra th classes — widths live here (min-w-[8rem], w-32, …). */
  headerClass?: string;
  /** Extra td classes — truncation, tone overrides, … */
  cellClass?: string;
}

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
const alignCls = (col: DataTableColumn): string =>
  col.numeric || col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left";

const pad = computed(() => (props.dense ? "px-4 py-2" : "px-4 py-3"));

/** Edge padding: first/last cells align content with the card's p-5/p-6 gutters. */
const cellCls = (col: DataTableColumn, i: number): string[] => [
  pad.value,
  alignCls(col),
  col.numeric ? "tabular-nums" : "",
  i === 0 && !props.selectable ? "pl-6" : "",
  i === props.columns.length - 1 && !hasActions.value ? "pr-6" : "",
];

const skeletonCols = computed(
  () => props.columns.length + (props.selectable ? 1 : 0) + (hasActions.value ? 1 : 0),
);

const cellValue = (row: Row, col: DataTableColumn) => row[col.key];
const isBlank = (v: unknown) => v == null || v === "";
</script>

<template>
  <BaseCard padding="none">
    <TableSkeleton v-if="loading" :cols="skeletonCols" />
    <ErrorState v-else-if="error" :message="error" :retrying="retrying" @retry="emit('retry')" />
    <div v-else-if="rows.length === 0" class="px-6 py-10 text-center text-sm text-ink-muted">
      <slot name="empty">{{ emptyText }}</slot>
    </div>
    <template v-else>
      <div class="overflow-x-auto" :class="stickyHeader ? 'max-h-[70vh] overflow-y-auto' : ''">
        <table
          class="min-w-full"
          :class="[dense ? 'text-xs' : 'text-sm', nowrap ? 'whitespace-nowrap' : '']"
        >
          <thead
            class="bg-surface-subtle text-ink-muted shadow-[inset_0_-1px_0_0_var(--edge)]"
            :class="stickyHeader ? 'sticky top-0 z-10' : ''"
          >
            <tr>
              <th v-if="selectable" scope="col" class="w-10 pl-6 pr-2" :class="dense ? 'py-2' : 'py-3'">
                <input
                  type="checkbox"
                  class="size-4 rounded border-edge-strong accent-brand-600"
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
                :class="[...cellCls(col, i), col.headerClass]"
              >
                <button
                  v-if="col.sortable"
                  type="button"
                  class="group inline-flex items-center gap-1 hover:text-ink-secondary"
                  @click="emit('sort', col.key)"
                >
                  {{ col.label }}
                  <ChevronUpIcon v-if="sort?.key === col.key && sort?.dir === 'asc'" class="size-3.5 text-ink-muted" />
                  <ChevronDownIcon v-else-if="sort?.key === col.key && sort?.dir === 'desc'" class="size-3.5 text-ink-muted" />
                  <ChevronUpDownIcon v-else class="size-3.5 text-ink-subtle group-hover:text-ink-subtle" />
                </button>
                <template v-else>{{ col.label }}</template>
              </th>
              <th v-if="hasActions" scope="col" class="w-12 pl-2 pr-6">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-edge-subtle">
            <tr
              v-for="row in rows"
              :key="keyOf(row)"
              class="hover:bg-surface-subtle"
              :class="[isSelected(row) ? 'bg-brand-50/40' : '', rowClass?.(row)]"
              @click="emit('row-click', row)"
            >
              <td v-if="selectable" class="w-10 pl-6 pr-2" :class="dense ? 'py-2' : 'py-3'" @click.stop>
                <input
                  type="checkbox"
                  class="size-4 rounded border-edge-strong accent-brand-600"
                  :checked="isSelected(row)"
                  :aria-label="`Select row ${keyOf(row)}`"
                  @change="toggleRow(row)"
                />
              </td>
              <td
                v-for="(col, i) in columns"
                :key="col.key"
                :class="[...cellCls(col, i), col.cellClass]"
              >
                <slot :name="`cell-${col.key}`" :row="row" :value="cellValue(row, col)">
                  <span v-if="isBlank(cellValue(row, col))" class="text-ink-subtle">—</span>
                  <template v-else>{{ cellValue(row, col) }}</template>
                </slot>
              </td>
              <td v-if="hasActions" class="w-12 pl-2 pr-6 text-right" :class="dense ? 'py-1.5' : 'py-2'" @click.stop>
                <slot name="actions" :row="row" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <slot name="footer" />
    </template>
  </BaseCard>
</template>
