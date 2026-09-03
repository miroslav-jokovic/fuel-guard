<script setup lang="ts">
import type { TruckCpm } from "@silvicom/shared";
import type { SortState } from "@/lib/sort";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { computed } from "vue";

/**
 * The per-truck table, lifted out of `CpmReportPage.vue` when the page grew tabs (2026-08-29).
 * It renders a page of rows and nothing else: filtering, sorting and paging are the page's, because
 * the fleet figures above the tabs must keep covering every truck no matter what the table shows.
 */
const props = defineProps<{
  /** The visible slice — already filtered, sorted and paged by the page. */
  rows: TruckCpm[];
  /** Samsara measured the window, so there is no estimated-deadhead column to show. */
  samsaraBasis: boolean;
  loading: boolean;
  error: string | null;
  retrying: boolean;
  sort: SortState;
  page: number;
  /** Rows after filtering — what the pager counts. */
  total: number;
  /** Rows before filtering — tells "no match" apart from "nothing has run yet". */
  totalUnfiltered: number;
  pendingSources: string[];
  pageSize: number;
}>();
defineEmits<{ sort: [key: string]; retry: []; "update:page": [n: number] }>();

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
const fmtMiles = (n: number) => Math.round(n).toLocaleString();
// Cents stay the harness's unit; the PAGE speaks dollars per mile — $1.34, not 133.5¢. A rate the
// harness could not compute (no miles this window, D-FIN10) is a dash, never $0.00: the dollars in the
// row are real, the rate is absent, and $0.00 would read as cheap.
const NO_RATE = "—";
const fmtCpm = (n: number | null) => (n == null ? NO_RATE : `$${(n / 100).toFixed(2)}`);

// The miles columns follow the report's basis (owner ruling: Samsara actuals are the fleet's
// mileage truth; McLeod loaded stays as reference). The estimate columns appear only when the
// window has no Samsara miles and the harness fell back — and said so.
const columns = computed<DataTableColumn[]>(() => [
  { key: "tractor_unit", label: "Truck", cellClass: "font-mono text-xs", sortable: true },
  { key: "movements", label: "Trips", numeric: true, sortable: true },
  { key: "loadedMiles", label: "Loaded miles", numeric: true, cellClass: "text-ink-tertiary", sortable: true },
  ...(props.samsaraBasis
    ? [{ key: "totalMiles", label: "Miles driven", numeric: true, sortable: true } as DataTableColumn]
    : [
        { key: "deadheadMilesEstimated", label: "Empty miles", numeric: true, cellClass: "text-ink-tertiary", sortable: true } as DataTableColumn,
        { key: "totalMiles", label: "Miles driven", numeric: true, sortable: true } as DataTableColumn,
      ]),
  { key: "directFuel", label: "Fuel", numeric: true, sortable: true },
  { key: "directSettlement", label: "Driver pay", numeric: true, sortable: true },
  { key: "directTotal", label: "Direct cost", numeric: true, sortable: true },
  { key: "fixedCost", label: "Fixed cost", numeric: true, sortable: true },
  { key: "revenue", label: "Earned", numeric: true, sortable: true },
  { key: "totalCpm", label: "Cost / mile", numeric: true, sortable: true },
  { key: "revenueCpm", label: "Earned / mile", numeric: true, sortable: true },
  { key: "netCpm", label: "Left / mile", numeric: true, sortable: true },
]);
</script>

<template>
  <DataTable
    :columns="columns"
    :rows="rows"
    embedded
    row-key="tractor_unit"
    :loading="loading"
    :error="error"
    :retrying="retrying"
    :sort="sort"
    @sort="$emit('sort', $event)"
    @retry="$emit('retry')"
  >
    <template #empty>
      <!-- Two different emptinesses. "The filters matched nothing" is the reader's own doing and is
           fixed by clearing them; "the sweeps have not run" is the harness's, and naming the pending
           source is the whole point of the provenance block. -->
      <div v-if="totalUnfiltered" class="space-y-1">
        <p>No truck matches these filters.</p>
        <p class="text-xs text-ink-tertiary">
          {{ totalUnfiltered }} {{ totalUnfiltered === 1 ? "truck is" : "trucks are" }} in this period.
          Clear the filters to see them.
        </p>
      </div>
      <div v-else class="space-y-1">
        <p>Nothing to show for this period yet.</p>
        <p v-for="s in pendingSources" :key="s" class="text-xs text-ink-tertiary">{{ s }}</p>
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
    <template #cell-totalCpm="{ value }">
      <span :title="value == null ? 'No miles this window — rate not computed' : undefined">{{ fmtCpm(value) }}</span>
    </template>
    <template #cell-revenueCpm="{ value }">
      <span :title="value == null ? 'No miles this window — rate not computed' : undefined">{{ fmtCpm(value) }}</span>
    </template>
    <template #cell-netCpm="{ value }">
      <span
        class="font-semibold"
        :class="value == null ? 'text-ink-tertiary' : value >= 0 ? 'text-ink' : 'text-danger-600'"
        :title="value == null ? 'No miles this window — rate not computed' : undefined"
      >{{ fmtCpm(value) }}</span>
    </template>
    <template #footer>
      <TablePagination
        :page="page"
        :page-size="pageSize"
        :total="total"
        :loading="retrying"
        @update:page="$emit('update:page', $event)"
      />
    </template>
  </DataTable>
</template>
