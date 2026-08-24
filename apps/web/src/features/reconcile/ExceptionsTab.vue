<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@fuelguard/ui";
import type { ExceptionReport } from "@fuelguard/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { downloadCsv } from "@/lib/csv";
import { usd, usd3, gal, pct1 } from "./format";

/**
 * One policy exception, priced (plan §4.3–4.5). Used for the avoid-brand, avoid-state and off-network
 * reports, which differ only in what they select — the question and the arithmetic are identical.
 *
 * "Excess" is measured against what the fleet's OTHER fuel cost over the same period, never a fixed
 * price, and the baseline excludes these fills so a large exception cannot shrink its own measured
 * cost. The baseline is printed so nobody has to take the excess figure on trust.
 */
const props = defineProps<{
  title: string;
  blurb: string;
  report: ExceptionReport;
  /** Filename stem for the CSV. */
  slug: string;
  /** Extra line under the tiles, e.g. the fill-size discipline note for California. */
  note?: string | null;
}>();

const rows = computed(() =>
  props.report.fills.map((f, i) => ({
    id: `${i}`,
    date: f.line.tranDate ?? "—",
    site: [f.line.site, f.line.city, f.line.state].filter(Boolean).join(" ") || "—",
    brand: f.line.brand ?? "unidentified",
    unit: f.line.unit ?? "—",
    gallons: f.line.gallons.toFixed(1),
    perGal: usd3(f.netPerGal),
    premium: usd3(f.premiumPerGal),
    discount: f.discountPerGal == null ? "—" : usd3(f.discountPerGal),
    excess: usd(f.excess),
  })),
);
const cols: DataTableColumn[] = [
  { key: "date", label: "Date", width: "sm", cellClass: "text-ink-secondary" },
  { key: "site", label: "Site", width: "xl", cellClass: "text-ink-secondary" },
  { key: "brand", label: "Network", width: "sm", cellClass: "text-ink-secondary" },
  { key: "unit", label: "Unit", width: "xs", cellClass: "text-ink-secondary" },
  { key: "gallons", label: "Gallons", numeric: true, width: "sm" },
  { key: "perGal", label: "Paid / gal", numeric: true, width: "sm" },
  { key: "premium", label: "vs fleet", numeric: true, width: "sm" },
  { key: "discount", label: "Discount / gal", numeric: true, width: "sm" },
  { key: "excess", label: "Excess", numeric: true, width: "sm" },
];

function exportRows() {
  downloadCsv(
    `fuel-${props.slug}`,
    ["Date", "Site", "City", "State", "Network", "Unit", "Driver", "Gallons", "Paid", "Paid $/gal", "vs fleet $/gal", "Discount $/gal", "Excess $"],
    props.report.fills.map((f) => [
      f.line.tranDate, f.line.site, f.line.city, f.line.state, f.line.brand ?? "unidentified", f.line.unit, f.line.driver,
      f.line.gallons.toFixed(1), f.line.netAmount?.toFixed(2), f.netPerGal.toFixed(4),
      f.premiumPerGal.toFixed(4), f.discountPerGal?.toFixed(4), f.excess.toFixed(2),
    ]),
  );
}
</script>

<template>
  <div class="space-y-6">
    <BaseCard>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-sm font-semibold text-ink">{{ title }}</h3>
          <p class="mt-1 max-w-2xl text-sm text-ink-muted">{{ blurb }}</p>
        </div>
        <div class="text-right">
          <p class="text-2xl font-bold" :class="report.excess > 0 ? 'text-danger-700' : 'text-ink'">{{ usd(report.excess) }}</p>
          <p class="text-xs text-ink-muted">above the rest of the fleet</p>
        </div>
      </div>

      <dl class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><dt class="text-xs text-ink-muted">Fills</dt><dd class="text-sm font-medium text-ink">{{ report.lines.toLocaleString() }}</dd></div>
        <div><dt class="text-xs text-ink-muted">Gallons</dt><dd class="text-sm font-medium text-ink">{{ gal(report.gallons) }} <span class="text-xs font-normal text-ink-tertiary">({{ pct1(report.gallonShare) }} of fuel)</span></dd></div>
        <div><dt class="text-xs text-ink-muted">Paid</dt><dd class="text-sm font-medium text-ink">{{ usd(report.spend) }} <span class="text-xs font-normal text-ink-tertiary">at {{ usd3(report.netPerGal) }}/gal</span></dd></div>
        <div><dt class="text-xs text-ink-muted">Discount captured</dt><dd class="text-sm font-medium" :class="(report.discountPerGal ?? 0) < 0.005 ? 'text-danger-700' : 'text-ink'">{{ usd3(report.discountPerGal) }}/gal</dd></div>
      </dl>

      <p class="mt-3 text-xs text-ink-tertiary">
        Compared against {{ usd3(report.baselinePerGal) }} a gallon — what the fleet's other fuel cost over the same
        period, these fills excluded.
      </p>
      <p v-if="note" class="mt-2 text-sm text-ink-secondary">{{ note }}</p>
    </BaseCard>

    <div>
      <div class="mb-2 flex items-center justify-between">
        <h4 class="text-sm font-semibold text-ink">Every fill</h4>
        <BaseButton v-if="report.fills.length" variant="ghost" @click="exportRows">Download (CSV)</BaseButton>
      </div>
      <BaseCard padding="none">
        <DataTable :columns="cols" :rows="rows" empty-text="Nothing to report — the policy held for this period." />
      </BaseCard>
    </div>
  </div>
</template>
