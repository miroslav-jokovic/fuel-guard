<script setup lang="ts">
import { computed, ref } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@silvicom/ui";
import type { ExceptionReport } from "@silvicom/shared";
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
 * "Discount captured", stated with its scope — or refused when there is no scope to state.
 *
 * ── THREE OUTCOMES, AND TWO OF THEM USED TO LOOK IDENTICAL ──────────────────────────────────────
 * These reports select fills that went off the preferred network, and an off-network site is exactly
 * the site the Pilot price report does not cover — so "no posted price for any of these fills" is the
 * ORDINARY case here. Divided by every gallon it resolved to `−netPerGal`, and this tile printed
 * "-$7.007/gal · none captured at all" in red: a confident accusation assembled entirely out of
 * missing data. "We captured nothing" and "we cannot tell" are opposite findings.
 *
 * When only some fills carry a posted price the figure is real but partial, so the share it covers is
 * printed beside it rather than left for the reader to assume is 100%.
 */
const discountTile = computed(() => {
  const perGal = props.report.discountPerGal;
  const share = props.report.discountMeasuredShare;
  if (perGal == null || share == null || share === 0) {
    return {
      value: "—",
      sub: "no posted price for these fills",
      tone: undefined as string | undefined,
    };
  }
  const scope = share < 0.995 ? `over ${pct1(share)} of these gallons` : "per gallon";
  return perGal < 0.005
    ? { value: `${usd3(perGal)}/gal`, sub: `none captured at all · ${scope}`, tone: "text-danger-700" }
    : { value: `${usd3(perGal)}/gal`, sub: scope, tone: undefined as string | undefined };
});

/**
 * How much of the excess above is a jurisdiction's tax rate rather than a purchasing decision (F10).
 *
 * ── WHY THIS SENTENCE EXISTS ────────────────────────────────────────────────────────────────────
 * The premium on this tab is a PUMP-price premium, and on the avoided-state report a large part of it
 * is the state's own fuel tax: California levies $0.979/gal against a $0.334 fleet-wide average.
 * Under IFTA that tax follows the miles BURNED in a state, not the gallons bought there, so a truck
 * that crossed California on fuel from Nevada would still owe most of it. Measured on production over
 * the default window, 41% of the $19,858 California premium is exactly that. Reporting the whole
 * figure as though a dispatcher could have avoided it is the same error as the verdict band that
 * added three overlapping reports together — arithmetically right, pointed at the wrong person.
 *
 * The three figures come from `analyzePolicyExceptions` and are measured over ONE set of gallons, so
 * they add up; the share that set covers is stated because it is never all of them (Oregon taxes by
 * the mile, and the table stops where the quarterly capture stopped).
 */
const taxLine = computed(() => {
  const s = props.report.taxSplit;
  if (!s || s.taxPremiumPerGal == null || s.preTaxPremiumPerGal == null || s.measuredGallons === 0) return null;
  const scope =
    `Purchase-state tax at the pump — not net of IFTA — from the ${s.versions.join(" and ")} IFTA matrix, ` +
    `measured over ${pct1(s.measuredShare)} of these gallons.` +
    (s.provisional ? " The current quarter's matrix is not final until IFTA publishes it." : "");
  // A NEGATIVE tax premium is the ordinary case for the off-network report — those fills are wherever
  // the truck happened to be, which averages out lower than a report selecting one expensive state.
  // Printed as "none of it" rather than as a negative dollar figure under the word "tax", which is
  // the shape of defect B3 was.
  if (s.taxPremiumPerGal <= 0) {
    return {
      lead: `State fuel tax accounts for none of this premium — these fills carry ${usd3(s.taxPerGal)} a gallon of tax against ${usd3(s.baselineTaxPerGal)} on the rest of the fleet's fuel, so all of the gap is the price of the fuel itself.`,
      scope,
    };
  }
  return {
    lead:
      `${usd(s.taxExcess)} of that excess is state fuel tax — ${usd3(s.taxPerGal)} a gallon here against ` +
      `${usd3(s.baselineTaxPerGal)} elsewhere — which is owed on the miles driven there whichever state the fuel ` +
      `was bought in. The other ${usd3(s.preTaxPremiumPerGal)} a gallon is the price of the fuel itself, and is ` +
      `the only part a different stop could have changed.`,
    scope,
  };
});

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

/**
 * N7 — the rollups `ExceptionReport` has always computed and no surface displayed.
 *
 * Fuel behaviour is a per-driver habit rather than a per-fill accident: the plan's §2.3 records unit
 * 754 hitting ONE9 three times in two days. A flat list of fills cannot show that, and coaching one
 * driver is the cheapest intervention available on this whole page. `byUnit` and `bySite` were sitting
 * in the object the tab already receives.
 */
const TOP = 8;
const unitRows = computed(() =>
  props.report.byUnit.filter((g) => g.excess > 0).slice(0, TOP).map((g) => ({
    id: g.key, unit: g.key, fills: g.lines, gallons: gal(g.gallons), spend: usd(g.spend),
    perGal: usd3(g.netPerGal), excess: usd(g.excess),
  })),
);
const siteRows = computed(() =>
  props.report.bySite.filter((g) => g.excess > 0).slice(0, TOP).map((g) => ({
    id: g.key, unit: g.key, fills: g.lines, gallons: gal(g.gallons), spend: usd(g.spend),
    perGal: usd3(g.netPerGal), excess: usd(g.excess),
  })),
);
const groupCols = (first: string): DataTableColumn[] => [
  { key: "unit", label: first, width: "xl", cellClass: "text-ink-secondary" },
  { key: "fills", label: "Fills", numeric: true, width: "xs" },
  { key: "gallons", label: "Gallons", numeric: true, width: "sm" },
  { key: "spend", label: "Paid", numeric: true, width: "sm" },
  { key: "perGal", label: "Paid / gal", numeric: true, width: "sm" },
  { key: "excess", label: "Excess", numeric: true, width: "sm" },
];
const unitCols = groupCols("Unit");
const siteCols = groupCols("Site");

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
      <!-- The three exception tabs select OVERLAPPING populations: a ONE9 fill in an avoided state is
           off-brand, in that state, and off the preferred network, and carries its full excess on all
           three. Adding the tabs is the first thing a reader does with three dollar figures on three
           adjacent tabs, and it triples that fill. -->
      <p class="mt-2 text-xs text-ink-tertiary">
        This figure overlaps the other exception tabs — one fill can break more than one rule and is
        counted on each — so they must not be added together.
      </p>
      <!-- F10. The premium above is a pump-price premium and part of it is the jurisdiction's own tax
           rate, which follows the miles burned there rather than the gallons bought there. Splitting
           it is the difference between "somebody fuelled badly" and "that state charges more", and
           only the second half of the split is something a different stop could have changed. -->
      <div v-if="taxLine" class="mt-3 rounded-surface bg-surface-subtle px-3 py-2.5">
        <p class="text-sm text-ink-secondary">{{ taxLine.lead }}</p>
        <p class="mt-1 text-xs text-ink-tertiary">{{ taxLine.scope }}</p>
      </div>
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
        :value="discountTile.value"
        :sub="discountTile.sub"
        :sub-tone="discountTile.tone"
      />
    </div>

    <div v-if="unitRows.length" class="grid gap-6 lg:grid-cols-2">
      <div>
        <h4 class="mb-2 text-sm font-semibold text-ink">Which trucks</h4>
        <BaseCard padding="none">
          <DataTable :columns="unitCols" :rows="unitRows" row-key="id" empty-text="No truck stands out." />
        </BaseCard>
      </div>
      <div v-if="siteRows.length">
        <h4 class="mb-2 text-sm font-semibold text-ink">Which sites</h4>
        <BaseCard padding="none">
          <DataTable :columns="siteCols" :rows="siteRows" row-key="id" empty-text="No site stands out." />
        </BaseCard>
      </div>
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
