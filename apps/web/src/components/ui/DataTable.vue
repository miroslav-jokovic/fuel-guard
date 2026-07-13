<script setup lang="ts">
import BaseCard from "./BaseCard.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";

/**
 * The one data table shell: card + loading skeleton + error state + empty
 * state + horizontally-scrollable table with the standard head/body styling.
 *
 *   <DataTable :loading="isLoading" :error="errMsg" :empty="rows.length === 0"
 *              empty-text="No vehicles match these filters." :skeleton-cols="8"
 *              @retry="refetch">
 *     <template #head><tr><th class="px-6 py-3 font-medium">…</th></tr></template>
 *     <tr v-for="…" class="hover:bg-surface-subtle"><td class="px-6 py-3">…</td></tr>
 *     <template #footer><TablePagination … /></template>
 *   </DataTable>
 *
 * Cell conventions: th/td use px-6 py-3 (px-4 in dense contexts), th adds
 * font-medium. Alignment/width utilities go on the individual cells.
 */
withDefaults(
  defineProps<{
    loading?: boolean;
    error?: string | null;
    retrying?: boolean;
    empty?: boolean;
    emptyText?: string;
    skeletonCols?: number;
    /** text-xs tables (audit trails, dense sub-tables) */
    dense?: boolean;
    /** set false for tables whose cells should wrap (long text columns) */
    nowrap?: boolean;
  }>(),
  {
    loading: false,
    error: null,
    retrying: false,
    empty: false,
    emptyText: "No results.",
    skeletonCols: 5,
    dense: false,
    nowrap: true,
  },
);
defineEmits<{ retry: [] }>();
</script>

<template>
  <BaseCard padding="none">
    <TableSkeleton v-if="loading" :cols="skeletonCols" />
    <ErrorState v-else-if="error" :message="error" :retrying="retrying" @retry="$emit('retry')" />
    <div v-else-if="empty" class="px-6 py-10 text-center text-sm text-ink-muted">
      <slot name="empty">{{ emptyText }}</slot>
    </div>
    <template v-else>
      <div class="overflow-x-auto">
        <table
          class="min-w-full divide-y divide-edge"
          :class="[dense ? 'text-xs' : 'text-sm', nowrap ? 'whitespace-nowrap' : '']"
        >
          <thead class="bg-surface-subtle text-left text-ink-muted">
            <slot name="head" />
          </thead>
          <tbody class="divide-y divide-edge-subtle">
            <slot />
          </tbody>
        </table>
      </div>
      <slot name="footer" />
    </template>
  </BaseCard>
</template>
