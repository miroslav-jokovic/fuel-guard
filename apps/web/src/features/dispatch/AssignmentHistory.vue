<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { shiftDuration, type AssignmentHistoryRow } from "@fuelguard/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar, { type FilterChip } from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { AppButton as BaseButton } from "@fuelguard/ui";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useDriversQuery } from "@/composables/useDrivers";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/composables/useTrailers";
import {
  useAssignmentHistoryQuery,
  type AssignmentHistoryFilters,
} from "@/features/dispatch/useAssignments";

/**
 * The attribution trail (loads plan L5 / D-L6).
 *
 * §14.9 designates this the audit record behind every evidence panel the detection engine renders.
 * "Who was in this truck at 14:20 on the 3rd" is the first question an anomaly investigation asks,
 * and until now it could only be answered by someone with SQL access — the engine has been citing a
 * trail nobody could open.
 *
 * NO SEARCH BOX, on purpose. The endpoint filters by driver, vehicle, trailer and date; it has no
 * text search. A search field over server-paginated rows would only match what happens to be loaded,
 * which is worse than no search at all — the design contract's rule is to never ship a filter no
 * query consumes.
 */

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const daysAgo = (n: number): string => iso(new Date(Date.now() - n * 86_400_000));

// A range, not "everything": the endpoint requires one, and opening on the last week is the question
// a dispatcher usually has. Widening it is one click; a silent unbounded default is a table scan.
const from = ref<string | undefined>(daysAgo(7));
const to = ref<string | undefined>(iso(new Date()));
const driverId = ref("");
const vehicleId = ref("");
const trailerId = ref("");

const drivers = useDriversQuery();
const vehicles = useVehiclesQuery();
const trailers = useTrailersQuery();

const driverOptions = computed(() => [
  { value: "", label: "All drivers" },
  ...(drivers.data.value ?? []).map((d) => ({ value: d.id, label: d.full_name })),
]);
const vehicleOptions = computed(() => [
  { value: "", label: "All trucks" },
  ...(vehicles.data.value ?? []).map((v) => ({ value: v.id, label: v.unit_number })),
]);
const trailerOptions = computed(() => [
  { value: "", label: "All trailers" },
  ...(trailers.data.value ?? []).map((t) => ({ value: t.id, label: t.unit_number })),
]);

const filters = computed<AssignmentHistoryFilters>(() => ({
  // The picker can be cleared; the query cannot run without a range, so fall back to the same
  // seven-day window rather than firing an unbounded request.
  from: from.value ?? daysAgo(7),
  to: to.value ?? iso(new Date()),
  ...(driverId.value ? { driverId: driverId.value } : {}),
  ...(vehicleId.value ? { vehicleId: vehicleId.value } : {}),
  ...(trailerId.value ? { trailerId: trailerId.value } : {}),
}));

const query = useAssignmentHistoryQuery(filters);
const rows = computed<AssignmentHistoryRow[]>(
  () => query.data.value?.pages.flatMap((p) => p.segments) ?? [],
);

// Secondary filters only — the trigger on a primary FilterSelect already shows its own value.
const label = (options: { value: string; label: string }[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value;
const chips = computed<FilterChip[]>(() => {
  const out: FilterChip[] = [];
  if (vehicleId.value)
    out.push({
      key: "vehicle",
      label: "Truck",
      value: label(vehicleOptions.value, vehicleId.value),
    });
  if (trailerId.value)
    out.push({
      key: "trailer",
      label: "Trailer",
      value: label(trailerOptions.value, trailerId.value),
    });
  return out;
});
const moreCount = computed(() => (vehicleId.value ? 1 : 0) + (trailerId.value ? 1 : 0));
function removeChip(key: string): void {
  if (key === "vehicle") vehicleId.value = "";
  if (key === "trailer") trailerId.value = "";
}
function clearAll(): void {
  vehicleId.value = "";
  trailerId.value = "";
}

// Changing a filter starts a new keyset walk; without this the accumulated pages would be a mix of
// two different questions.
watch(filters, () => void query.refetch());

const nowMs = ref(Date.now());
const held = (row: AssignmentHistoryRow): string =>
  shiftDuration(row.from_at, row.to_at ? Date.parse(row.to_at) : nowMs.value);

const columns: DataTableColumn[] = [
  {
    key: "driver_name",
    label: "Driver",
    width: "lg",
    cellClass: "font-medium text-ink",
  },
  {
    key: "vehicle_unit",
    label: "Truck",
    width: "sm",
    cellClass: "text-ink-secondary",
  },
  {
    key: "trailer_unit",
    label: "Trailer",
    width: "sm",
    cellClass: "text-ink-secondary",
  },
  { key: "from_at", label: "From", width: "lg", cellClass: "text-ink-secondary" },
  { key: "to_at", label: "To", width: "lg", cellClass: "text-ink-secondary" },
  {
    key: "held",
    label: "Held for",
    numeric: true,
    width: "sm",
    cellClass: "text-ink-secondary",
  },
  { key: "seat", label: "Seat", width: "md" },
];

const stamp = (v: string): string =>
  new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
</script>

<template>
  <div class="space-y-6">
    <FilterBar
      :count="rows.length"
      count-label="segments loaded"
      :chips="chips"
      :more-count="moreCount"
      @remove="removeChip"
      @clear-all="clearAll"
    >
      <template #filters>
        <DateRangeFilter v-model:from="from" v-model:to="to" />
        <FilterSelect v-model="driverId" label="Driver" :options="driverOptions" />
      </template>
      <template #more>
        <FilterSelect v-model="vehicleId" label="Truck" :options="vehicleOptions" block />
        <FilterSelect v-model="trailerId" label="Trailer" :options="trailerOptions" block />
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="rows"
      row-key="segment_id"
      :loading="query.isLoading.value"
      :error="
        query.isError.value
          ? (query.error.value?.message ?? 'Could not load the assignment history.')
          : null
      "
      :retrying="query.isFetching.value"
      empty-text="No equipment was held in this range. Widen the dates, or clear a filter."
      @retry="query.refetch()"
    >
      <template #cell-from_at="{ row }">{{ stamp(row.from_at) }}</template>
      <template #cell-to_at="{ row }">
        <span v-if="row.to_at">{{ stamp(row.to_at) }}</span>
        <span v-else :class="[BADGE_BASE, toneClass('brand')]">Still held</span>
      </template>
      <template #cell-held="{ row }">{{ held(row) }}</template>
      <template #cell-seat="{ row }">
        <span :class="[BADGE_BASE, toneClass(row.seat === 'driver' ? 'neutral' : 'info')]">
          {{ row.seat === "co_driver" ? "Co-driver" : "Driver" }}
        </span>
      </template>

      <template #footer>
        <!-- Keyset, so there is no page count to render: a total would need a full scan of the very
             table the date range exists to keep us out of. The count above says how many are loaded. -->
        <div class="flex items-center justify-center px-4 py-3">
          <BaseButton
            v-if="query.hasNextPage.value"
            variant="ghost"
            size="sm"
            :disabled="query.isFetchingNextPage.value"
            @click="query.fetchNextPage()"
          >
            {{ query.isFetchingNextPage.value ? "Loading…" : "Load more" }}
          </BaseButton>
          <p v-else-if="rows.length > 0" class="text-sm text-ink-tertiary">
            That is every segment in this range.
          </p>
        </div>
      </template>
    </DataTable>
  </div>
</template>
