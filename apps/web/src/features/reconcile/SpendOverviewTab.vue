<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { totalsOf, weeklySpendSeries, isTractorFuel, type SpendLine } from "@fuelguard/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import SpendBridgeCard from "./SpendBridgeCard.vue";
import AncillaryCard from "./AncillaryCard.vue";
import { usd, usd3, gal, pct1 } from "./format";

/** What this period cost, and the week-by-week series the bridge is drawn from (plan §4.1). */
const props = defineProps<{ lines: SpendLine[] }>();

const totals = computed(() => totalsOf(props.lines.filter(isTractorFuel)));
const series = computed(() => weeklySpendSeries(props.lines));

const rows = computed(() =>
  [...series.value].reverse().map((w) => ({
    id: w.week, week: w.week, fills: w.lines, gallons: gal(w.gallons), spend: usd(w.net),
    perGal: usd3(w.netPerGal), posted: usd3(w.retailPerGal), discount: usd3(w.discountPerGal), capture: pct1(w.capturePct),
  })),
);
const cols: DataTableColumn[] = [
  { key: "week", label: "Week of", width: "sm" },
  { key: "fills", label: "Fills", numeric: true, width: "xs" },
  { key: "gallons", label: "Gallons", numeric: true, width: "sm" },
  { key: "spend", label: "Fuel spend", numeric: true, width: "sm" },
  { key: "perGal", label: "Paid / gal", numeric: true, width: "sm" },
  { key: "posted", label: "Posted / gal", numeric: true, width: "sm" },
  { key: "discount", label: "Discount / gal", numeric: true, width: "sm" },
  { key: "capture", label: "Capture", numeric: true, width: "xs" },
];
</script>

<template>
  <div class="space-y-6">
    <dl class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <BaseCard
v-for="t in [
        { label: 'Gallons', value: gal(totals.gallons), hint: `${totals.lines.toLocaleString()} tractor fills` },
        { label: 'Fuel spend', value: usd(totals.net), hint: 'fuel only, before tax and in-store' },
        { label: 'Paid per gallon', value: usd3(totals.netPerGal), hint: `posted ${usd3(totals.retailPerGal)}` },
        { label: 'Discount captured', value: usd3(totals.discountPerGal), hint: `${pct1(totals.capturePct)} of posted` },
        { label: 'Saved vs posted', value: usd(totals.discount), hint: 'what the deal was worth' },
      ]" :key="t.label" padding="sm">
        <dt class="text-xs uppercase tracking-wide text-ink-muted">{{ t.label }}</dt>
        <dd class="mt-1 text-2xl font-bold text-ink">{{ t.value }}</dd>
        <dd class="text-2xs text-ink-tertiary">{{ t.hint }}</dd>
      </BaseCard>
    </dl>

    <SpendBridgeCard :lines="lines" />

    <div>
      <h4 class="mb-2 text-sm font-semibold text-ink">Week by week</h4>
      <BaseCard padding="none">
        <DataTable :columns="cols" :rows="rows" empty-text="No statement weeks in this period." />
      </BaseCard>
    </div>

    <AncillaryCard :lines="lines" />
  </div>
</template>
