<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppTabs, AppBadge } from "@silvicom/ui";
import type { InspectionSubjectType } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { useInspectionsQuery } from "@/features/maintenance/useAnnualInspections";

/**
 * The §396.17 inspection register (plan step A7).
 *
 * ── TRUCKS AND TRAILERS ARE SEPARATED IN THE VIEW, NOT ONLY IN THE DATA (D-AVI12) ──────────────
 * Two tabs over one table rather than a `subject_type` column, because the two lists are read for
 * different reasons and by different questions — "which tractors are due" is a different sweep of
 * the yard from "which trailers are due". The item sets differ too: a tractor's form never shows a
 * rear impact guard and a trailer's never shows a fifth wheel.
 */

const subjectType = ref<InspectionSubjectType>("tractor");
const page = ref(1);
watch(subjectType, () => (page.value = 1));

const filter = computed(() => ({ subjectType: subjectType.value, page: page.value }));
const { data, isLoading, isError, error, refetch, isFetching } = useInspectionsQuery(filter);

const rows = computed(() =>
  (data.value?.inspections ?? []).map((i) => ({
    ...i,
    verdict: i.status === "final" ? (i.outcome === "pass" ? "Pass" : "Fail") : "Draft",
  })),
);
const total = computed(() => data.value?.total ?? 0);

const tabs = computed(() => [
  { value: "tractor", label: "Tractors" },
  { value: "trailer", label: "Trailers" },
]);

const columns: DataTableColumn[] = [
  { key: "inspected_on", label: "Inspected" },
  { key: "verdict", label: "Result" },
  { key: "next_due_on", label: "Next due", cellClass: "text-ink-secondary" },
  { key: "decal_serial", label: "Decal", cellClass: "font-mono text-xs text-ink-secondary" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="49 CFR §396.17 annual vehicle inspections. A certified report is retained for fourteen months and produced on demand (§396.21(b))." />

    <AppTabs v-model="subjectType" :tabs="tabs" label="Equipment type" />

    <FilterBar :count="total" count-label="inspections" />

    <DataTable
      :columns="columns"
      :rows="rows"
      :loading="isLoading || isFetching"
      :error="isError ? (error?.message ?? 'Could not load inspections') : null"
      row-key="id"
      :row-to="(row: { id: string }) => ({ name: 'annual-inspection', params: { id: row.id } })"
      @retry="() => refetch()"
    >
      <template #cell-verdict="{ row }">
        <AppBadge :tone="row.verdict === 'Pass' ? 'success' : row.verdict === 'Fail' ? 'danger' : 'neutral'">
          {{ row.verdict }}
        </AppBadge>
      </template>
      <template #empty>
        No {{ subjectType === "tractor" ? "tractor" : "trailer" }} inspections recorded yet.
      </template>
      <template #footer>
        <TablePagination :page="page" :total="total" :per-page="50" @update:page="(p: number) => (page = p)" />
      </template>
    </DataTable>
  </div>
</template>
