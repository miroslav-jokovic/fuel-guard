<script setup lang="ts">
import { computed } from "vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { monthName } from "./fleetProvenance";
import type { FleetTrendPoint } from "./useFleetTrend";

/**
 * Month by month (R5, D-FRUI4): the trend's points as rows — what each month earned, spent and
 * kept, how far the fleet ran, how many trucks, the three rates, and the empty share — with the
 * month on screen highlighted. The plan's §1.2 table, which the owner read before the page
 * existed, is this table.
 *
 * Nothing is computed here. Every figure is `computeFleetTrend`'s; a null rate prints a dash with
 * its reason as the hover (D-FIN10), never $0.00, and a month the sweep has not reached is not a
 * row at all — the chart names it. Kept carries an inline bar scaled to the largest month in the
 * span, so the shape of the year reads before the digits do. This is the Overview's one table
 * (owner ruling 2026-08-29): the bridge and the miles card above it are lists.
 */

const props = defineProps<{
  points: FleetTrendPoint[];
  /** The month on screen, `YYYY-MM`. */
  current: string;
}>();

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtRate = (n: number | null) =>
  n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const fmtMiles = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString());
const fmtPct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);

interface Row extends FleetTrendPoint {
  id: string;
  label: string;
  isCurrent: boolean;
  /** Kept as a share of the largest |kept| in the span, for the inline bar. 0–100. */
  keptBar: number;
}

const rows = computed<Row[]>(() => {
  const widest = Math.max(1, ...props.points.map((p) => Math.abs(p.net)));
  return [...props.points]
    .sort((a, b) => (a.month > b.month ? -1 : a.month < b.month ? 1 : 0))
    .map((p) => ({
      ...p,
      id: p.month,
      label: monthName(p.month),
      isCurrent: p.month === props.current,
      keptBar: Math.round((Math.abs(p.net) / widest) * 100),
    }));
});

const columns: DataTableColumn[] = [
  { key: "label", label: "Month" },
  { key: "revenue", label: "Earned", numeric: true },
  { key: "expenses", label: "Spent", numeric: true },
  { key: "net", label: "Kept", numeric: true },
  { key: "miles", label: "Miles driven", numeric: true },
  { key: "trucks", label: "Trucks", numeric: true },
  { key: "revenuePerMile", label: "Earned / mi", numeric: true },
  { key: "costPerMile", label: "Spent / mi", numeric: true },
  { key: "netPerMile", label: "Kept / mi", numeric: true },
  { key: "emptyPct", label: "Empty", numeric: true },
];

const rowClass = (row: Row) => (row.isCurrent ? "bg-brand-50/60 font-semibold" : "");
</script>

<template>
  <DataTable :columns="columns" :rows="rows" row-key="id" dense embedded :sticky-header="false" :row-class="rowClass">
    <template #cell-label="{ row }">
      <span :class="row.isCurrent ? 'text-ink' : 'text-ink-secondary'">{{ row.label }}</span>
    </template>
    <template #cell-revenue="{ value }">{{ fmtUsd(value) }}</template>
    <template #cell-expenses="{ value }">{{ fmtUsd(value) }}</template>
    <template #cell-net="{ row }">
      <span class="inline-flex items-center justify-end gap-2">
        <!-- The bar reads the shape; the figure beside it is the number. A loss draws in the spend
             hue, to the same scale. -->
        <span class="inline-block h-2 w-14 overflow-hidden rounded-detail" aria-hidden="true">
          <span
            :class="['ml-auto block h-full rounded-detail', row.net < 0 ? 'bg-caution-500/70' : 'bg-success-500/70']"
            :style="{ width: `${row.keptBar}%` }"
          />
        </span>
        <span :class="row.net < 0 ? 'text-danger-700' : ''">{{ fmtUsd(row.net) }}</span>
      </span>
    </template>
    <template #cell-miles="{ value, row }">
      <span v-if="value == null" class="text-ink-tertiary" :title="row.reason ?? undefined">—</span>
      <template v-else>{{ fmtMiles(value) }}</template>
    </template>
    <template #cell-trucks="{ value }"><span :class="value == null ? 'text-ink-tertiary' : ''">{{ value == null ? "—" : value }}</span></template>
    <template #cell-revenuePerMile="{ value, row }"><span :class="value == null ? 'text-ink-tertiary' : ''" :title="value == null ? (row.reason ?? undefined) : undefined">{{ fmtRate(value) }}</span></template>
    <template #cell-costPerMile="{ value, row }"><span :class="value == null ? 'text-ink-tertiary' : ''" :title="value == null ? (row.reason ?? undefined) : undefined">{{ fmtRate(value) }}</span></template>
    <template #cell-netPerMile="{ value, row }"><span :class="value == null ? 'text-ink-tertiary' : ''" :title="value == null ? (row.reason ?? undefined) : undefined">{{ fmtRate(value) }}</span></template>
    <template #cell-emptyPct="{ value, row }"><span :class="value == null ? 'text-ink-tertiary' : ''" :title="value == null ? (row.reason ?? undefined) : 'Miles driven that no load was priced on, as a share of miles driven'">{{ fmtPct(value) }}</span></template>
  </DataTable>
</template>
