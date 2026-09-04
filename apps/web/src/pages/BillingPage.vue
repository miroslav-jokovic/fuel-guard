<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useInvoicesQuery, INVOICES_PAGE_SIZE } from "@/features/billing/useInvoices";
import { trailingDays } from "@/lib/dateWindow";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import ExplainerPanel from "@/components/ui/ExplainerPanel.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";

/**
 * Invoices — the lookup page (R7 of the fleet report's UI plan, owner rulings Q1 and Q2 of
 * 2026-09-04). It was "Revenue & margin" with three tabs: invoices, a per-truck margin and the
 * dispatcher table. The dispatcher table moved onto the fleet report, where it reads on the
 * report's own month against the month's spent per mile (plan §2 Tab 3). The per-truck margin is
 * retired: it attributed ledger expenses to trucks, and no per-truck cost figure at this carrier is
 * precise (D-FLEET1). What is left is the one thing this page was always for — finding an invoice.
 *
 * A trailing window rather than the report's month, on purpose: a bill is looked up by when it was
 * raised, not by which month closed around it, and a lookup page may reach into the month in
 * progress. Inclusive dates, as the picker shows them; the query layer converts to the API's
 * exclusive bound.
 */
const defaultWindow = trailingDays(90);
const search = ref("");
const from = ref<string>(defaultWindow.from);
const to = ref<string>(defaultWindow.to);
const page = ref(1);
watch([search, from, to], () => (page.value = 1));

const filter = computed(() => ({ q: search.value, from: from.value, to: to.value, page: page.value }));
const { data, isLoading, isError, error, refetch, isFetching } = useInvoicesQuery(filter);
const entries = computed(() => data.value?.entries ?? []);
const total = computed(() => data.value?.total ?? 0);

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtUsd = (n: number | string) => Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const columns: DataTableColumn[] = [
  { key: "occurred_at", label: "Date", cellClass: "text-ink-secondary" },
  { key: "category", label: "Charge type" },
  { key: "dispatcher_name", label: "Dispatcher" },
  { key: "amount", label: "Amount", numeric: true },
  { key: "external_id", label: "Reference", cellClass: "font-mono text-xs text-ink-secondary" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every invoice the ledger has booked, by date, charge type and the dispatcher who booked it. Totals and rates are on the fleet report." />

    <ExplainerPanel summary="What counts as revenue here">
      <p>
        A load counts once the general ledger has booked it — the same rule the fleet report uses,
        so this list and the income statement agree. Loads that are staged but not yet booked are
        held out, never mixed in.
      </p>
      <p>
        Fuel and road tax collected on behalf of the government is excluded: money collected for
        someone else was never the carrier's earning.
      </p>
      <p>
        <span class="font-medium text-ink">Freight</span> is the charge for hauling the load itself
        (linehaul). <span class="font-medium text-ink">Extras</span> are the charges added to it —
        detention, layover, lumper and the rest (accessorial).
      </p>
    </ExplainerPanel>

    <DataWorkspace>
      <FilterBar v-model:search="search" embedded search-placeholder="Search by invoice reference…" :count="total" count-label="invoices">
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
          <p>No invoices in this date range. Try a wider range — invoices arrive with the McLeod sweep.</p>
        </template>
        <template #cell-occurred_at="{ value }">{{ fmtDate(value) }}</template>
        <template #cell-category="{ value }">
          <span
            :class="[BADGE_BASE, toneClass(value === 'accessorial_revenue' ? 'info' : 'success')]"
            :title="value === 'accessorial_revenue' ? 'Accessorial — a charge added to the haul: detention, layover, lumper and the like.' : 'Linehaul — the charge for hauling the load itself.'"
          >
            {{ value === "accessorial_revenue" ? "Extra" : "Freight" }}
          </span>
        </template>
        <!-- Blank means the bill's order carried no operations user, not that the sweep failed. -->
        <template #cell-dispatcher_name="{ value }">
          <span :class="value ? 'text-ink-secondary' : 'text-ink-tertiary'">{{ value ?? "Unassigned" }}</span>
        </template>
        <template #cell-amount="{ value }"><span class="font-semibold text-success-700">{{ fmtUsd(value) }}</span></template>
        <template #footer>
          <TablePagination :page="page" :page-size="INVOICES_PAGE_SIZE" :total="total" :loading="isFetching" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
