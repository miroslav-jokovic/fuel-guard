<script setup lang="ts">
import { computed, ref } from "vue";
import { AppBadge, AppButton as BaseButton, AppCallout, AppIcon } from "@silvicom/ui";
import { PlusIcon } from "@silvicom/ui/icons";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import NewInspectorModal from "@/features/maintenance/NewInspectorModal.vue";
import {
  useInspectorsQuery,
  useSetInspectorPeriod,
  type Inspector,
} from "@/features/maintenance/useAnnualInspections";
import { useSessionStore } from "@/stores/session";

/**
 * Who may perform an annual inspection.
 *
 * ── WHY THIS PAGE EXISTS AT ALL ────────────────────────────────────────────────────────────────
 * The printed report carries a line asserting that the person who signed it meets the federal
 * qualification standard, and this product derives that line from a row here rather than letting
 * anybody tick it (D-AVI6). A derived assertion is only trustworthy if the thing it derives from is
 * visible to the people relying on it — which, until this page, it was not.
 *
 * The regulation is §396.19 (and §396.25 for brakes); the copy names what an office manager would
 * call these things, per D-AVI15.
 */

const session = useSessionStore();
const showRetired = ref(false);
const search = ref("");
const basis = ref("");

const { data, isLoading, isError, error, refetch, isFetching } = useInspectorsQuery(showRetired);
const setPeriod = useSetInspectorPeriod();

const BASIS_LABEL: Record<string, string> = {
  state_federal_program: "State or federal program",
  training_and_experience: "Training and experience",
};

const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  return (data.value ?? [])
    .filter((i) => (basis.value ? i.qualification_basis === basis.value : true))
    .filter((i) => (q ? i.full_name.toLowerCase().includes(q) : true))
    .map((i) => ({
      ...i,
      basis_label: BASIS_LABEL[i.qualification_basis] ?? i.qualification_basis,
      brakes: i.brake_qualified ? "Yes" : "No",
      period: i.effective_to ? `${i.effective_from} — ${i.effective_to}` : `Since ${i.effective_from}`,
    }));
});

/**
 * Empty means the REGISTER is empty, not that the filters matched nothing — those are different
 * things and only one of them stops an inspection being started. Computed here rather than read
 * through template unwrapping, so the condition is legible next to the data it reads.
 */
const registerIsEmpty = computed(() => !isLoading.value && (data.value ?? []).length === 0);

const BASIS_OPTIONS = [
  { value: "", label: "Any" },
  { value: "state_federal_program", label: "State or federal program" },
  { value: "training_and_experience", label: "Training and experience" },
];

const columns: DataTableColumn[] = [
  { key: "full_name", label: "Name", cellClass: "font-medium text-ink" },
  { key: "basis_label", label: "Qualified by", cellClass: "text-ink-secondary" },
  { key: "brakes", label: "Brakes", width: "sm" },
  { key: "period", label: "Active", width: "md", cellClass: "text-ink-secondary" },
  { key: "actions", label: "", width: "sm" },
];

const adding = ref(false);
const today = new Date().toISOString().slice(0, 10);

function retire(i: Inspector) {
  setPeriod.mutate({ id: i.id, effectiveTo: today });
}
function reinstate(i: Inspector) {
  setPeriod.mutate({ id: i.id, effectiveTo: null });
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Who may perform an annual inspection. The inspection form only offers people whose qualification covers the date being inspected.">
      <template #actions>
        <BaseButton v-if="session.can('maintenance')" variant="primary" @click="adding = true">
          <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Add inspector
        </BaseButton>
      </template>
    </PageHeader>

    <AppCallout v-if="registerIsEmpty" tone="caution">
      Nobody is on the register yet. An inspection records who performed it, so no inspection can be
      started until somebody is here.
    </AppCallout>

    <FilterBar
      v-model:search="search"
      search-placeholder="Search by name…"
      :count="rows.length"
      count-label="inspectors"
    >
      <template #filters>
        <FilterSelect v-model="basis" label="Qualified by" :options="BASIS_OPTIONS" />
        <FilterSelect
          :model-value="showRetired ? 'all' : 'active'"
          label="Show"
          :options="[
            { value: 'active', label: 'Active only' },
            { value: 'all', label: 'Including retired' },
          ]"
          @update:model-value="(v: string | string[]) => (showRetired = v === 'all')"
        />
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="rows"
      :loading="isLoading || isFetching"
      :error="isError ? (error?.message ?? 'Could not load the register') : null"
      row-key="id"
      @retry="() => refetch()"
    >
      <template #cell-brakes="{ row }">
        <AppBadge :tone="row.brake_qualified ? 'success' : 'neutral'">{{ row.brakes }}</AppBadge>
      </template>
      <template #cell-period="{ row }">
        <span :class="row.qualified ? 'text-ink-secondary' : 'text-ink-tertiary'">{{ row.period }}</span>
        <AppBadge v-if="!row.qualified" tone="neutral" class="ml-2">Retired</AppBadge>
      </template>
      <template #cell-actions="{ row }">
        <BaseButton
          v-if="session.can('maintenance')"
          size="sm"
          variant="ghost"
          :disabled="setPeriod.isPending.value"
          @click="row.qualified ? retire(row) : reinstate(row)"
        >
          {{ row.qualified ? "Retire" : "Reinstate" }}
        </BaseButton>
      </template>
      <template #empty>Nobody matches those filters.</template>
    </DataTable>

    <NewInspectorModal v-if="adding" @close="adding = false" @created="adding = false" />
  </div>
</template>
