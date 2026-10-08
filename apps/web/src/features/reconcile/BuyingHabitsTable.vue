<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import { FUEL_EXCEPTION_KIND_LABELS, formatDisplayMonth, type BuyingHabitsTable } from "@silvicom/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { usd2 } from "./format";

/**
 * Buying habits on Fuel Costs (F02-F04 chunk 9a, Q-F2 ruled 2026-10-06): what was paid above the fleet's
 * own price by fuelling in an avoided state, at an avoided brand or off the network, one row per truck per
 * month with the drivers who fuelled it.
 *
 * They were findings in the fuel queue, 143 of 157 open on 2026-10-08, and none could be disputed: there
 * is no vendor to claim a habit back from. Here they are a cost to manage with the drivers, not a task to
 * close. The premium is filed per truck (Q-FUI3), so a driver has no amount of their own and the table
 * names drivers beside the truck rather than splitting money between them.
 */
const props = defineProps<{
  table: BuyingHabitsTable | undefined;
  loading: boolean;
  error: boolean;
}>();

const PAGE_SIZE = 20;
const page = ref(1);
watch(() => props.table, () => { page.value = 1; });

const columns: DataTableColumn[] = [
  { key: "month", label: "Month", width: "xs", cellClass: "text-ink-secondary" },
  { key: "unit", label: "Unit", width: "xs" },
  { key: "drivers", label: "Drivers", width: "md", cellClass: "text-ink-secondary" },
  { key: "state", label: FUEL_EXCEPTION_KIND_LABELS.avoided_state_premium, numeric: true, width: "sm" },
  { key: "network", label: FUEL_EXCEPTION_KIND_LABELS.off_network_premium, numeric: true, width: "sm" },
  { key: "brand", label: FUEL_EXCEPTION_KIND_LABELS.avoided_brand_premium, numeric: true, width: "sm" },
  { key: "total", label: "Total", numeric: true, width: "sm" },
];

// To the cent, like the stored amounts the accept is checked against. A zero is a dash: "nothing paid this way" reads at a glance, and a column of $0.00 hides the ones that matter.
const money = (n: number) => (n === 0 ? "—" : usd2(n));
const all = computed(() => props.table?.rows ?? []);
const shown = computed(() =>
  all.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE).map((r) => ({
    id: `${r.month}|${r.unit}`,
    month: formatDisplayMonth(r.month),
    unit: r.unit,
    drivers: r.drivers.length ? r.drivers.join(", ") : "Not on the fills",
    state: money(r.byKind.avoided_state_premium),
    network: money(r.byKind.off_network_premium),
    brand: money(r.byKind.avoided_brand_premium),
    total: usd2(r.total),
  })),
);
</script>

<template>
  <section class="space-y-2" aria-labelledby="buying-habits-heading">
    <div class="flex flex-wrap items-baseline justify-between gap-3">
      <h3 id="buying-habits-heading" class="text-base font-semibold text-ink">Buying habits</h3>
      <p v-if="table && !error" class="text-sm text-ink-secondary">
        <span class="font-semibold tabular-nums text-ink" data-testid="buying-habits-total">{{ usd2(table.total) }}</span>
        paid above the fleet's price in these months
      </p>
    </div>
    <p class="text-xs text-ink-tertiary">
      Fuel bought in an avoided state, at an avoided brand or off the network, per truck and month. Whole months are
      shown. There is no vendor to claim these back from, so they are not in Fuel problems.
    </p>
    <p v-if="error" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
      Couldn't load the buying habits. Reload to try again.
    </p>
    <BaseCard v-else padding="none">
      <DataTable :columns="columns" :rows="shown" row-key="id" :loading="loading" empty-text="No premiums paid in these months.">
        <template #cell-total="{ row }">
          <span class="font-medium tabular-nums text-ink">{{ row.total }}</span>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="all.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </BaseCard>
  </section>
</template>
