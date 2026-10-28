<script setup lang="ts">
import { computed, watch } from "vue";
import { parseYmd } from "@silvicom/shared";
import {
  useQueryState,
  DataWorkspace,
  FilterBar,
  TablePagination,
  DataTable,
  type DataTableColumn,
} from "@silvicom/ui";
import { useMaintenanceSpendQuery } from "@/features/maintenance/useMaintenanceSpend";
import { lastFullMonth } from "@/lib/dateWindow";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { formatDate as fmtDate } from "@/lib/format";
import { useOpens } from "@/composables/useOpens";

/**
 * Repair spend — the shop's own list of what the ledger booked against maintenance (R7 of the
 * fleet report's UI plan, owner ruling Q3 of 2026-09-04).
 *
 * The header used to promise "work orders and FleetPal detail" as this section grew; §0 of the
 * fleet plan deleted FleetPal from Finance, and maintenance is a ledger family now. This page says
 * what it is. The window opens on the last full month rather than ninety days into tomorrow, the
 * way every other money page reads, and a reader who can see the fleet report is pointed at the
 * family that totals these lines — the total itself is not printed here, because this page sits
 * behind the maintenance gate, which a technician holds and the accounting gate does not, and a
 * figure read from the fleet report would fail for the very role the page exists for.
 */
const defaultWindow = lastFullMonth();
/**
 * The window and the page live in the URL (D-US2), so a reload, a forwarded month and Back keep the
 * list. The last full month is each end's FALLBACK — never written — so a plain link, and a bookmark,
 * keeps opening on whichever month last closed instead of freezing the one it was saved in. A
 * hand-edited date that is not a real calendar day reads as the default end; clearing the picker keeps
 * the window it had, as it always did.
 */
const qs = useQueryState();
const fromParam = qs.param("from", undefined, defaultWindow.from);
const toParam = qs.param("to", undefined, defaultWindow.to);
const from = computed<string>({
  get: () => parseYmd(fromParam.value) ?? defaultWindow.from,
  set: (v) => (fromParam.value = v),
});
const to = computed<string>({
  get: () => parseYmd(toParam.value) ?? defaultWindow.to,
  set: (v) => (toParam.value = v),
});
const page = qs.page();
watch([from, to], () => (page.value = 1));
// The window is the page's only filter, and it never empties: the last full month is where it opens,
// so only a window moved off that counts, and clearing puts it back there.
const activeFilterCount = computed(() => (from.value !== defaultWindow.from || to.value !== defaultWindow.to ? 1 : 0));
function resetFilters() {
  qs.set({ from: undefined, to: undefined });
}

const filter = computed(() => ({ from: from.value, to: to.value, page: page.value }));
const { data, isLoading, isError, refetch, isFetching } = useMaintenanceSpendQuery(filter);

const entries = computed(() => data.value?.entries ?? []);
const total = computed(() => data.value?.total ?? 0);
const pending = computed(() => data.value?.pendingSources ?? null);
/**
 * SP5 (plan §4b): the link asks the fleet report's own gate — `accounting` view AND the person's
 * Fleet report screen — through the guard's function, rather than restating the section half of it
 * as `canView("accounting")` did, which a per-person "off" on the Fleet report never reached.
 */
const opens = useOpens();
const canReadFinance = computed(() => opens("/fleet-report"));

const fmtUsd = (n: number | string) => Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const columns: DataTableColumn[] = [
  { key: "occurred_at", label: "Date", cellClass: "text-ink-secondary" },
  { key: "amount", label: "Amount", numeric: true },
  { key: "external_id", label: "Reference", cellClass: "font-mono text-xs text-ink-secondary" },
  { key: "source", label: "Source", cellClass: "text-ink-tertiary" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What the books show was paid for repairs and the shop, line by line.">
      <template v-if="canReadFinance" #actions>
        <RouterLink to="/fleet-report" class="text-sm font-medium text-link hover:text-link-hover">
          Maintenance and tires on the fleet report →
        </RouterLink>
      </template>
    </PageHeader>

    <DataWorkspace>
      <FilterBar embedded :count="total" count-label="entries" :active-count="activeFilterCount" @clear-all="resetFilters">
        <template #filters>
          <DateRangeFilter :from="from" :to="to" @update:from="(v) => (from = v ?? from)" @update:to="(v) => (to = v ?? to)" />
        </template>
      </FilterBar>

      <DataTable
        :columns="columns"
        :rows="entries"
        embedded
        row-key="id"
        :loading="isLoading"
        :error="isError ? 'Could not load the maintenance spend.' : null"
        :retrying="isFetching"
        @retry="refetch"
      >
        <template #empty>
          <p>{{ pending ?? "No maintenance spend in this window. Try an earlier month — the lines arrive with the McLeod sweep." }}</p>
        </template>
        <template #cell-occurred_at="{ value }">{{ fmtDate(value) }}</template>
        <template #cell-amount="{ value }"><span class="font-semibold">{{ fmtUsd(value) }}</span></template>
        <template #footer>
          <TablePagination :page="page" :page-size="50" :total="total" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
