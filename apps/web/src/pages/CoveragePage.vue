<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useDetectionCoverage } from "@/features/fuel/useDetectionCoverage";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import TablePagination from "@/components/TablePagination.vue";

const { data, isLoading, isError, error, refetch, isFetching } = useDetectionCoverage();
const { data: vehicles } = useVehiclesQuery();

const unit = (id: string) => vehicles.value?.find((v) => v.id === id)?.unit_number ?? id;
const trucks = computed(() => data.value?.perTruck ?? []);

const search = ref("");
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q ? trucks.value.filter((t) => unit(t.vehicleId).toLowerCase().includes(q)) : trucks.value;
});

const PAGE_SIZE = 20;
const page = ref(1);
watch(filtered, () => (page.value = 1));
const paged = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const fmtPct = (n: number) => `${Math.round(n)}%`;
const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// Higher coverage = greener; blind share inverts the scale.
const covTone = (p: number) => (p >= 85 ? "text-success-700" : p >= 50 ? "text-warning-600" : "text-danger-700");
const blindTone = (p: number) => (p <= 15 ? "text-success-700" : p <= 50 ? "text-warning-600" : "text-danger-700");

const columns: DataTableColumn[] = [
  { key: "vehicleId", label: "Truck", cellClass: "font-medium text-ink" },
  { key: "fills", label: "Fills", numeric: true, cellClass: "text-ink-secondary" },
  { key: "blindFills", label: "Blind", numeric: true },
  { key: "reconciledPct", label: "Telematics", numeric: true },
  { key: "locationPct", label: "Location", numeric: true },
  { key: "odometerPct", label: "Odometer", numeric: true },
  { key: "attributedPct", label: "Attributed", numeric: true },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader>
      How much of the last 90 days of fuel data the system could actually corroborate against Samsara —
      and which trucks are blind spots. A fill with no telematics match is still scored on internal
      physics, but it can't be cross-checked against location or a true odometer, so heavy blind coverage
      means "we didn't flag it" carries less weight. This is the honest bound on how much we can catch.
    </PageHeader>

    <div v-if="!isLoading && !isError && data" class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <BaseCard>
        <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Telematics coverage</dt>
        <dd class="mt-1 text-2xl font-bold" :class="covTone(data.reconciledPct)">{{ fmtPct(data.reconciledPct) }}</dd>
        <dd class="mt-0.5 text-xs text-ink-subtle">{{ data.blindFills.toLocaleString() }} of {{ data.totalFills.toLocaleString() }} fills blind</dd>
      </BaseCard>
      <BaseCard>
        <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Location-confirmed</dt>
        <dd class="mt-1 text-2xl font-bold" :class="covTone(data.locationConfirmedPct)">{{ fmtPct(data.locationConfirmedPct) }}</dd>
        <dd class="mt-0.5 text-xs text-ink-subtle">GPS placed the truck at the station · {{ fmtPct(data.locationPct) }} judgeable (incl. in-state)</dd>
      </BaseCard>
      <BaseCard>
        <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Odometer-verifiable</dt>
        <dd class="mt-1 text-2xl font-bold" :class="covTone(data.odometerPct)">{{ fmtPct(data.odometerPct) }}</dd>
        <dd class="mt-0.5 text-xs text-ink-subtle">fueling-time odometer available</dd>
      </BaseCard>
      <BaseCard>
        <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Attributed</dt>
        <dd class="mt-1 text-2xl font-bold" :class="covTone(data.attributedPct)">{{ fmtPct(data.attributedPct) }}</dd>
        <dd class="mt-0.5 text-xs text-ink-subtle">{{ data.unattributed.toLocaleString() }} unmatched to a truck/driver</dd>
      </BaseCard>
    </div>

    <!-- Fueling-time confidence mix -->
    <BaseCard v-if="data && data.totalFills > 0" padding="sm">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Fueling-time confidence</h3>
        <p class="text-xs text-ink-subtle">Last telematics match: {{ fmtDateTime(data.lastReconciledAt) }} · <RouterLink to="/settings/data" class="text-brand-600 hover:text-brand-500">Re-sync</RouterLink></p>
      </div>
      <div class="mt-2 flex flex-wrap gap-2 text-sm">
        <span class="inline-flex items-center gap-1.5 rounded-full bg-success-50 px-3 py-1 ring-1 ring-success-200"><span class="font-medium text-success-800">Tank-confirmed</span><span class="text-success-700">{{ data.timeBasis.tank_confirmed }}</span></span>
        <span class="inline-flex items-center gap-1.5 rounded-full bg-info-50 px-3 py-1 ring-1 ring-info-200"><span class="font-medium text-info-800">Stop-estimated</span><span class="text-info-700">{{ data.timeBasis.stop_estimated }}</span></span>
        <span class="inline-flex items-center gap-1.5 rounded-full bg-warning-50 px-3 py-1 ring-1 ring-warning-200"><span class="font-medium text-warning-800">Reported time</span><span class="text-warning-700">{{ data.timeBasis.reported }}</span></span>
        <span class="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1 ring-1 ring-edge"><span class="font-medium text-ink-secondary">Date only</span><span class="text-ink-secondary">{{ data.timeBasis.date_only }}</span></span>
        <span class="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1 ring-1 ring-edge"><span class="font-medium text-ink-secondary">No telematics</span><span class="text-ink-secondary">{{ data.timeBasis.none }}</span></span>
      </div>
    </BaseCard>

    <FilterBar
      v-model:search="search"
      search-placeholder="Search truck…"
      :count="filtered.length"
      count-label="trucks"
    />

    <div class="space-y-2">
      <p v-if="!isLoading && !isError && trucks.length > 0" class="text-xs text-ink-muted">Trucks with the biggest blind spots first — these are where detection is weakest.</p>
      <DataTable
        :columns="columns"
        :rows="paged"
        row-key="vehicleId"
        :loading="isLoading"
        :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
        :retrying="isFetching"
        empty-text="No fuel activity in the last 90 days."
        @retry="refetch"
      >
        <template #cell-vehicleId="{ row }">
          <RouterLink :to="`/vehicles/${row.vehicleId}`" class="text-brand-600 hover:text-brand-500">{{ unit(row.vehicleId) }}</RouterLink>
        </template>
        <template #cell-fills="{ value }">{{ value.toLocaleString() }}</template>
        <template #cell-blindFills="{ row }">
          <span class="font-medium" :class="blindTone(row.blindPct)">{{ row.blindFills }} ({{ fmtPct(row.blindPct) }})</span>
        </template>
        <template #cell-reconciledPct="{ value }">
          <span :class="covTone(value)">{{ fmtPct(value) }}</span>
        </template>
        <template #cell-locationPct="{ value }">
          <span :class="covTone(value)">{{ fmtPct(value) }}</span>
        </template>
        <template #cell-odometerPct="{ value }">
          <span :class="covTone(value)">{{ fmtPct(value) }}</span>
        </template>
        <template #cell-attributedPct="{ value }">
          <span :class="covTone(value)">{{ fmtPct(value) }}</span>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="filtered.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </div>
  </div>
</template>
