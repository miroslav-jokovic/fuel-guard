<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { AppCard as BaseCard, AppButton as BaseButton } from "@fuelguard/ui";
import { analyzeContractCapture, weeklyContractCapture, type SpendLine } from "@fuelguard/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { downloadCsv } from "@/lib/csv";
import { usd, usd3, gal, pct1 } from "./format";
import PriceCoverageStrip from "./PriceCoverageStrip.vue";

/**
 * Was every fill billed at the price Pilot contracted for it?
 *
 * ── WHY THIS TAB STOPPED USING A MEDIAN ──────────────────────────────────────────────────────────
 * It used to score each fill against the median discount of the fills around it, because that is all a
 * parsed vendor statement supports. The daily Pilot report has always carried something better —
 * "Your Price", the fleet's net per-gallon with the contract discount already applied, for all 683
 * sites — and since 0245 those are kept rather than deleted by the next upload. 0247 joins it onto
 * every fill, so the question became "did this fill cost what we were quoted" instead of "did this fill
 * do as well as our other fills".
 *
 * The difference is not cosmetic. A median measures the carrier against itself: a week where every
 * station billed uniformly over contract moves the median with it and reports nothing wrong. Measured
 * over 2026-08-02 → 2026-08-25, the contract found $177.76 across 19 fills that no median could have
 * surfaced, because $177.76 spread over 1,409 fills does not move one.
 *
 * ── WHAT IS NOT MEASURED IS SAID ─────────────────────────────────────────────────────────────────
 * A fill with no quote in range is UNMEASURED, never scored as billed correctly. Zero variance and no
 * measurement look identical in a total and mean opposite things, so they are reported apart.
 */
const props = defineProps<{ lines: SpendLine[]; from: string; to: string }>();
const emit = defineEmits<{ narrow: [from: string, to: string] }>();

const capture = computed(() => analyzeContractCapture(props.lines));
const weekly = computed(() => weeklyContractCapture(props.lines));

/** Every fill in scope, so the unmeasured share can be stated against a real denominator. */
const inScope = computed(
  () => props.lines.filter((l) => l.product === "diesel" && l.tank !== "reefer" && l.gallons > 0).length,
);

/**
 * The tables are capped, and they SAY they are capped.
 *
 * A list of fifty rows that is silently the first fifty of two hundred reads as "there were fifty",
 * and the reader stops looking. The CSV carries everything, which is only useful if they know to ask.
 */
const EXCEPTION_CAP = 50;
const SITE_CAP = 25;
const exceptionRows = computed(() =>
  capture.value.exceptions.slice(0, EXCEPTION_CAP).map((c, i) => ({
    id: `${i}-${c.line.site ?? "?"}-${c.line.tranDate ?? ""}`,
    date: c.line.tranDate ?? "—",
    site: `${c.line.site ?? "?"} ${c.line.city ?? ""} ${c.line.state ?? ""}`.trim(),
    unit: c.line.unit ?? "—",
    gallons: gal(c.gallons),
    quoted: usd3(c.contractPerGal),
    billed: usd3(c.paidPerGal),
    variance: usd(c.variance),
  })),
);
const exceptionCols: DataTableColumn[] = [
  { key: "date", label: "Date", width: "sm" },
  { key: "site", label: "Site", width: "xl" },
  { key: "unit", label: "Unit", width: "xs" },
  { key: "gallons", label: "Gallons", numeric: true, width: "sm" },
  { key: "quoted", label: "Quoted / gal", numeric: true, width: "sm" },
  { key: "billed", label: "Billed / gal", numeric: true, width: "sm" },
  { key: "variance", label: "Over contract", numeric: true, width: "md" },
];

const worstSites = computed(() => capture.value.bySite.filter((r) => r.variance > 0));
const siteRows = computed(() =>
  worstSites.value.slice(0, SITE_CAP).map((r, i) => ({
    id: `${i}-${r.key}`, site: r.key, lines: r.lines, gallons: gal(r.gallons),
    perGal: usd3(r.variancePerGal), variance: usd(r.variance),
  })),
);
const siteCols: DataTableColumn[] = [
  { key: "site", label: "Site", width: "xl" },
  { key: "lines", label: "Fills", numeric: true, width: "xs" },
  { key: "gallons", label: "Gallons", numeric: true, width: "sm" },
  { key: "perGal", label: "Over / gal", numeric: true, width: "sm" },
  { key: "variance", label: "Over contract", numeric: true, width: "md" },
];

function exportLines() {
  downloadCsv(
    "fuel-contract-reconciliation",
    ["Date", "Site", "City", "State", "Brand", "Unit", "Gallons", "Billed", "Quoted", "Billed $/gal", "Quoted $/gal", "Variance $", "Quote age (days)"],
    capture.value.exceptions.map((c) => [
      c.line.tranDate, c.line.site, c.line.city, c.line.state, c.line.brand, c.line.unit,
      c.gallons.toFixed(1), c.paid.toFixed(2), c.expected.toFixed(2),
      c.paidPerGal.toFixed(4), c.contractPerGal.toFixed(4), c.variance.toFixed(2),
      c.staleDays == null ? "" : String(c.staleDays),
    ]),
  );
}
</script>

<template>
  <div class="space-y-6">
    <BaseCard v-if="capture.measuredLines === 0">
      <h3 class="text-sm font-semibold text-ink">Nothing here can be priced yet</h3>
      <p class="mt-1 max-w-2xl text-sm text-ink-muted">
        No fill in this window matched a Pilot quote, so what these fills should have cost is unknown. Quotes come
        from the daily Pilot price report, which is uploaded on
        <RouterLink to="/import" class="font-medium text-brand-700 underline">Import</RouterLink> — or narrow the
        dates to a period that already has them.
      </p>
    </BaseCard>

    <template v-else>
      <PriceCoverageStrip :from="from" :to="to" @narrow="(f, t) => emit('narrow', f, t)" />

      <!-- The two rates side by side, because the claim is that they should be the SAME rate. -->
      <BaseCard>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-ink">Billed against contract</h3>
            <p class="mt-1 max-w-2xl text-sm text-ink-muted">
              Every fill scored against <span class="font-medium text-ink-secondary">"Your Price"</span> — the net
              per-gallon Pilot quoted for that station on that day, contract discount already applied. Not a median
              of what we paid: that would measure the fleet against itself and could never show a week where every
              station charged over.
            </p>
          </div>
          <div class="shrink-0 text-right">
            <p
              class="text-2xl font-bold"
              :class="capture.netVariance > 0 ? 'text-danger-700' : 'text-ink'"
            >
              {{ usd(Math.abs(capture.netVariance)) }}
            </p>
            <p class="text-xs text-ink-muted">{{ capture.netVariance >= 0 ? "over" : "under" }} contract</p>
            <!-- ⚠ The denominator belongs HERE, beside the figure, not in the caution strip below.
                 On production 2026-08-25 this headline covered $849,913 of $3,056,926 — 27.8% of the
                 window's fuel — while reading as a fleet-wide verdict. A dollar figure whose scope is
                 a paragraph away is the same defect as `totalsOf` dividing a partial retail sum by
                 every gallon; both were found in the same audit. -->
            <p v-if="capture.measuredSpendShare != null" class="mt-1.5 text-xs text-ink-tertiary">
              measured over {{ usd(capture.paid) }}<br />
              of {{ usd(capture.paid + capture.unmeasuredPaid) }} —
              <span :class="capture.measuredSpendShare < 0.75 ? 'font-medium text-caution-800' : ''">{{
                pct1(capture.measuredSpendShare)
              }}</span>
              of this window's fuel
            </p>
          </div>
        </div>

        <dl class="mt-4 grid grid-cols-2 gap-4 border-t border-edge-subtle pt-4 sm:grid-cols-4">
          <div>
            <dt class="text-xs text-ink-muted">Quoted / gal</dt>
            <dd class="text-lg font-semibold text-ink">{{ usd3(capture.contractPerGal) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Billed / gal</dt>
            <dd class="text-lg font-semibold text-ink">{{ usd3(capture.paidPerGal) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Billed at contract</dt>
            <dd class="text-lg font-semibold text-ink">{{ pct1(capture.honouredShare) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Captured vs retail</dt>
            <dd class="text-lg font-semibold text-ink">{{ usd(capture.captured) }}</dd>
            <!-- The other three figures in this row are measured over the QUOTED fills; this one is
                 measured over the narrower set that also had a POSTED price. Three denominators in one
                 <dl> with only one of them stated is how a reader ends up dividing the wrong pair. -->
            <dd class="text-2xs text-ink-tertiary">
              over {{ capture.capturedLines.toLocaleString() }} of
              {{ capture.measuredLines.toLocaleString() }} priced fills
            </dd>
          </div>
        </dl>

        <p class="mt-3 text-sm text-ink-muted">
          {{ capture.honouredLines.toLocaleString() }} of {{ capture.measuredLines.toLocaleString() }} measured fills
          were billed at the quoted price, within a cent a gallon.
          <template v-if="capture.overLines">
            {{ capture.overLines }} came in above it by {{ usd(capture.overDollars) }}<template
              v-if="capture.underLines"
            >, and {{ capture.underLines }} below it by {{ usd(Math.abs(capture.underDollars)) }}</template>.
          </template>
          <template v-else>No fill was billed above contract by more than a cent a gallon.</template>
        </p>
      </BaseCard>

      <!-- How the figures above were resolved. Both caveats are independent: a window can be fully
           measured and still lean on carried-forward quotes, and an earlier version nested the second
           inside the first so it disappeared exactly when every fill WAS measurable. -->
      <p
        v-if="capture.unmeasuredLines > 0 || capture.carriedForwardLines > 0"
        class="rounded-surface bg-caution-50 px-4 py-2.5 text-xs text-caution-800 ring-1 ring-caution-100"
      >
        <template v-if="capture.unmeasuredLines > 0">
          {{ capture.unmeasuredLines.toLocaleString() }} of {{ inScope.toLocaleString() }} fills
          ({{ gal(capture.unmeasuredGallons) }} gallons, {{ usd(capture.unmeasuredPaid) }}) had no quote in range — an
          off-network site, or a station absent from that day's report. They are left out of every figure above rather
          than counted as having been billed correctly.
        </template>
        <template v-if="capture.carriedForwardLines > 0">
          {{ capture.carriedForwardLines.toLocaleString() }} fill{{ capture.carriedForwardLines === 1 ? " was" : "s were" }}
          measured against the previous day's quote, the report not having been issued that day.
        </template>
      </p>

      <div v-if="exceptionRows.length">
        <div class="mb-2 flex items-center justify-between">
          <h4 class="text-sm font-semibold text-ink">Fills billed off contract</h4>
          <div class="flex items-center gap-3">
            <span v-if="capture.exceptions.length > EXCEPTION_CAP" class="text-2xs text-ink-tertiary">
              showing {{ EXCEPTION_CAP }} of {{ capture.exceptions.length.toLocaleString() }}
            </span>
            <BaseButton variant="ghost" @click="exportLines">Download every exception (CSV)</BaseButton>
          </div>
        </div>
        <BaseCard padding="none">
          <DataTable :columns="exceptionCols" :rows="exceptionRows" empty-text="Nothing off contract." />
        </BaseCard>
      </div>

      <div v-if="siteRows.length">
        <div class="mb-2 flex items-center justify-between">
          <h4 class="text-sm font-semibold text-ink">Worst sites</h4>
          <span v-if="worstSites.length > SITE_CAP" class="text-2xs text-ink-tertiary">
            showing {{ SITE_CAP }} of {{ worstSites.length.toLocaleString() }}
          </span>
        </div>
        <BaseCard padding="none">
          <DataTable :columns="siteCols" :rows="siteRows" empty-text="No site billed above contract." />
        </BaseCard>
      </div>

      <BaseCard v-if="weekly.length > 1" padding="sm">
        <h4 class="text-sm font-semibold text-ink">By week</h4>
        <ul class="mt-2 space-y-1 text-sm">
          <li v-for="w in weekly" :key="w.week" class="flex flex-wrap items-baseline gap-x-4 text-ink-secondary">
            <span class="font-medium text-ink">{{ w.week }}</span>
            <span>quoted {{ usd3(w.contractPerGal) }}</span>
            <span>billed {{ usd3(w.paidPerGal) }}</span>
            <span :class="w.netVariance > 0 ? 'text-danger-700' : undefined">
              {{ usd(Math.abs(w.netVariance)) }} {{ w.netVariance >= 0 ? "over" : "under" }}
            </span>
            <span v-if="w.overLines" class="text-caution-800">{{ w.overLines }} off contract</span>
          </li>
        </ul>
      </BaseCard>
    </template>
  </div>
</template>
