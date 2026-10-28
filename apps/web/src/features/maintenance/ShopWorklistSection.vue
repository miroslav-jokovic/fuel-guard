<script setup lang="ts">
import { computed } from "vue";
import type { RouteLocationRaw } from "vue-router";
import { DataTable, type DataTableColumn } from "@silvicom/ui";

/**
 * One group of the Shop worklist (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.2, D-MX2).
 *
 * ── A GROUP IS ITS LIST, OR IT IS NOT THERE ────────────────────────────────────────────────────
 * D-MX2: no counter without the list under it. So a group draws its heading, its "All N" link and
 * the head of its list together, and draws NOTHING when its read has answered empty — a quiet day
 * is a short page, not six headings over six empty tables (the 2026-09-10 critique measured the
 * home at sixty percent blank under tiles; this is the rule that stops it drifting back). It still
 * draws while loading and when the read failed, because a group that vanished on a 500 would be
 * read as "nothing due" (D-US9).
 *
 * The page owns the query, the columns and the cells; this component owns the anatomy, so six
 * groups are one shape. Cell slots pass straight through to `DataTable`.
 */
const props = defineProps<{
  title: string;
  columns: DataTableColumn[];
  rows: Record<string, unknown>[];
  rowKey: string | ((row: Record<string, unknown>) => string);
  loading: boolean;
  error: string | null;
  /** Where the whole list lives; omitted when that page is off for this reader (SP5). */
  allTo?: RouteLocationRaw | null;
  allLabel?: string;
  /** Whether a row opens something — false when its page is off for this reader (SP5). */
  clickable?: boolean;
  /** Never shown — the section hides itself when empty — but the list kit's gate wants every table to say it. */
  emptyText: string;
  testId?: string;
}>();
const emit = defineEmits<{ retry: []; "row-click": [row: Record<string, unknown>] }>();

const drawn = computed(() => props.loading || props.error !== null || props.rows.length > 0);
</script>

<template>
  <section v-if="drawn" class="space-y-3" :data-test="testId">
    <div class="flex items-center justify-between gap-4">
      <h2 class="text-sm font-semibold text-ink">{{ title }}</h2>
      <RouterLink v-if="allTo" :to="allTo" class="text-sm font-medium text-link hover:text-link-hover">
        {{ allLabel }}
      </RouterLink>
    </div>
    <DataTable
      :columns="columns"
      :rows="rows"
      :row-key="rowKey"
      :loading="loading"
      :error="error"
      :empty-text="emptyText"
      :row-class="() => (clickable ? 'cursor-pointer' : '')"
      @row-click="(row) => clickable && emit('row-click', row)"
      @retry="emit('retry')"
    >
      <template v-for="(_, name) in $slots" #[name]="scope">
        <slot :name="name" v-bind="scope ?? {}" />
      </template>
    </DataTable>
  </section>
</template>
