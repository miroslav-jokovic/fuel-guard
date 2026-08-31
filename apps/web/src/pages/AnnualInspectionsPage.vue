<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { AppTabs, AppBadge, AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { PlusIcon } from "@silvicom/ui/icons";
import type { InspectionSubjectType } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import NewInspectionModal from "@/features/maintenance/NewInspectionModal.vue";
import { useInspectionsQuery } from "@/features/maintenance/useAnnualInspections";
import { useSessionStore } from "@/stores/session";

/**
 * The annual inspection register.
 *
 * ── TRUCKS AND TRAILERS ARE SEPARATED IN THE VIEW, NOT ONLY IN THE DATA (D-AVI12) ──────────────
 * Two tabs rather than a type column, because the two lists are read by different questions —
 * "which tractors are due" is a different sweep of the yard from "which trailers are due" — and the
 * item sets differ underneath.
 *
 * ── THE COPY NAMES THE THING, NOT THE REGULATION (D-AVI15) ─────────────────────────────────────
 * No § anywhere a reader can see it. On every non-hazmat page in this product the citations live in
 * comments beside the code that implements them, which is where this one is: the annual inspection
 * is 49 CFR §396.17, the report contents are §396.21(a), and the fourteen-month retention is
 * §396.21(b). Hazmat is the exception because there the regulation IS the subject.
 */

const router = useRouter();
const session = useSessionStore();

const subjectType = ref<InspectionSubjectType>("tractor");
const search = ref("");
const status = ref("");
const outcome = ref("");
const page = ref(1);
watch([subjectType, search, status, outcome], () => (page.value = 1));

const filter = computed(() => ({
  subjectType: subjectType.value,
  status: (status.value || undefined) as "draft" | "final" | undefined,
  outcome: (outcome.value || undefined) as "pass" | "fail" | undefined,
  q: search.value.trim() || undefined,
  page: page.value,
}));
const { data, isLoading, isError, error, refetch, isFetching } = useInspectionsQuery(filter);

const rows = computed(() =>
  (data.value?.inspections ?? []).map((i) => ({
    ...i,
    unit: i.unit_number ?? "—",
    verdict: i.status === "final" ? (i.outcome === "pass" ? "Passed" : "Failed") : "In progress",
  })),
);
const total = computed(() => data.value?.total ?? 0);

const tabs = [
  { value: "tractor", label: "Tractors" },
  { value: "trailer", label: "Trailers" },
];
const STATUS_OPTIONS = [
  { value: "", label: "Any" },
  { value: "draft", label: "In progress" },
  { value: "final", label: "Completed" },
];
const RESULT_OPTIONS = [
  { value: "", label: "Any" },
  { value: "pass", label: "Passed" },
  { value: "fail", label: "Failed" },
];

const columns: DataTableColumn[] = [
  { key: "unit", label: "Unit", width: "sm" },
  { key: "inspected_on", label: "Inspected", width: "md" },
  { key: "verdict", label: "Result", width: "sm" },
  { key: "next_due_on", label: "Next due", width: "md", cellClass: "text-ink-secondary" },
  { key: "inspector_name", label: "Inspector", width: "md", cellClass: "text-ink-secondary" },
  { key: "decal_serial", label: "Decal", width: "md", cellClass: "font-mono text-xs text-ink-secondary" },
];

const creating = ref(false);
function onCreated(id: string) {
  creating.value = false;
  void router.push({ name: "annual-inspection", params: { id } });
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Annual inspections for every tractor and trailer. A completed report is kept on file and produced on request.">
      <template #actions>
        <BaseButton v-if="session.can('maintenance')" variant="primary" @click="creating = true">
          <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> New inspection
        </BaseButton>
      </template>
    </PageHeader>

    <AppTabs v-model="subjectType" :tabs="tabs" label="Equipment type" />

    <FilterBar
      v-model:search="search"
      search-placeholder="Search unit, decal or inspector…"
      :count="total"
      count-label="inspections"
    >
      <template #filters>
        <FilterSelect v-model="status" label="Status" :options="STATUS_OPTIONS" />
        <FilterSelect v-model="outcome" label="Result" :options="RESULT_OPTIONS" />
      </template>
    </FilterBar>

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
        <AppBadge :tone="row.verdict === 'Passed' ? 'success' : row.verdict === 'Failed' ? 'danger' : 'neutral'">
          {{ row.verdict }}
        </AppBadge>
      </template>
      <template #cell-next_due_on="{ row }">{{ row.next_due_on ?? "—" }}</template>
      <template #cell-decal_serial="{ row }">{{ row.decal_serial ?? "—" }}</template>
      <template #empty>
        No {{ subjectType === "tractor" ? "tractor" : "trailer" }} inspections yet.
      </template>
      <template #footer>
        <TablePagination :page="page" :total="total" :per-page="50" @update:page="(p: number) => (page = p)" />
      </template>
    </DataTable>

    <NewInspectionModal v-if="creating" @close="creating = false" @created="onCreated" />
  </div>
</template>
