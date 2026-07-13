<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { PlusIcon } from "@heroicons/vue/20/solid";
import { fuelTxnStatus, type FillUpInput } from "@fuelguard/shared";
import { BADGE_BASE, txnStatusTone, toneClass } from "@/lib/badges";
import { stationDateTime } from "@/lib/stationTime";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useFuelTransactions, useCreateFillUp, FUEL_PAGE_SIZE, type FuelFilters } from "@/features/fuel/useFuelLog";
import SlideOver from "@/components/SlideOver.vue";
import FillUpForm from "@/features/fuel/FillUpForm.vue";
import VehicleSelect from "@/components/VehicleSelect.vue";
import AppSelect from "@/components/AppSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import SortableTh from "@/components/SortableTh.vue";
import DataTable from "@/components/ui/DataTable.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import TablePagination from "@/components/TablePagination.vue";
import { toggleSort, type SortState } from "@/lib/sort";
import { useToastStore } from "@/stores/toast";

const { data: vehicles } = useVehiclesQuery();

const filters = ref<FuelFilters>({});
const page = ref(1);
watch(filters, () => (page.value = 1), { deep: true });

const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
  filters.value = { ...filters.value, sortKey: sort.value.key ?? undefined, sortDir: sort.value.dir };
}
const { data, isLoading, isError, error, refetch, isFetching } = useFuelTransactions(filters, page);

// Date inputs emit YYYY-MM-DD; make `to` inclusive of the whole day for the timestamped column.
const fromDate = computed(() => filters.value.from?.slice(0, 10));
const toDate = computed(() => filters.value.to?.slice(0, 10));
const setFrom = (v: string | undefined) => (filters.value = { ...filters.value, from: v });
const setTo = (v: string | undefined) =>
  (filters.value = { ...filters.value, to: v ? `${v}T23:59:59` : undefined });

const tankTypeFilter = computed<string>({
  get: () => filters.value.tankType ?? "",
  set: (v) => (filters.value = { ...filters.value, tankType: v === "tractor" || v === "reefer" ? v : undefined }),
});

const rows = computed(() => data.value?.rows ?? []);
const total = computed(() => data.value?.total ?? 0);

const vehicleLabel = (id: string | null) =>
  id ? (vehicles.value?.find((v) => v.id === id)?.unit_number ?? "—") : "Unattributed";

const toast = useToastStore();
const drawerOpen = ref(false);
const createFillUp = useCreateFillUp();

async function onSubmit(payload: { input: FillUpInput; file: File | null }) {
  try {
    await createFillUp.mutateAsync(payload);
    drawerOpen.value = false;
    toast.success("Fill-up logged");
  } catch (e) {
    toast.error("Could not save fill-up", e instanceof Error ? e.message : undefined);
  }
}

// Station-local (matches the EFS report), not the browser's timezone.
const fmtDate = (iso: string, state: string | null) => stationDateTime(iso, state);

const flaggedCount = computed(() => rows.value.filter((t) => t.has_anomaly).length);
const clearCount   = computed(() => rows.value.filter((t) => !t.has_anomaly).length);
const totalGallons = computed(() => rows.value.reduce((s, t) => s + t.gallons, 0));
const pageCost     = computed(() => rows.value.reduce((s, t) => s + (t.total_cost ?? 0), 0));
const hasCost      = computed(() => rows.value.some((t) => t.total_cost != null));
const mpgValues    = computed(() => rows.value.map((t) => t.computed_mpg).filter((v): v is number => v != null));
const avgMpg       = computed(() => mpgValues.value.length ? mpgValues.value.reduce((a, b) => a + b, 0) / mpgValues.value.length : null);
const fmtNum = (n: number, dec = 0) => n.toLocaleString("en-US", { maximumFractionDigits: dec });
const fmtUsd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <VehicleSelect
          v-model="filters.vehicleId"
          :vehicles="vehicles ?? []"
        />
        <AppSelect
          v-model="tankTypeFilter"
          class="w-36"
          :options="[{ value: '', label: 'All fuel' }, { value: 'tractor', label: 'Tractor' }, { value: 'reefer', label: 'Reefer' }]"
        />
        <DateRangeFilter :from="fromDate" :to="toDate" @update:from="setFrom" @update:to="setTo" />
      </div>
      <BaseButton variant="primary" @click="drawerOpen = true">
        <PlusIcon class="-ml-0.5 size-5" aria-hidden="true" /> Log fill-up
      </BaseButton>
    </div>

    <!-- Summary stats block -->
    <BaseCard v-if="!isLoading && !isError && total > 0" padding="none">
      <dl class="grid grid-cols-2 divide-y divide-edge-subtle sm:grid-cols-3 sm:divide-y-0 sm:divide-x lg:grid-cols-5">
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Total fill-ups</dt>
          <dd class="mt-1 text-2xl font-bold text-ink">{{ total.toLocaleString() }}</dd>
          <dd class="mt-0.5 text-xs text-ink-subtle">matching current filters</dd>
        </div>
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Flagged</dt>
          <dd class="mt-1 text-2xl font-bold" :class="flaggedCount ? 'text-danger-600' : 'text-ink-subtle'">{{ flaggedCount }}</dd>
          <dd class="mt-0.5 text-xs" :class="flaggedCount ? 'text-danger-400' : 'text-ink-subtle'">
            {{ flaggedCount ? 'anomalies need review' : 'no anomalies this page' }}
          </dd>
        </div>
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Clear</dt>
          <dd class="mt-1 text-2xl font-bold" :class="clearCount ? 'text-success-600' : 'text-ink-subtle'">{{ clearCount }}</dd>
          <dd class="mt-0.5 text-xs text-ink-subtle">transactions with no flags</dd>
        </div>
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Gallons</dt>
          <dd class="mt-1 text-2xl font-bold text-ink">{{ fmtNum(totalGallons, 0) }}</dd>
          <dd class="mt-0.5 text-xs text-ink-subtle">total this page</dd>
        </div>
        <div class="px-5 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Avg MPG</dt>
          <dd class="mt-1 text-2xl font-bold text-ink">{{ avgMpg != null ? avgMpg.toFixed(1) : '—' }}</dd>
          <dd class="mt-0.5 text-xs text-ink-subtle">{{ hasCost ? fmtUsd(pageCost) + ' total cost' : 'this page' }}</dd>
        </div>
      </dl>
    </BaseCard>

    <DataTable
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load fuel log') : null"
      :retrying="isFetching"
      :empty="rows.length === 0"
      empty-text="No fill-ups match these filters."
      :skeleton-cols="7"
      @retry="refetch"
    >
      <template #head>
        <tr>
          <SortableTh label="When" sort-key="fueled_at" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium min-w-[11rem]" @sort="onSort" />
          <th class="px-6 py-3 font-medium min-w-[7rem]">Vehicle</th>
          <SortableTh label="Odometer" sort-key="odometer" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium min-w-[8rem] text-right" @sort="onSort" />
          <SortableTh label="Gallons" sort-key="gallons" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium min-w-[6rem] text-right" @sort="onSort" />
          <SortableTh label="$/gal" sort-key="price_per_gal" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium min-w-[6rem] text-right" @sort="onSort" />
          <SortableTh label="MPG" sort-key="computed_mpg" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium min-w-[5rem] text-right" @sort="onSort" />
          <th class="px-6 py-3 font-medium min-w-[11rem]">Status</th>
        </tr>
      </template>
      <tr v-for="t in rows" :key="t.id" class="hover:bg-surface-subtle">
        <td class="px-6 py-3 whitespace-nowrap text-ink-secondary">{{ fmtDate(t.fueled_at, t.state ?? null) }}</td>
        <td class="px-6 py-3 text-ink">
          <span>{{ vehicleLabel(t.vehicle_id) }}</span>
          <span v-if="t.tank_type === 'reefer'" class="ml-1.5" :class="[BADGE_BASE, toneClass('info')]">Reefer</span>
        </td>
        <td class="px-6 py-3 text-right text-ink-secondary">{{ t.odometer ?? "—" }}</td>
        <td class="px-6 py-3 text-right text-ink-secondary">{{ t.gallons }}</td>
        <td class="px-6 py-3 text-right text-ink-secondary">{{ t.price_per_gal ?? "—" }}</td>
        <td class="px-6 py-3 text-right text-ink-secondary">{{ t.computed_mpg ?? "—" }}</td>
        <td class="px-6 py-3">
          <div class="flex items-center gap-1.5">
            <span
              :class="[BADGE_BASE, txnStatusTone(fuelTxnStatus(t).status)]"
              :title="fuelTxnStatus(t).locationConfirmed ? 'Location confirmed by Samsara' : undefined"
              >{{ fuelTxnStatus(t).label }}</span
            >
            <span
              v-if="fuelTxnStatus(t).locationConfirmed && !t.has_anomaly"
              class="text-success-600"
              title="Location confirmed by Samsara"
              >✓</span
            >
            <span
              v-if="t.ai_risk_level"
              :class="[BADGE_BASE, toneClass('brand')]"
              title="AI risk level"
              >AI: {{ t.ai_risk_level }}</span
            >
          </div>
        </td>
      </tr>
      <template #footer>
        <TablePagination
          :page="page"
          :page-size="FUEL_PAGE_SIZE"
          :total="total"
          :loading="isFetching"
          @update:page="page = $event"
        />
      </template>
    </DataTable>

    <SlideOver :open="drawerOpen" title="Log fill-up" @close="drawerOpen = false">
      <FillUpForm
        :vehicles="vehicles ?? []"
        :submitting="createFillUp.isPending.value"
        @submit="onSubmit"
        @cancel="drawerOpen = false"
      />
    </SlideOver>
  </div>
</template>
