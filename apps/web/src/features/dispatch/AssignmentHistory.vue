<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { parseYmd, shiftDuration, type AssignmentHistoryRow } from "@silvicom/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar, { type FilterChip } from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import TablePagination from "@/components/TablePagination.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useDriversQuery } from "@/composables/useDrivers";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/composables/useTrailers";
import {
  HISTORY_PAGE_SIZE as PAGE_SIZE,
  useAssignmentHistoryQuery,
  type AssignmentHistoryFilters,
} from "@/features/dispatch/useAssignments";
import { formatDateTime } from "@/lib/format";
import { useQueryState } from "@/composables/useQueryState";

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
const DEFAULT_FROM = daysAgo(7);
const DEFAULT_TO = iso(new Date());
/**
 * The filters live in the URL (D-US2), so reload, a pasted link and Back from a driver's or a truck's
 * page all reopen the same trail.
 *
 * Scoped `history.` because this list SHARES ITS ROUTE with the dispatch board: `/assignments` already
 * owns `?search=`, `?fleet=`, `?dispatcher=`, `?queue=`, `?sort=`, `?dir=` and `?truck=`, and this tab
 * is reached as `?queue=history` on that same route. It is a tab, not a drawer, so its state is worth
 * keeping — "who held 773 last Tuesday" is exactly the question a dispatcher forwards as a link.
 *
 * The week is the FALLBACK, so a plain link opens on it and the default is never written. A hand-edited
 * date that is not a real calendar day reads as the default rather than reaching the endpoint, whose
 * contract only says `min(1)`. Clearing the picker puts the week back: the query cannot run without a
 * range, and an emptied picker over a table still answering for last week told the reader nothing.
 * The driver, truck and trailer ids are not checked against a list — the lists are loaded after the
 * page opens, and an id nobody matches is a filter that matches nothing, which the endpoint rejects as
 * a non-uuid rather than widening.
 */
const qs = useQueryState("history");
const fromParam = qs.param("from", undefined, DEFAULT_FROM);
const toParam = qs.param("to", undefined, DEFAULT_TO);
const from = computed<string | undefined>({
  get: () => parseYmd(fromParam.value) ?? DEFAULT_FROM,
  set: (v) => (fromParam.value = v ?? DEFAULT_FROM),
});
const to = computed<string | undefined>({
  get: () => parseYmd(toParam.value) ?? DEFAULT_TO,
  set: (v) => (toParam.value = v ?? DEFAULT_TO),
});
const driverId = qs.param("driver");
const vehicleId = qs.param("vehicle");
const trailerId = qs.param("trailer");

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

/**
 * Prev/Next over the keyset walk (D-US8), in place of the "Load more" button that grew one ever-longer
 * table. Page N is the Nth page the infinite query has fetched: Next past the last fetched page asks
 * the server for the following one and turns the page only once it has arrived, and Prev reads a page
 * already held. There is no count — a total would need a full scan of the very table the date range
 * exists to keep us out of — so the pager runs uncounted, as the Audit log's does.
 *
 * ⚠ The PAGE is deliberately not in the URL, for the Audit log's reason (Q-US2, UI-STANDARDIZATION.md):
 * page N is only reachable by walking the N − 1 cursors before it, which live in memory, and a
 * `?history.page=3` read back on a reload would have no cursor to stand on and would show page 1's rows
 * under a "page 3" label. The filters are in the URL, which is what a forwarded link needs.
 */
const page = ref(1);
const fetchedPages = computed(() => query.data.value?.pages.length ?? 0);
const pageRows = computed<AssignmentHistoryRow[]>(() => query.data.value?.pages[page.value - 1]?.segments ?? []);
const hasNext = computed(() => page.value < fetchedPages.value || query.hasNextPage.value);
async function goTo(n: number): Promise<void> {
  if (n > fetchedPages.value) {
    if (!query.hasNextPage.value) return;
    await query.fetchNextPage();
    if (n > fetchedPages.value) return;
  }
  page.value = n;
}

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
/**
 * The opening week is the default, not a filter somebody set, so the range counts only once it has
 * moved off it — and clearing puts it back rather than emptying it, which `filters` would read as the
 * same week anyway.
 */
const activeCount = computed(
  () =>
    (from.value !== DEFAULT_FROM || to.value !== DEFAULT_TO ? 1 : 0) +
    [driverId.value, vehicleId.value, trailerId.value].filter(Boolean).length,
);
function clearAll(): void {
  // One patch, not five: the buffer would coalesce them anyway, but one write says what this is.
  qs.set({ from: undefined, to: undefined, driver: undefined, vehicle: undefined, trailer: undefined });
}

// Changing a filter starts a new keyset walk; without this the accumulated pages would be a mix of
// two different questions. Watched by VALUE: `filters` now reads the URL (D-US2), so it recomputes on
// every navigation — once when a write lands in `useQueryState`'s buffer and again when the router
// settles on the same values — and a watch on the object would restart the walk twice per change.
watch(() => JSON.stringify(filters.value), () => {
  page.value = 1;
  void query.refetch();
});

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

const stamp = (v: string): string => formatDateTime(v);
</script>

<template>
  <DataWorkspace>
    <FilterBar
      embedded
      :count="rows.length"
      count-label="segments loaded"
      :chips="chips"
      :more-count="moreCount"
      :active-count="activeCount"
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
      embedded
      :columns="columns"
      :rows="pageRows"
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
        <TablePagination
          v-if="pageRows.length > 0 || page > 1"
          :page="page"
          :page-size="PAGE_SIZE"
          :total="null"
          :has-next="hasNext"
          :page-rows="pageRows.length"
          :loading="query.isFetching.value"
          :jumpable="false"
          @update:page="goTo"
        />
      </template>
    </DataTable>
  </DataWorkspace>
</template>
