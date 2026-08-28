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

// The miles columns follow the report's basis (owner ruling: Samsara actuals are the fleet's
// mileage truth; McLeod loaded stays as reference). The estimate columns appear only when the
// window has no Samsara miles and the harness fell back — and said so.
const samsaraBasis = computed(() => report.value?.milesBasis === "samsara_actual");
const columns = computed<DataTableColumn[]>(() => [
  { key: "tractor_unit", label: "Truck", cellClass: "font-mono text-xs" },
  { key: "movements", label: "Trips", numeric: true },
  { key: "loadedMiles", label: "Loaded mi", numeric: true, cellClass: "text-ink-tertiary" },
  ...(samsaraBasis.value
    ? [{ key: "totalMiles", label: "Samsara mi", numeric: true } as DataTableColumn]
    : [
        { key: "deadheadMilesEstimated", label: "Deadhead mi", numeric: true, cellClass: "text-ink-tertiary" } as DataTableColumn,
        { key: "totalMiles", label: "Total mi", numeric: true } as DataTableColumn,
      ]),
  { key: "directFuel", label: "Fuel", numeric: true },
  { key: "directSettlement", label: "Driver pay", numeric: true },
  { key: "directTotal", label: "Direct cost", numeric: true },
  { key: "fixedCost", label: "Fixed cost", numeric: true },
  { key: "revenue", label: "Revenue", numeric: true },
  { key: "totalCpm", label: "Cost ¢/mi", numeric: true },
  { key: "revenueCpm", label: "Rev ¢/mi", numeric: true },
  { key: "netCpm", label: "Net ¢/mi", numeric: true },
]);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Direct cost per mile for every company truck — measured miles, measured cost, and every assumption stated. Overhead stays unallocated until finance sets a rule; the caveats say exactly what each figure excludes." />

    <div v-if="report" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Net ¢ / mile</p>
        <p class="text-2xl font-bold text-ink">{{ fmtCpm(report.fleet.netCpm) }}</p>
        <p class="text-2xs text-ink-tertiary">revenue {{ fmtCpm(report.fleet.revenueCpm) }} − cost {{ fmtCpm(report.fleet.totalCpm) }}; read the caveats for what net still omits</p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Cost ¢ / mile</p>
        <p class="text-2xl font-bold text-ink">{{ fmtCpm(report.fleet.totalCpm) }}</p>
        <p class="text-2xs text-ink-tertiary">direct {{ fmtCpm(report.fleet.directCpm) }} + fixed {{ fmtCpm(report.fleet.fixedCpm) }}</p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Total miles</p>
        <p class="text-2xl font-bold text-ink">{{ fmtMiles(report.fleet.totalMiles) }}</p>
        <p class="text-2xs text-ink-tertiary">{{ samsaraBasis ? "Samsara measured, empty miles included" : `${fmtMiles(report.fleet.deadheadMilesEstimated)} estimated deadhead` }}</p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Booked revenue</p>
        <p class="text-2xl font-bold text-ink">{{ fmtUsd(report.fleet.revenueTotal) }}</p>
        <p class="text-2xs text-ink-tertiary">GL-posted invoices on company trucks; cost in figures {{ fmtUsd(report.fleet.directTotal + report.fleet.fixedTotal) }}</p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Not in these figures</p>
        <p class="text-2xl font-bold text-ink">{{ fmtUsd(report.excluded.unallocatedOverhead + report.excluded.ownerOperatorSettlement) }}</p>
        <p class="text-2xs text-ink-tertiary">unallocated overhead + owner-operator pool</p>
      </BaseCard>
    </div>

    <FilterBar :count="trucks.length" count-label="trucks">
      <template #filters>
        <FilterSelect v-if="!samsaraBasis" v-model="deadhead" label="Miles basis" :options="deadheadOptions" />
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
      <template #cell-fixedCost="{ value }">{{ fmtUsd(value) }}</template>
      <template #cell-revenue="{ value }">{{ fmtUsd(value) }}</template>
      <template #cell-totalCpm="{ value }">{{ fmtCpm(value) }}</template>
      <template #cell-revenueCpm="{ value }">{{ fmtCpm(value) }}</template>
      <template #cell-netCpm="{ value }">
        <span class="font-semibold" :class="value >= 0 ? 'text-ink' : 'text-danger-600'">{{ fmtCpm(value) }}</span>
      </template>
    </DataTable>

    <!-- The fleet truth: the GL for this window's months read as an income statement through
         McLeod's own account classes. EVERY dollar — office payroll, lease cheques, interest —
         where the table above holds only per-truck attributable cost. Proven to reproduce the
         owner's P&L to the dollar (2026-08-28 reconciliation). -->
    <BaseCard v-if="provenance?.glCheck?.monthsCovered?.length" padding="sm">
      <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Fleet truth — the general ledger for {{ provenance.glCheck.monthsCovered.join(", ") }}</p>
      <div class="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p class="text-2xs text-ink-tertiary">GL revenue</p>
          <p class="text-lg font-bold text-ink">{{ fmtUsd(provenance.glCheck.revenue) }}</p>
        </div>
        <div>
          <p class="text-2xs text-ink-tertiary">GL expenses — every dollar, not just per-truck</p>
          <p class="text-lg font-bold text-ink">{{ fmtUsd(provenance.glCheck.expenses) }}</p>
        </div>
        <div>
          <p class="text-2xs text-ink-tertiary">GL net income</p>
          <p class="text-lg font-bold" :class="provenance.glCheck.net >= 0 ? 'text-ink' : 'text-danger-600'">{{ fmtUsd(provenance.glCheck.net) }}</p>
        </div>
        <div>
          <p class="text-2xs text-ink-tertiary">GL net ¢ / mile</p>
          <p class="text-lg font-bold" :class="provenance.glCheck.netCpm >= 0 ? 'text-ink' : 'text-danger-600'">{{ fmtCpm(provenance.glCheck.netCpm) }}</p>
        </div>
      </div>
      <p class="mt-2 text-2xs text-ink-tertiary">The whole-fleet bottom line from McLeod's ledger. The per-truck table above attributes what CAN be attributed; the difference is unattributed overhead and the owner-operator pool — never missing money.</p>
      <p v-if="provenance.glCheck.monthsMissing.length" class="text-2xs text-danger-600">GL not yet swept for: {{ provenance.glCheck.monthsMissing.join(", ") }}</p>
      <p v-if="Math.abs(provenance.glCheck.unclassifiedNet) > 0.01" class="text-2xs text-danger-600">{{ fmtUsd(provenance.glCheck.unclassifiedNet) }} sits in accounts the staged chart of accounts cannot classify — re-run the agent sweep.</p>
    </BaseCard>

    <!-- The harness's own caveats — generated from what happened in THIS run. A CPM figure whose
         assumptions are invisible is worse than none, because it gets quoted. -->
    <BaseCard v-if="report?.caveats.length || provenance?.notes.length" padding="sm">
      <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Read before quoting</p>
      <ul class="mt-2 space-y-1">
        <li v-for="c in report?.caveats ?? []" :key="c" class="text-xs text-ink-secondary">{{ c }}</li>
        <li v-for="n in provenance?.notes ?? []" :key="n" class="text-xs text-ink-tertiary">{{ n }}</li>
      </ul>
    </BaseCard>
  </div>
</template>
