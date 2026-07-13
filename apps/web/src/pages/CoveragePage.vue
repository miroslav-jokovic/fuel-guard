<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useDetectionCoverage } from "@/features/fuel/useDetectionCoverage";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import DataTable from "@/components/ui/DataTable.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import TablePagination from "@/components/TablePagination.vue";

const { data, isLoading, isError, error, refetch, isFetching } = useDetectionCoverage();
const { data: vehicles } = useVehiclesQuery();

const unit = (id: string) => vehicles.value?.find((v) => v.id === id)?.unit_number ?? id;
const trucks = computed(() => data.value?.perTruck ?? []);

const PAGE_SIZE = 20;
const page = ref(1);
watch(trucks, () => (page.value = 1));
const paged = computed(() => trucks.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const fmtPct = (n: number) => `${Math.round(n)}%`;
const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// Higher coverage = greener; blind share inverts the scale.
const covTone = (p: number) => (p >= 85 ? "text-success-700" : p >= 50 ? "text-warning-600" : "text-danger-700");
const blindTone = (p: number) => (p <= 15 ? "text-success-700" : p <= 50 ? "text-warning-600" : "text-danger-700");
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

    <div class="space-y-2">
      <p v-if="!isLoading && !isError && trucks.length > 0" class="text-xs text-ink-muted">Trucks with the biggest blind spots first — these are where detection is weakest.</p>
      <DataTable
        :loading="isLoading"
        :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
        :retrying="isFetching"
        :empty="trucks.length === 0"
        empty-text="No fuel activity in the last 90 days."
        :skeleton-cols="7"
        @retry="refetch"
      >
        <template #head>
          <tr>
            <th class="px-4 py-3 font-medium">Truck</th>
            <th class="px-4 py-3 font-medium text-right">Fills</th>
            <th class="px-4 py-3 font-medium text-right">Blind</th>
            <th class="px-4 py-3 font-medium text-right">Telematics</th>
            <th class="px-4 py-3 font-medium text-right">Location</th>
            <th class="px-4 py-3 font-medium text-right">Odometer</th>
            <th class="px-4 py-3 font-medium text-right">Attributed</th>
          </tr>
        </template>
        <tr v-for="t in paged" :key="t.vehicleId">
          <td class="px-4 py-3 font-medium text-ink">
            <RouterLink :to="`/vehicles/${t.vehicleId}`" class="text-brand-600 hover:text-brand-500">{{ unit(t.vehicleId) }}</RouterLink>
          </td>
          <td class="px-4 py-3 text-right text-ink-secondary">{{ t.fills.toLocaleString() }}</td>
          <td class="px-4 py-3 text-right font-medium" :class="blindTone(t.blindPct)">{{ t.blindFills }} ({{ fmtPct(t.blindPct) }})</td>
          <td class="px-4 py-3 text-right" :class="covTone(t.reconciledPct)">{{ fmtPct(t.reconciledPct) }}</td>
          <td class="px-4 py-3 text-right" :class="covTone(t.locationPct)">{{ fmtPct(t.locationPct) }}</td>
          <td class="px-4 py-3 text-right" :class="covTone(t.odometerPct)">{{ fmtPct(t.odometerPct) }}</td>
          <td class="px-4 py-3 text-right" :class="covTone(t.attributedPct)">{{ fmtPct(t.attributedPct) }}</td>
        </tr>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="trucks.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </div>
  </div>
</template>
