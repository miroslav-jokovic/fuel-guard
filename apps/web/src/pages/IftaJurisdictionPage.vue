<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { AppCallout, AppCard as BaseCard } from "@silvicom/ui";
import { STATE_NAMES } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import StatCard from "@/components/ui/StatCard.vue";
import { useOpens } from "@/composables/useOpens";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import {
  parseQuarterKey, quarterKey, quarterLabel, selectableQuarters, useIftaJurisdictionQuery,
  type IftaQuarter,
} from "@/features/ifta/useIftaPeriod";
import { pct1 } from "@/features/reconcile/format";

/**
 * One row of the IFTA ledger, opened: every truck Samsara reported in this jurisdiction for the
 * quarter, and how far each one drove there.
 *
 * ── WHY A PAGE AND NOT A DRAWER ON THE LEDGER ───────────────────────────────────────────────────
 * The ledger exists to be sent to somebody (its quarter lives in the URL for that reason), and the
 * question this answers — "which trucks make up Texas's 564,170 miles" — is the one the person it is
 * sent to asks next. A drawer has no address, so the answer could not be forwarded with the question.
 *
 * The miles are Samsara's monthly jurisdiction report, per truck, summed over the quarter: the same
 * rows the ledger row sums, so the total at the top of this page IS that row's taxable miles.
 */
const route = useRoute();
const router = useRouter();
const opens = useOpens();

const code = computed(() => String(route.params.jurisdiction ?? "").toUpperCase());
const name = computed(() => STATE_NAMES[code.value] ?? code.value);

const NOW = new Date();
const quarters = selectableQuarters(NOW);
const quarter = computed<IftaQuarter>(() => parseQuarterKey(route.query.q as string) ?? quarters[0]!);
const quarterOptions = quarters.map((q) => ({ value: quarterKey(q), label: quarterLabel(q) }));
const selectedKey = computed<string>({
  get: () => quarterKey(quarter.value),
  set: (v) => void router.replace({ query: { ...route.query, q: v } }),
});

const { data, isLoading, isFetching, isError, error, refetch } = useIftaJurisdictionQuery(quarter, code);

/** The vehicle page is an `equipment` screen; an accountant who reads IFTA may not hold it. */
const vehicleOpens = computed(() => (data.value?.trucks[0] ? opens(`/vehicles/${data.value.trucks[0].vehicleId}`) : false));

const sort = ref<SortState>({ key: null, dir: "asc" });
const rows = computed(() =>
  sortRows(
    (data.value?.trucks ?? []).map((t) => ({
      id: t.vehicleId,
      unit: t.unitNumber,
      taxableMiles: t.taxableMiles,
      totalMiles: t.totalMiles,
      share: t.share,
      months: t.months,
    })),
    sort.value,
  ),
);
const cols: DataTableColumn[] = [
  { key: "unit", label: "Truck", width: "sm", sortable: true },
  { key: "taxableMiles", label: "Taxable miles", numeric: true, width: "sm", sortable: true },
  { key: "totalMiles", label: "Total miles", numeric: true, width: "sm", sortable: true },
  { key: "share", label: "Share of the state's miles", numeric: true, width: "sm", sortable: true },
  { key: "months", label: "Months driven here", numeric: true, width: "sm", sortable: true },
];
const onSort = (key: string) => (sort.value = toggleSort(sort.value, key));
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="`IFTA · ${name}`"
      :description="`Every truck that drove in ${name} in ${quarterLabel(quarter)}, and how far it drove there.`"
    />

    <FilterBar :count="rows.length" count-label="trucks">
      <template #filters>
        <FilterSelect v-model="selectedKey" :options="quarterOptions" label="Quarter" />
      </template>
    </FilterBar>

    <AppCallout v-if="isError" tone="danger">
      Couldn't load {{ name }}: {{ error instanceof Error ? error.message : "unknown error" }}
    </AppCallout>

    <template v-else>
      <div v-if="data" class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Trucks" :value="data.trucks.length.toLocaleString('en-US')" :sub="`drove in ${name}`" />
        <StatCard label="Taxable miles" :value="data.taxableMiles.toLocaleString('en-US')" sub="what the return is computed on" />
        <StatCard label="Total miles" :value="data.totalMiles.toLocaleString('en-US')" sub="including toll and off-highway" />
      </div>

      <BaseCard padding="none">
        <DataTable
          :columns="cols"
          :rows="rows"
          row-key="id"
          :loading="isLoading || isFetching"
          :sort="sort"
          :empty-text="`No truck reported miles in ${name} for ${quarterLabel(quarter)}.`"
          @sort="onSort"
          @retry="() => refetch()"
        >
          <template #cell-unit="{ row }">
            <RouterLink
              v-if="vehicleOpens"
              :to="`/vehicles/${row.id}`"
              class="font-medium text-brand-700 hover:underline"
            >{{ row.unit ?? "No unit number" }}</RouterLink>
            <span v-else class="font-medium text-ink">{{ row.unit ?? "No unit number" }}</span>
          </template>
          <template #cell-taxableMiles="{ row }">{{ Number(row.taxableMiles).toLocaleString("en-US") }}</template>
          <template #cell-totalMiles="{ row }">{{ Number(row.totalMiles).toLocaleString("en-US") }}</template>
          <template #cell-share="{ row }">{{ row.share == null ? "—" : pct1(Number(row.share)) }}</template>
          <template #cell-months="{ row }">{{ row.months }} of 3</template>
        </DataTable>
      </BaseCard>

      <p class="text-xs text-ink-tertiary">
        Miles are Samsara's monthly jurisdiction report for each truck, added up over the quarter — the same
        figures the IFTA ledger's {{ name }} row adds up across trucks. A truck counts here if it reported any
        miles in {{ name }} in any month of the quarter.
      </p>
    </template>
  </div>
</template>
