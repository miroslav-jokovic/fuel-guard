<script setup lang="ts">
import { computed, ref } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@fuelguard/ui";
import type { ExceptionReport } from "@fuelguard/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import StatCard from "@/components/ui/StatCard.vue";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
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
    // Raw values for sorting. The visible cells are formatted — "$1,234" and "123.4" sort as text,
    // which puts $9 above $1,234 and is the kind of wrong a reader trusts because it looks ordered.
    sortBy: {
      date: f.line.tranDate ?? "",
      site: [f.line.site, f.line.city, f.line.state].filter(Boolean).join(" "),
      brand: f.line.brand ?? "",
      unit: f.line.unit ?? "",
      gallons: f.line.gallons,
      perGal: f.netPerGal,
      premium: f.premiumPerGal,
      discount: f.discountPerGal,
      excess: f.excess,
    } as Record<string, unknown>,
  })),
);

/**
 * Newest first by default. An exception report is read for what happened lately; landing on the oldest
 * fill of a ninety-day window makes the reader sort before they can start.
 */
const sort = ref<SortState>({ key: "date", dir: "desc" });
const sortedRows = computed(() => sortRows(rows.value, sort.value, (r, k) => r.sortBy[k]));
const cols: DataTableColumn[] = [
  { key: "date", label: "Date", width: "sm", sortable: true, cellClass: "text-ink-secondary" },
  { key: "site", label: "Site", width: "xl", sortable: true, cellClass: "text-ink-secondary" },
  { key: "brand", label: "Network", width: "sm", sortable: true, cellClass: "text-ink-secondary" },
  { key: "unit", label: "Unit", width: "xs", sortable: true, cellClass: "text-ink-secondary" },
  { key: "gallons", label: "Gallons", numeric: true, width: "sm", sortable: true },
  { key: "perGal", label: "Paid / gal", numeric: true, width: "sm", sortable: true },
  { key: "premium", label: "vs fleet", numeric: true, width: "sm", sortable: true },
  { key: "discount", label: "Discount / gal", numeric: true, width: "sm", sortable: true },
  { key: "excess", label: "Excess", numeric: true, width: "sm", sortable: true },
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

      <p class="mt-3 text-xs text-ink-tertiary">
        Compared against {{ usd3(report.baselinePerGal) }} a gallon — what the fleet's other fuel cost over the same
        period, these fills excluded.
      </p>
      <p v-if="note" class="mt-2 text-sm text-ink-secondary">{{ note }}</p>
    </BaseCard>

    <!-- The same KPI anatomy as the trend tab (D-UI2). These were a hand-rolled <dl>, which is why the
         tabs did not look like one page. -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="Fills" :value="report.lines.toLocaleString()" />
      <StatCard label="Gallons" :value="gal(report.gallons)" :sub="`${pct1(report.gallonShare)} of fuel`" />
      <StatCard label="Paid" :value="usd(report.spend)" :sub="`at ${usd3(report.netPerGal)}/gal`" />
      <StatCard
        label="Discount captured"
        :value="`${usd3(report.discountPerGal)}/gal`"
        :sub="(report.discountPerGal ?? 0) < 0.005 ? 'none captured at all' : 'per gallon'"
        :sub-tone="(report.discountPerGal ?? 0) < 0.005 ? 'text-danger-700' : undefined"
      />
    </div>

    <div>
      <div class="mb-2 flex items-center justify-between">
        <h4 class="text-sm font-semibold text-ink">Every fill</h4>
        <BaseButton v-if="report.fills.length" variant="ghost" @click="exportRows">Download (CSV)</BaseButton>
      </div>
      <BaseCard padding="none">
        <DataTable
          :columns="cols"
          :rows="sortedRows"
          :sort="sort"
          empty-text="Nothing to report — the policy held for this period."
          @sort="sort = toggleSort(sort, $event)"
        />
      </BaseCard>
    </div>
  </div>
</template>
