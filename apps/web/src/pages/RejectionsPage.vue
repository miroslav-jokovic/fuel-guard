<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useDeclinedTransactions, EFS_PAGE_SIZE, type EfsFilters } from "@/features/reports/useEfsData";
import type { DeclinedTransactionRow } from "@fuelguard/shared";
import { stationDateTime } from "@/lib/stationTime";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import AppSelect from "@/components/AppSelect.vue";
import SearchInput from "@/components/SearchInput.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import TablePagination from "@/components/TablePagination.vue";
import SlideOver from "@/components/SlideOver.vue";
import { toggleSort, type SortState } from "@/lib/sort";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { BADGE_BASE, suspicionTone, toneClass } from "@/lib/badges";

const session = useSessionStore();
const toast = useToastStore();
const filters = ref<EfsFilters>({});
const page = ref(1);
watch(filters, () => (page.value = 1), { deep: true });

const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
  filters.value = { ...filters.value, sortKey: sort.value.key ?? undefined, sortDir: sort.value.dir };
}

const { data, isLoading, isError, error, refetch, isFetching } = useDeclinedTransactions(filters, page);

const { data: vehicles } = useVehiclesQuery();
const unitOptions = computed(() => [
  { value: "", label: "All units" },
  ...[...new Set((vehicles.value ?? []).map((v) => v.unit_number))].sort().map((u) => ({ value: u, label: u })),
]);

const unit = computed({
  get: () => filters.value.unit ?? "",
  set: (v: string) => (filters.value = { ...filters.value, unit: v || undefined }),
});
const suspicion = computed({
  get: () => filters.value.suspicion ?? "",
  set: (v: string) => (filters.value = { ...filters.value, suspicion: v || undefined }),
});
const search = computed({
  get: () => filters.value.search ?? "",
  set: (v: string) => (filters.value = { ...filters.value, search: v || undefined }),
});
const setFrom = (v: string | undefined) => (filters.value = { ...filters.value, from: v });
const setTo = (v: string | undefined) => (filters.value = { ...filters.value, to: v });

const rows = computed(() => data.value?.rows ?? []);
const total = computed(() => data.value?.total ?? 0);
// Show declined times in the station's local timezone (matches the EFS report), not the browser's.
const fmt = (iso: string | null, state: string | null) => stationDateTime(iso, state);

// Row drill-down: click a decline to inspect its full details + why it was flagged.
const selectedRow = ref<DeclinedTransactionRow | null>(null);

const rescoring = ref(false);
async function rescore() {
  rescoring.value = true;
  const res = await apiFetch("/api/transactions/rescore-declined", { method: "POST" });
  rescoring.value = false;
  if (res.ok) toast.success("Rescoring started", "Checking each declined attempt against Samsara — refresh in a minute.");
  else if (res.status === 409) toast.info("Already running", "A rescore is already in progress — refresh in a moment.");
  else toast.error("Could not start rescore", res.error?.message);
}

const columns: DataTableColumn[] = [
  {
    key: "unit",
    label: "Unit",
    sortable: true,
    headerClass: "sticky left-0 z-20 bg-surface-subtle min-w-[5rem] border-r border-edge",
    cellClass: "sticky left-0 z-[1] border-r border-edge bg-surface font-medium text-ink group-hover:bg-surface-subtle",
  },
  { key: "suspicion_level", label: "Risk", sortable: true, headerClass: "min-w-[5rem]" },
  { key: "declined_at", label: "Date / Time", sortable: true, headerClass: "min-w-[10rem]", cellClass: "text-ink-secondary" },
  { key: "card_ref", label: "Card #", headerClass: "min-w-[7rem]", cellClass: "text-ink-secondary" },
  { key: "invoice", label: "Invoice", headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "driver_name", label: "Driver", sortable: true, headerClass: "min-w-[9rem]", cellClass: "text-ink-secondary" },
  { key: "location_text", label: "Location", headerClass: "min-w-[12rem]", cellClass: "text-ink-secondary" },
  { key: "city", label: "City", headerClass: "min-w-[8rem]", cellClass: "text-ink-secondary" },
  { key: "state", label: "State", sortable: true, headerClass: "min-w-[4rem]", cellClass: "text-ink-secondary" },
  { key: "error_code", label: "Error", sortable: true, headerClass: "min-w-[5rem]" },
  { key: "error_description", label: "Description", headerClass: "min-w-[14rem]", cellClass: "max-w-md truncate text-ink-secondary" },
  { key: "policy_name", label: "Policy", headerClass: "min-w-[8rem]", cellClass: "text-ink-secondary" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Declined fuel-card attempts from your uploaded EFS Reject reports (a fraud/control signal)." />

    <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div class="lg:max-w-xs lg:flex-1">
        <SearchInput v-model="search" placeholder="Search unit, driver, location…" />
      </div>
      <AppSelect
        v-model="suspicion"
        :options="[
          { value: '', label: 'All attempts' },
          { value: 'alert', label: 'Alert' },
          { value: 'review', label: 'Review' },
          { value: 'clear', label: 'Clear' },
        ]"
        class="lg:w-36"
      />
      <AppSelect v-model="unit" :options="unitOptions" class="lg:w-40" />
      <DateRangeFilter :from="filters.from" :to="filters.to" @update:from="setFrom" @update:to="setTo" />
      <div class="flex items-center gap-3 lg:ml-auto">
        <span class="text-sm text-ink-muted">{{ total }} total</span>
        <BaseButton
          v-if="session.canManage"
          size="sm"
          :disabled="rescoring"
          title="Check each declined attempt against Samsara + card patterns"
          @click="rescore"
        >
          {{ rescoring ? "Rescoring…" : "Rescore" }}
        </BaseButton>
      </div>
    </div>

    <DataTable
      :columns="columns"
      :rows="rows"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load rejections') : null"
      :retrying="isFetching"
      :sort="sort"
      :row-class="() => 'group cursor-pointer'"
      empty-text="No declined transactions match — upload an EFS Reject report from the Import page, or adjust filters."
      @sort="onSort"
      @retry="refetch"
      @row-click="selectedRow = $event"
    >
      <template #cell-suspicion_level="{ row }">
        <span
          v-if="row.suspicion_level && row.suspicion_level !== 'clear'"
          :class="[BADGE_BASE, suspicionTone(row.suspicion_level)]"
          :title="(row.suspicion_reasons ?? []).map((r) => r.detail).join(' · ')"
          >{{ row.suspicion_level }}</span
        >
        <span v-else-if="row.suspicion_level === 'clear'" class="text-xs text-ink-subtle">Clear</span>
        <span v-else class="text-xs text-ink-subtle">—</span>
      </template>
      <template #cell-declined_at="{ row }">{{ fmt(row.declined_at, row.state) }}</template>
      <template #cell-error_code="{ row }">
        <span :class="[BADGE_BASE, toneClass('danger')]">{{ row.error_code }}</span>
      </template>
      <template #cell-error_description="{ row }">
        <span :title="row.error_description ?? ''">{{ row.error_description }}</span>
      </template>
      <template #cell-policy_name="{ row }">{{ row.policy_name?.trim() }}</template>
      <template #footer>
        <TablePagination
          :page="page"
          :page-size="EFS_PAGE_SIZE"
          :total="total"
          :loading="isFetching"
          @update:page="page = $event"
        />
      </template>
    </DataTable>

    <!-- Decline detail drill-down -->
    <SlideOver :open="!!selectedRow" title="Declined attempt" @close="selectedRow = null">
      <div v-if="selectedRow" class="space-y-5 text-sm">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-lg font-semibold text-ink">Unit {{ selectedRow.unit || "—" }}</div>
            <div class="text-ink-muted">{{ fmt(selectedRow.declined_at, selectedRow.state) }}</div>
          </div>
          <span
            v-if="selectedRow.suspicion_level && selectedRow.suspicion_level !== 'clear'"
            :class="[BADGE_BASE, suspicionTone(selectedRow.suspicion_level)]"
            >{{ selectedRow.suspicion_level }}</span
          >
          <span v-else class="text-xs text-ink-subtle">Clear</span>
        </div>

        <div class="rounded-md bg-danger-50 p-3 ring-1 ring-danger-100">
          <div class="flex items-center gap-2">
            <span :class="[BADGE_BASE, toneClass('danger')]">{{ selectedRow.error_code }}</span>
            <span class="font-medium text-danger-800">{{ selectedRow.error_description }}</span>
          </div>
          <p v-if="selectedRow.policy_name" class="mt-1 text-xs text-danger-700">Policy: {{ selectedRow.policy_name.trim() }}</p>
        </div>

        <div v-if="(selectedRow.suspicion_reasons ?? []).length" class="space-y-2">
          <h4 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Why it was flagged</h4>
          <ul class="space-y-1.5">
            <li v-for="(r, i) in selectedRow.suspicion_reasons ?? []" :key="i" class="flex items-start gap-2 text-ink-secondary">
              <span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning-400" aria-hidden="true" />
              <span>{{ r.detail }}</span>
            </li>
          </ul>
        </div>

        <dl class="grid grid-cols-2 gap-x-4 gap-y-3">
          <div><dt class="text-xs text-ink-subtle">Driver</dt><dd class="text-ink">{{ selectedRow.driver_name || "—" }}</dd></div>
          <div><dt class="text-xs text-ink-subtle">Card #</dt><dd class="text-ink">{{ selectedRow.card_ref || "—" }}</dd></div>
          <div><dt class="text-xs text-ink-subtle">Invoice</dt><dd class="text-ink">{{ selectedRow.invoice || "—" }}</dd></div>
          <div><dt class="text-xs text-ink-subtle">Location</dt><dd class="text-ink">{{ selectedRow.location_text || "—" }}</dd></div>
          <div><dt class="text-xs text-ink-subtle">City</dt><dd class="text-ink">{{ selectedRow.city || "—" }}</dd></div>
          <div><dt class="text-xs text-ink-subtle">State</dt><dd class="text-ink">{{ selectedRow.state || "—" }}</dd></div>
        </dl>
      </div>
    </SlideOver>
  </div>
</template>
