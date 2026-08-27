<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useInvoicesQuery, useMarginByTruckQuery, INVOICES_PAGE_SIZE } from "@/features/billing/useInvoices";
import { useVehiclesQuery } from "@/composables/useVehicles";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const search = ref("");
const from = ref<string>(ymd(new Date(Date.now() - 90 * 86_400_000)));
const to = ref<string>(ymd(new Date(Date.now() + 86_400_000)));
const page = ref(1);
watch([search, from, to], () => (page.value = 1));

const filter = computed(() => ({ q: search.value, from: from.value, to: to.value, page: page.value }));
const { data, isLoading, isError, error, refetch, isFetching } = useInvoicesQuery(filter);
const { data: margins } = useMarginByTruckQuery(from, to);
const { data: vehicles } = useVehiclesQuery();

const entries = computed(() => data.value?.entries ?? []);
const total = computed(() => data.value?.total ?? 0);
const unitById = computed(() => new Map((vehicles.value ?? []).map((v) => [v.id, v.unit_number])));

// Margin per truck, the unattributed bucket shown as its own honest row — never spread by a guess.
const marginRows = computed(() =>
  (margins.value ?? []).map((m) => ({
    ...m,
    key: m.vehicleId ?? "(unattributed)",
    unit: m.vehicleId ? (unitById.value.get(m.vehicleId) ?? m.vehicleId.slice(0, 8)) : "Unattributed",
  })),
);

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtUsd = (n: number | string) => Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const invoiceColumns: DataTableColumn[] = [
  { key: "occurred_at", label: "Billed", cellClass: "text-ink-secondary" },
  { key: "category", label: "Kind" },
  { key: "amount", label: "Amount", numeric: true },
  { key: "external_id", label: "Reference", cellClass: "font-mono text-xs text-ink-secondary" },
];
const marginColumns: DataTableColumn[] = [
  { key: "unit", label: "Truck", cellClass: "font-medium text-ink" },
  { key: "earnings", label: "Earnings", numeric: true },
  { key: "expenses", label: "Expenses", numeric: true },
  { key: "margin", label: "Margin", numeric: true },
  { key: "entries", label: "Entries", numeric: true, cellClass: "text-ink-tertiary" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Invoiced revenue and margin per truck — the earnings side of the ledger, on the same terms as cost." />

    <FilterBar v-model:search="search" search-placeholder="Search by invoice reference…" :count="total" count-label="invoices">
      <template #filters>
        <DateRangeFilter :from="from" :to="to" @update:from="(v) => (from = v ?? from)" @update:to="(v) => (to = v ?? to)" />
      </template>
    </FilterBar>

    <DataTable
      :columns="invoiceColumns"
      :rows="entries"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
      :retrying="isFetching"
      @retry="refetch"
    >
      <template #empty>
        <p>No invoiced revenue in the store yet. Billing rows arrive once the McLeod billing sweep runs — its column mapping is waiting on the F1/F2 recon answers.</p>
      </template>
      <template #cell-occurred_at="{ value }">{{ fmtDate(value) }}</template>
      <template #cell-category="{ value }">
        <span :class="[BADGE_BASE, toneClass(value === 'accessorial_revenue' ? 'info' : 'success')]">
          {{ value === "accessorial_revenue" ? "Accessorial" : "Linehaul" }}
        </span>
      </template>
      <template #cell-amount="{ value }"><span class="font-semibold text-success-700">{{ fmtUsd(value) }}</span></template>
      <template #footer>
        <TablePagination :page="page" :page-size="INVOICES_PAGE_SIZE" :total="total" @update:page="page = $event" />
      </template>
    </DataTable>

    <BaseCard v-if="marginRows.length" padding="none">
      <h3 class="px-4 pt-4 pb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">Margin per truck · earnings − expenses over the window</h3>
      <DataTable :columns="marginColumns" :rows="marginRows" row-key="key" :loading="false" :error="null">
        <template #cell-earnings="{ value }">{{ fmtUsd(value) }}</template>
        <template #cell-expenses="{ value }">{{ fmtUsd(value) }}</template>
        <template #cell-margin="{ value }">
          <span class="font-semibold" :class="value >= 0 ? 'text-success-700' : 'text-danger-700'">{{ fmtUsd(value) }}</span>
        </template>
      </DataTable>
    </BaseCard>
  </div>
</template>
