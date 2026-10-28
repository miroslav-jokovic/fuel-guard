<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  AppBadge,
  AppButton as BaseButton,
  AppCallout,
  AppIcon,
  DataWorkspace,
  FilterBar,
  DataTable,
  type DataTableColumn,
  TablePagination,
  useConfirm,
  useQueryState,
} from "@silvicom/ui";
import { PlusIcon } from "@silvicom/ui/icons";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import InspectorDrawer from "@/features/maintenance/InspectorDrawer.vue";
import { useToastStore } from "@/stores/toast";
import {
  useDeleteInspector,
  useInspectorsQuery,
  useSetInspectorPeriod,
  type Inspector,
} from "@/features/maintenance/useAnnualInspections";
import { useSessionStore } from "@/stores/session";
import { INSPECTOR_QUALIFICATION_BASES } from "@silvicom/shared";
import { formatDate, formatDateRange } from "@/lib/format";

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
 *
 * ── RETIRE AND REMOVE ARE DIFFERENT ACTS, SO THE ROW OFFERS BOTH ───────────────────────────────
 * A retirement is a date: the person inspected trucks, their reports name them, and §396.19 wants
 * the evidence for a year past the employment, so the row survives and only their availability for a
 * NEW inspection ends. A removal is for the row that never meant anything — a name typed wrongly,
 * caught before it was used. Retiring that one leaves a person on the register who does not exist,
 * which is worse evidence than one row fewer.
 *
 * The page does not decide which case it is looking at. It offers both and lets the API answer:
 * 0280's `on delete restrict` refuses the delete for anybody a report names, and that refusal is
 * what the reader is shown. A count fetched here to grey the button out would be a second answer to
 * the same question, and the staler of the two.
 */

const session = useSessionStore();
const toast = useToastStore();
const ask = useConfirm();
// The register's filters live in the URL (D-US2), so a reload or Back keeps them. "Qualified by" is
// read against the contract's own list of bases, so a hand-edited value outside it reads as Any.
const qs = useQueryState();
const showRetired = qs.flag("retired");
const search = qs.param("search");
const basis = qs.param("basis", INSPECTOR_QUALIFICATION_BASES);
// "Active only" is where the register opens; showing retired inspectors counts as a filter moved off it.
const activeFilterCount = computed(() => [search.value.trim(), basis.value, showRetired.value].filter(Boolean).length);
function resetFilters() {
  qs.set({ search: undefined, basis: undefined, retired: undefined });
}

const { data, isLoading, isError, refetch, isFetching } = useInspectorsQuery(showRetired);
const setPeriod = useSetInspectorPeriod();
const removeInspector = useDeleteInspector();

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
      period: i.effective_to ? formatDateRange(i.effective_from, i.effective_to) : `Since ${formatDate(i.effective_from)}`,
    }));
});

// D-US8: the register pages like every list with a toolbar, its page in the URL beside the filters
// (D-US2). A filter change returns to page 1 — the rows arriving do not, or a pasted ?page=2 would be
// lost on load; the clamp pulls the page back when a removal leaves fewer pages than the one showing.
const PAGE_SIZE = 20;
const page = qs.page();
watch([search, basis, showRetired], () => (page.value = 1));
watch(rows, (r) => {
  const maxPage = Math.max(1, Math.ceil(r.length / PAGE_SIZE));
  if (page.value > maxPage) page.value = maxPage;
});
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

/**
 * Empty means the REGISTER is empty, not that the filters matched nothing — those are different
 * things and only one of them stops an inspection being started. Computed here rather than read
 * through template unwrapping, so the condition is legible next to the data it reads.
 */
// …and only an ANSWER can say it is empty: a failed read has no rows either, and drew this warning
// above the table's own "Could not load" (F6, US6b).
const registerIsEmpty = computed(() => !isLoading.value && !isError.value && (data.value ?? []).length === 0);

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
];

const adding = ref(false);
const today = new Date().toISOString().slice(0, 10);

async function retire(i: Inspector) {
  try {
    await setPeriod.mutateAsync({ id: i.id, effectiveTo: today });
    toast.success(`${i.full_name} retired`);
  } catch (e) {
    toast.error("Could not retire the inspector", e instanceof Error ? e.message : undefined);
  }
}

async function reinstate(i: Inspector) {
  try {
    await setPeriod.mutateAsync({ id: i.id, effectiveTo: null });
    toast.success(`${i.full_name} reinstated`);
  } catch (e) {
    toast.error("Could not reinstate the inspector", e instanceof Error ? e.message : undefined);
  }
}

async function remove(i: Inspector) {
  // The product's confirm (D-US7). Danger: a removal deletes the row, where Retire only dates it.
  const asked = await ask({
    title: `Delete ${i.full_name} from the list?`,
    message:
      "This is for a row added by mistake — anybody who has performed an inspection stays on file, and you will be told so.",
    confirmLabel: "Delete",
    tone: "danger",
  });
  if (!asked) return;
  try {
    await removeInspector.mutateAsync(i.id);
    toast.success(`${i.full_name} removed`);
  } catch (e) {
    // The API's own sentence: for somebody a report names it says to retire them instead.
    toast.error("Could not remove the inspector", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Who may perform an annual inspection. The inspection form only offers people whose training covers the date being inspected.">
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

    <DataWorkspace>
    <FilterBar
      v-model:search="search"
      embedded
      search-placeholder="Search by name…"
      :count="rows.length"
      count-label="inspectors"
      :active-count="activeFilterCount"
      @clear-all="resetFilters"
    >
      <template #filters>
        <FilterSelect v-model="basis" label="Trained as" :options="BASIS_OPTIONS" />
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
      embedded
      :columns="columns"
      :rows="pageRows"
      :loading="isLoading || isFetching"
      :error="isError ? 'Could not load the register.' : null"
      row-key="id"
      @retry="() => refetch()"
    >
      <template #cell-brakes="{ row }">
        <AppBadge :tone="row.brake_qualified ? 'success' : 'neutral'">{{ row.brakes }}</AppBadge>
      </template>
      <template #cell-period="{ row }">
        <span :class="row.qualified ? 'text-ink-secondary' : 'text-ink-tertiary'">{{ row.period }}</span>
        <AppBadge v-if="!row.qualified" tone="neutral" class="ml-2">Off the list</AppBadge>
      </template>
      <template #actions="{ row }">
        <KebabMenu v-if="session.can('maintenance')">
          <BaseButton v-if="row.qualified" class="kebab-item" @click="retire(row)">Take off the list</BaseButton>
          <BaseButton v-else class="kebab-item" @click="reinstate(row)">Put back on the list</BaseButton>
          <BaseButton class="kebab-item kebab-item-danger" @click="remove(row)">Delete</BaseButton>
        </KebabMenu>
      </template>
      <template #empty>Nobody matches those filters.</template>
      <template #footer>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" :loading="isFetching" @update:page="page = $event" />
      </template>
    </DataTable>
    </DataWorkspace>

    <InspectorDrawer :open="adding" @created="adding = false" @close="adding = false" />
  </div>
</template>
