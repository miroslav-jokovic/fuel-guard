<script setup lang="ts">
import type { TruckCpm } from "@silvicom/shared";
import type { SortState } from "@/lib/sort";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";

/**
 * The per-truck table — **only the columns that are precise per truck** (G7, §2 Tab 4).
 *
 * It used to carry fuel, driver pay, direct cost, fixed cost, cost per mile and left per mile. Every
 * one of those went at G7, and not because they were hard: because no per-truck COST figure at this
 * carrier is precise. Fuel is joined by unit and misses the fills that carry no tractor; the fixed
 * schedule was a contract's assertion re-keyed by hand; the overhead share was an apportionment of
 * money the ledger never attributed to a truck at all. A column that looks like a measurement and is
 * an estimate is worse than no column, and the fleet report answers the cost question honestly one
 * level up (D-FLEET1, D-FLEET8).
 *
 * What is left is measured: Samsara's miles for the truck, and the revenue the GL booked against the
 * loads it hauled. Filtering, sorting and paging stay the page's, because the fleet figures above
 * must keep covering every truck no matter what this table shows.
 */
defineProps<{
  /** The visible slice — already filtered, sorted and paged by the page. */
  rows: TruckCpm[];
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

const columns: DataTableColumn[] = [
  { key: "tractor_unit", label: "Truck", cellClass: "font-mono text-xs", sortable: true },
  { key: "movements", label: "Trips", numeric: true, sortable: true },
  { key: "totalMiles", label: "Miles driven", numeric: true, sortable: true },
  { key: "revenue", label: "Earned", numeric: true, sortable: true },
  { key: "revenueCpm", label: "Earned / mile", numeric: true, sortable: true },
];

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
    <template #cell-totalMiles="{ value }">{{ fmtMiles(value) }}</template>
    <template #cell-revenue="{ value }">{{ fmtUsd(value) }}</template>
    <template #cell-revenueCpm="{ value }">
      <span :title="value == null ? 'No miles this window — rate not computed' : undefined">{{ fmtCpm(value) }}</span>
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
