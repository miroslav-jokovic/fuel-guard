<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMaintenanceSpendQuery } from "@/features/maintenance/useMaintenanceSpend";
import { lastFullMonth } from "@/lib/dateWindow";
import { useSessionStore } from "@/stores/session";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";

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
const session = useSessionStore();
const defaultWindow = lastFullMonth();
const from = ref<string>(defaultWindow.from);
const to = ref<string>(defaultWindow.to);
const page = ref(1);
watch([from, to], () => (page.value = 1));

const filter = computed(() => ({ from: from.value, to: to.value, page: page.value }));
const { data, isLoading, isError, error, refetch, isFetching } = useMaintenanceSpendQuery(filter);

const entries = computed(() => data.value?.entries ?? []);
const total = computed(() => data.value?.total ?? 0);
const pending = computed(() => data.value?.pendingSources ?? null);
const canReadFinance = computed(() => session.canView("accounting"));

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
    <PageHeader description="What the ledger booked against repairs and the shop, line by line. Annual inspections and inspectors have their own pages under Maintenance.">
      <template v-if="canReadFinance" #actions>
        <RouterLink to="/fleet-report" class="text-sm font-medium text-link hover:text-link-hover">
          Maintenance and tires on the fleet report →
        </RouterLink>
      </template>
    </PageHeader>

    <DataWorkspace>
      <FilterBar embedded :count="total" count-label="entries">
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
        :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
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
