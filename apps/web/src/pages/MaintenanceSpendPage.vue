<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMaintenanceSpendQuery } from "@/features/maintenance/useMaintenanceSpend";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const from = ref<string>(ymd(new Date(Date.now() - 90 * 86_400_000)));
const to = ref<string>(ymd(new Date(Date.now() + 86_400_000)));
const page = ref(1);
watch([from, to], () => (page.value = 1));

const filter = computed(() => ({ from: from.value, to: to.value, page: page.value }));
const { data, isLoading, isError, error, refetch, isFetching } = useMaintenanceSpendQuery(filter);

const entries = computed(() => data.value?.entries ?? []);
const total = computed(() => data.value?.total ?? 0);
const pending = computed(() => data.value?.pendingSources ?? null);

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
    <PageHeader description="Repair and shop spend per the financial store. Work orders and FleetPal detail arrive as this section grows." />

    <FilterBar :count="total" count-label="entries">
      <template #filters>
        <DateRangeFilter :from="from" :to="to" @update:from="(v) => (from = v ?? from)" @update:to="(v) => (to = v ?? to)" />
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="entries"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
      :retrying="isFetching"
      @retry="refetch"
    >
      <template #empty>
        <p>{{ pending ?? "No maintenance spend in this window." }}</p>
      </template>
      <template #cell-occurred_at="{ value }">{{ fmtDate(value) }}</template>
      <template #cell-amount="{ value }"><span class="font-semibold">{{ fmtUsd(value) }}</span></template>
      <template #footer>
        <TablePagination :page="page" :page-size="50" :total="total" @update:page="page = $event" />
      </template>
    </DataTable>
  </div>
</template>
