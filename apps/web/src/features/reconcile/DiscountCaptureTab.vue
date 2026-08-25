<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@fuelguard/ui";
import { analyzeDiscountCapture, weeklyDiscountCapture, type SpendLine } from "@fuelguard/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { downloadCsv } from "@/lib/csv";
import { usd, usd3, gal, pct1 } from "./format";

/**
 * Fills that did not get the discount the rest of the week's fills got (plan §4.2).
 *
 * The benchmark is the period's own MEDIAN, not a contract rate, because the deal moves with the
 * market — capture ran $0.81/gal when diesel bottomed and $0.53 when it peaked. A fixed benchmark
 * invents loss in a falling market and hides it in a rising one. The copy says so on the card, because
 * a number labelled "lost" that nobody can explain gets ignored.
 */
const props = defineProps<{ lines: SpendLine[] }>();

/**
 * How much of the period we can actually SEE the posted price for.
 *
 * `analyzeDiscountCapture` drops fills with no retail rather than scoring them as having captured
 * nothing — the right call, and it means the figures below describe a subset. Saying which subset is
 * the difference between a measurement and a guess: a day nobody uploaded a price report for looks
 * exactly like a day the fleet bought no fuel, and only this line tells them apart.
 */
const coverage = computed(() => {
  const tractor = props.lines.filter((l) => l.product === "diesel" && l.tank !== "reefer" && l.gallons > 0);
  const priced = tractor.filter((l) => l.retailAmount != null);
  const gal = tractor.reduce((a, l) => a + l.gallons, 0);
  const pricedGal = priced.reduce((a, l) => a + l.gallons, 0);
  return {
    fills: tractor.length,
    priced: priced.length,
    share: gal > 0 ? pricedGal / gal : null,
    missing: tractor.length - priced.length,
  };
});

const capture = computed(() => analyzeDiscountCapture(props.lines));
const weekly = computed(() => weeklyDiscountCapture(props.lines));

const bandRows = computed(() =>
  capture.value.bands.map((b) => ({ id: b.key, band: b.label, lines: b.lines, gallons: gal(b.gallons), spend: usd(b.spend), shortfall: usd(b.shortfall) })),
);
const bandCols: DataTableColumn[] = [
  { key: "band", label: "Captured discount", width: "md" },
  { key: "lines", label: "Fills", numeric: true, width: "xs" },
  { key: "gallons", label: "Gallons", numeric: true, width: "sm" },
  { key: "spend", label: "Spend", numeric: true, width: "sm" },
  { key: "shortfall", label: "Below benchmark", numeric: true, width: "md" },
];

const siteRows = computed(() =>
  capture.value.bySite.slice(0, 25).map((r, i) => ({
    id: `${i}-${r.key}`, site: r.key, lines: r.lines, gallons: gal(r.gallons),
    perGal: usd3(r.discountPerGal), shortfall: usd(r.shortfall),
  })),
);
const siteCols: DataTableColumn[] = [
  { key: "site", label: "Site", width: "xl" },
  { key: "lines", label: "Fills", numeric: true, width: "xs" },
  { key: "gallons", label: "Gallons", numeric: true, width: "sm" },
  { key: "perGal", label: "Discount / gal", numeric: true, width: "sm" },
  { key: "shortfall", label: "Below benchmark", numeric: true, width: "md" },
];

function exportLines() {
  downloadCsv(
    "fuel-discount-capture",
    ["Date", "Site", "City", "State", "Brand", "Unit", "Gallons", "Paid", "Posted", "Discount $/gal", "Benchmark $/gal", "Below benchmark $"],
    capture.value.lines.map((c) => [
      c.line.tranDate, c.line.site, c.line.city, c.line.state, c.line.brand, c.line.unit,
      c.line.gallons.toFixed(1), c.line.netAmount?.toFixed(2), c.line.retailAmount?.toFixed(2),
      c.discountPerGal.toFixed(4), c.benchmarkPerGal.toFixed(4), c.shortfall.toFixed(2),
    ]),
  );
}
</script>

<template>
  <div class="space-y-6">
    <p
      v-if="coverage.missing > 0"
      class="rounded-surface bg-caution-50 px-4 py-2.5 text-xs text-caution-800 ring-1 ring-caution-100"
    >
      Measured on {{ coverage.priced.toLocaleString() }} of {{ coverage.fills.toLocaleString() }} fills —
      {{ pct1(coverage.share) }} of the gallons. The other {{ coverage.missing.toLocaleString() }} were bought at a
      station with no price report for that day, so what they should have cost is unknown; they are left out rather
      than counted as having captured no discount. Uploading more daily reports closes the gap.
    </p>

    <BaseCard>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-sm font-semibold text-ink">Discount capture</h3>
          <p class="mt-1 max-w-2xl text-sm text-ink-muted">
            Every fill scored against the benchmark for this period —
            <span class="font-medium text-ink-secondary">{{ usd3(capture.benchmarkPerGal) }} a gallon</span>, the median
            of these fills. The benchmark moves with the period on purpose: the deal tracks the market, so a fixed
            target would invent losses in a falling market and hide them in a rising one.
          </p>
        </div>
        <div class="text-right">
          <p class="text-2xl font-bold text-danger-700">{{ usd(capture.totalShortfall) }}</p>
          <p class="text-xs text-ink-muted">below benchmark</p>
        </div>
      </div>
      <p v-if="capture.zeroDiscount.length" class="mt-3 rounded-surface bg-caution-50 px-3 py-2 text-sm text-caution-800 ring-1 ring-caution-100">
        {{ capture.zeroDiscount.length }} fill{{ capture.zeroDiscount.length === 1 ? "" : "s" }} captured no discount at
        all — {{ usd(capture.zeroDiscount.reduce((a, c) => a + (c.line.netAmount ?? 0), 0)) }} of fuel at the posted price.
      </p>
    </BaseCard>

    <BaseCard padding="none">
      <DataTable :columns="bandCols" :rows="bandRows" empty-text="No fills with a posted price to compare." />
    </BaseCard>

    <div>
      <div class="mb-2 flex items-center justify-between">
        <h4 class="text-sm font-semibold text-ink">Worst sites</h4>
        <BaseButton variant="ghost" @click="exportLines">Download every fill (CSV)</BaseButton>
      </div>
      <BaseCard padding="none">
        <DataTable :columns="siteCols" :rows="siteRows" empty-text="Nothing below the benchmark." />
      </BaseCard>
    </div>

    <BaseCard v-if="weekly.length > 1" padding="sm">
      <h4 class="text-sm font-semibold text-ink">By week</h4>
      <ul class="mt-2 space-y-1 text-sm">
        <li v-for="w in weekly" :key="w.week" class="flex flex-wrap items-baseline gap-x-4 text-ink-secondary">
          <span class="font-medium text-ink">{{ w.week }}</span>
          <span>benchmark {{ usd3(w.benchmarkPerGal) }}</span>
          <span>{{ usd(w.shortfall) }} below it</span>
          <span v-if="w.zeroDiscountLines" class="text-caution-800">{{ w.zeroDiscountLines }} with no discount</span>
        </li>
      </ul>
    </BaseCard>
  </div>
</template>
