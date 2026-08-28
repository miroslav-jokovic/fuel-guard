<script setup lang="ts">
import { computed, ref } from "vue";
import type { DeadheadTreatment } from "@silvicom/shared";
import { useCpmQuery, type CpmFilter } from "@/features/accounting/useCpm";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@silvicom/ui";

// Default window: the trailing full month — CPM is a period figure, and a part-month reads low
// on fixed-cadence costs. The caveats below the numbers are the harness's own, not the page's.
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const now = new Date();
const from = ref<string>(ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
const to = ref<string>(ymd(new Date(now.getFullYear(), now.getMonth(), 1)));
const deadhead = ref<DeadheadTreatment>("estimate");
const includeOwnerOperators = ref(false);

const filter = computed<CpmFilter>(() => ({
  from: from.value,
  to: to.value,
  deadhead: deadhead.value,
  includeOwnerOperators: includeOwnerOperators.value,
}));
const { data, isLoading, isError, error, refetch, isFetching } = useCpmQuery(filter);

const report = computed(() => data.value?.report ?? null);
const provenance = computed(() => data.value?.provenance ?? null);
const trucks = computed(() => report.value?.trucks ?? []);

const deadheadOptions = [
  { value: "estimate", label: "Deadhead estimated" },
  { value: "exclude", label: "Loaded miles only" },
];

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
const fmtMiles = (n: number) => Math.round(n).toLocaleString();
const fmtCpm = (n: number) => `${n.toFixed(1)}¢`;

const columns: DataTableColumn[] = [
  { key: "tractor_unit", label: "Truck", cellClass: "font-mono text-xs" },
  { key: "movements", label: "Trips", numeric: true },
  { key: "loadedMiles", label: "Loaded mi", numeric: true },
  { key: "deadheadMilesEstimated", label: "Deadhead mi", numeric: true, cellClass: "text-ink-tertiary" },
  { key: "totalMiles", label: "Total mi", numeric: true },
  { key: "directFuel", label: "Fuel", numeric: true },
  { key: "directSettlement", label: "Driver pay", numeric: true },
  { key: "directTotal", label: "Direct cost", numeric: true },
  { key: "directCpm", label: "¢ / mile", numeric: true },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Direct cost per mile for every company truck — measured miles, measured cost, and every assumption stated. Overhead stays unallocated until finance sets a rule; the caveats say exactly what each figure excludes." />

    <div v-if="report" class="grid grid-cols-1 gap-4 sm:grid-cols-4">
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Fleet ¢ / mile</p>
        <p class="text-2xl font-bold text-ink">{{ fmtCpm(report.fleet.directCpm) }}</p>
        <p class="text-2xs text-ink-tertiary">direct cost only</p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Total miles</p>
        <p class="text-2xl font-bold text-ink">{{ fmtMiles(report.fleet.totalMiles) }}</p>
        <p class="text-2xs text-ink-tertiary">{{ fmtMiles(report.fleet.deadheadMilesEstimated) }} estimated deadhead</p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Direct cost</p>
        <p class="text-2xl font-bold text-ink">{{ fmtUsd(report.fleet.directTotal) }}</p>
        <p class="text-2xs text-ink-tertiary">fuel + driver pay</p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Not in these figures</p>
        <p class="text-2xl font-bold text-ink">{{ fmtUsd(report.excluded.unallocatedOverhead + report.excluded.ownerOperatorSettlement) }}</p>
        <p class="text-2xs text-ink-tertiary">unallocated overhead + owner-operator pool</p>
      </BaseCard>
    </div>

    <FilterBar :count="trucks.length" count-label="trucks">
      <template #filters>
        <FilterSelect v-model="deadhead" label="Miles basis" :options="deadheadOptions" />
        <DateRangeFilter :from="from" :to="to" @update:from="(v) => (from = v ?? from)" @update:to="(v) => (to = v ?? to)" />
      </template>
      <template #actions>
        <BaseButton :variant="includeOwnerOperators ? 'secondary' : 'ghost'" size="sm" @click="includeOwnerOperators = !includeOwnerOperators">
          {{ includeOwnerOperators ? "Owner-operators included" : "Company trucks only" }}
        </BaseButton>
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="trucks"
      row-key="tractor_unit"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
      :retrying="isFetching"
      @retry="refetch"
    >
      <template #empty>
        <div class="space-y-1">
          <p>No cost per mile for this window yet.</p>
          <p v-for="s in provenance?.pendingSources ?? []" :key="s" class="text-xs text-ink-tertiary">{{ s }}</p>
        </div>
      </template>
      <template #cell-loadedMiles="{ value }">{{ fmtMiles(value) }}</template>
      <template #cell-deadheadMilesEstimated="{ value }">{{ fmtMiles(value) }}</template>
      <template #cell-totalMiles="{ value }">{{ fmtMiles(value) }}</template>
      <template #cell-directFuel="{ value }">{{ fmtUsd(value) }}</template>
      <template #cell-directSettlement="{ value }">{{ fmtUsd(value) }}</template>
      <template #cell-directTotal="{ value }">{{ fmtUsd(value) }}</template>
      <template #cell-directCpm="{ value }">
        <span class="font-semibold text-ink">{{ fmtCpm(value) }}</span>
      </template>
    </DataTable>

    <!-- The harness's own caveats — generated from what happened in THIS run. A CPM figure whose
         assumptions are invisible is worse than none, because it gets quoted. -->
    <BaseCard v-if="report?.caveats.length" padding="sm">
      <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Read before quoting</p>
      <ul class="mt-2 space-y-1">
        <li v-for="c in report.caveats" :key="c" class="text-xs text-ink-secondary">{{ c }}</li>
      </ul>
    </BaseCard>
  </div>
</template>
