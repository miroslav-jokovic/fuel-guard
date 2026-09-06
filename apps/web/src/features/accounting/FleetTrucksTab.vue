<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import CpmTruckTable from "./CpmTruckTable.vue";
import type { FleetTruck } from "./useFleetReport";

/**
 * The per-truck tab of the fleet report (plan §2 Tab 4), lifted out of the page at R1 of the UI
 * plan so the page shell can take a period rail and a headline strip without crossing the 500-line
 * budget. Nothing here changed in the move: the columns are the ones that are precise for one truck
 * — miles it drove, what its loads earned — and there is no cost column, because no source at this
 * carrier can put a lease payment or an office wage on a particular truck (D-FLEET1).
 *
 * Filtering and sorting are deliberately CLIENT-side and view-only: the fleet figures on the other
 * tabs come from the harness over the whole fleet, and narrowing this table must never look like it
 * changed them. A row hidden here is hidden, not excluded from the arithmetic — and the sentence
 * above the table says how many are hidden, so a filtered view cannot be quoted as the fleet.
 *
 * The tab owns its own page number. It is mounted fresh on every tab change, which is what resets
 * paging between tabs (owner ruling 2026-08-29): page 4 of the trucks is not page 4 of anything else.
 * The period is the page's, chosen once on the rail above the tabs (D-FRUI1); `from`/`to` arrive
 * only so a period change resets the page number.
 */

const props = defineProps<{
  trucks: FleetTruck[];
  loading: boolean;
  error: string | null;
  from: string;
  to: string;
}>();
const emit = defineEmits<{ retry: [] }>();

const PAGE_SIZE = 20;
const unitSearch = ref("");
// A truck that barely moved earns a handful of dollars over a handful of miles, so its rate is
// arithmetically right and analytically useless. These are the thresholds an owner reads the report
// at; "any" is the default so the table starts by hiding nothing.
const minMiles = ref("0");
const minMilesOptions = [
  { value: "0", label: "Any mileage" },
  { value: "100", label: "100+ miles" },
  { value: "1000", label: "1,000+ miles" },
  { value: "5000", label: "5,000+ miles" },
];
// Contractor tractors are off by default: what they cost is a share of each load, not our fuel and
// wages, so their rows answer the contractor tab's question rather than this one.
const includeOwnerOperators = ref(false);
const page = ref(1);
const sort = ref<SortState>({ key: null, dir: "asc" });
const onSort = (key: string) => (sort.value = toggleSort(sort.value, key));
watch([unitSearch, minMiles, includeOwnerOperators, () => props.from, () => props.to], () => (page.value = 1));

const visible = computed(() => {
  const q = unitSearch.value.trim().toLowerCase();
  const floor = Number(minMiles.value) || 0;
  const rows = props.trucks.filter(
    (t) =>
      (!q || t.tractor_unit.toLowerCase().includes(q)) &&
      (t.miles ?? 0) >= floor &&
      (includeOwnerOperators.value || !t.isOwnerOperator),
  );
  return sortRows(rows, sort.value);
});
const pageRows = computed(() => visible.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const hiddenCount = computed(() => props.trucks.length - visible.value.length);

const activeFilterCount = computed(() => (unitSearch.value.trim() ? 1 : 0) + (minMiles.value !== "0" ? 1 : 0));
function resetFilters() {
  unitSearch.value = "";
  minMiles.value = "0";
}
</script>

<template>
  <DataWorkspace>
    <FilterBar
      v-model:search="unitSearch"
      embedded
      search-placeholder="Search by truck number…"
      :count="visible.length"
      count-label="trucks"
    >
      <template #filters>
        <FilterSelect v-model="minMiles" label="Least miles" :options="minMilesOptions" />
      </template>
      <template #actions>
        <BaseButton
          :variant="includeOwnerOperators ? 'secondary' : 'ghost'"
          size="sm"
          title="Contractor trucks are normally left out of this table, because their cost is a share of the load rather than our fuel and wages."
          @click="includeOwnerOperators = !includeOwnerOperators"
        >
          {{ includeOwnerOperators ? "Contractor trucks included" : "Company trucks only" }}
        </BaseButton>
        <BaseButton v-if="activeFilterCount" variant="ghost" size="sm" @click="resetFilters">Clear filters</BaseButton>
      </template>
    </FilterBar>

    <!-- Say what the table is not showing. A filtered view that looks like the whole fleet is how
         a per-truck number gets quoted as a fleet number. -->
    <p v-if="hiddenCount > 0" class="px-4 py-2.5 text-xs text-ink-tertiary sm:px-6">
      {{ hiddenCount }} {{ hiddenCount === 1 ? "truck is" : "trucks are" }} hidden by the filters above.
      The figures at the top of the page still cover every truck.
    </p>

    <CpmTruckTable
      :rows="pageRows"
      :loading="loading"
      :error="error"
      :retrying="loading"
      :sort="sort"
      :page="page"
      :total="visible.length"
      :total-unfiltered="trucks.length"
      :pending-sources="[]"
      :page-size="PAGE_SIZE"
      @sort="onSort"
      @retry="emit('retry')"
      @update:page="page = $event"
    />
  </DataWorkspace>
</template>
