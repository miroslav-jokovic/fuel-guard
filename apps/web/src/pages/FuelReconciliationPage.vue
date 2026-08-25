<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppTabs, AppCard as BaseCard, AppButton as BaseButton, type TabItem } from "@fuelguard/ui";
import { analyzePolicyExceptions, type SpendLine } from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import ReconcileTab from "@/features/reconcile/ReconcileTab.vue";
import StatementsCard from "@/features/reconcile/StatementsCard.vue";
import DiscountCaptureTab from "@/features/reconcile/DiscountCaptureTab.vue";
import SpendOverviewTab from "@/features/reconcile/SpendOverviewTab.vue";
import ExceptionsTab from "@/features/reconcile/ExceptionsTab.vue";
import SpendTrendTab from "@/features/reconcile/SpendTrendTab.vue";
import { useStatementsQuery, useStatementLinesQuery } from "@/features/reconcile/useStatements";
import { useSpendLinesQuery } from "@/features/reconcile/useSpendLines";
import { useSpendFilters } from "@/features/reconcile/useSpendFilters";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import ReportExportButton from "@/features/reconcile/ReportExportButton.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { usd } from "@/features/reconcile/format";

/**
 * Fuel spend — what the fuel bill is, why it moved, and where the policy is not being followed.
 *
 * ── TWO SOURCES, AND EVERY TAB SAYS WHICH ONE IT IS ON ───────────────────────────────────────────
 * The EFS feed is continuous and covers every fill; the vendor's weekly statement is uploaded by hand
 * and covers whatever weeks somebody remembered. So each tab is fed by whichever can actually answer
 * its question:
 *
 *   FEED       Spend & trend, ONE9 & off-brand, California, Off-network, Discount capture. Brand, state
 *              and distance came with the station backfill; the POSTED price — which EFS never records —
 *              now comes from the daily price reports, kept since 0245 and joined per station-day by
 *              `fuel_spend_lines` (0246).
 *   STATEMENT  The statement list and the vendor's own market-vs-discount decomposition. What is left
 *              that only a statement can answer: what the vendor BILLED, line by line.
 *
 * Every tab but the first used to read statements, which is why they were empty until somebody uploaded
 * a PDF — for questions the carrier asks weekly and a document that arrives monthly.
 *
 * ── WHY "SPEND & TREND" IS FIRST ─────────────────────────────────────────────────────────────────
 * It is the tab that answers the question actually being asked — "fuel cost more this week, why".
 * Reconcile keeps its place beside it because it is still the one that catches a fill we were billed
 * for and never recorded — the fuel-theft surface, which is a different job from cost.
 *
 * ── WHY THE TAB AND WINDOW ARE IN THE URL ────────────────────────────────────────────────────────
 * A page whose state dies on refresh cannot be sent to anybody, and this one exists to be sent to
 * somebody. Both live in the query string so a link opens on what the sender was looking at.
 */

const TAB_VALUES = ["spend", "avoid_brand", "california", "off_network", "discount", "reconcile", "statements"];
const f = useSpendFilters();
const tab = computed<string>({
  get: () => (TAB_VALUES.includes(f.tab.value) ? f.tab.value : "spend"),
  set: (v) => { f.tab.value = v; },
});

const grainOptions = [
  { value: "day", label: "By day" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
];

/** The truck list for the filter. Unit numbers, because that is what a dispatcher says out loud. */
const { data: vehicles } = useVehiclesQuery();
const truckOptions = computed(() =>
  (vehicles.value ?? []).map((v) => ({ value: v.id, label: v.unit_number })),
);

const queryFilters = computed(() => ({ from: f.from.value, to: f.to.value, vehicleIds: f.vehicleIds.value }));

// ── the feed source: every recorded fill, with its brand ────────────────────────────────────────
const { data: feedData, isLoading: feedLoading, isError: feedError, error: feedErr } = useSpendLinesQuery(queryFilters);
const feedLines = computed<SpendLine[]>(() => feedData.value ?? []);
const exceptions = computed(() => analyzePolicyExceptions(feedLines.value));

// ── the statement source: only what discount capture needs ──────────────────────────────────────
const { data: statements, isLoading: stmtLoading, isError: stmtError, refetch } = useStatementsQuery();
const scope = ref<string>("all");
const scopeOptions = computed(() => [
  { value: "all", label: "All statements" },
  { value: "last4", label: "Last 4 weeks" },
  ...(statements.value ?? []).map((s) => ({ value: s.id, label: `${s.periodStart} → ${s.periodEnd}` })),
]);
// A saved scope can point at a statement a later upload superseded; fall back rather than show nothing.
watch(scopeOptions, (opts) => {
  if (!opts.some((o) => o.value === scope.value)) scope.value = "all";
});
const scopedStatements = computed(() => {
  const all = statements.value ?? [];
  if (scope.value === "all") return all;
  if (scope.value === "last4") return all.slice(0, 4);
  return all.filter((s) => s.id === scope.value);
});
const { data: stmtLineData, isLoading: stmtLinesLoading } = useStatementLinesQuery(
  computed(() => scopedStatements.value.map((s) => s.id)),
);
const statementLines = computed<SpendLine[]>(() => stmtLineData.value ?? []);

const tabs = computed<TabItem[]>(() => [
  { value: "spend", label: "Spend & trend" },
  { value: "avoid_brand", label: "ONE9 & off-brand", badge: exceptions.value.avoidedBrands.lines || undefined },
  { value: "california", label: "California", badge: exceptions.value.avoidedStates.lines || undefined },
  { value: "off_network", label: "Off-network", badge: exceptions.value.offNetwork.lines || undefined },
  { value: "discount", label: "Discount capture" },
  { value: "reconcile", label: "Reconcile a file" },
  { value: "statements", label: "Statements", badge: (statements.value ?? []).length || undefined },
]);

const isFeedTab = computed(() => ["avoid_brand", "california", "off_network", "discount"].includes(tab.value));

const caNote = computed(() => {
  const f = exceptions.value.avoidedStateFillSize;
  if (f.inside == null || f.outside == null) return null;
  return `Average fill inside California is ${f.inside.toFixed(0)} gallons against ${f.outside.toFixed(0)} elsewhere — the buy-minimum discipline the policy asks for, and the gap to watch.`;
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What fuel is costing, why it moved, and where the fuel policy is not being followed." />

    <AppTabs v-model="tab" :tabs="tabs" label="Fuel spend views" scrollable />

    <!-- ONE filter bar for every view that reads data. Dates, trucks and grain are the page's, so a
         figure read on one tab is the same period as a figure read on the next, and the export sends
         exactly these to the server. -->
    <FilterBar v-if="tab !== 'reconcile'" :count="feedLines.length" count-label="fills">
      <!-- ⚠ These MUST be in the #filters slot. FilterBar has no default slot — only #filters, #more
           and #actions — so controls placed as plain children are silently dropped and the bar renders
           empty. That is exactly how this whole filter row went missing on a live page.

           `DateRangeFilter` emits `update:from` and `update:to` in the SAME tick. That is what welded
           this window to 90 days: both setters read the same not-yet-updated `route.query` and the
           second navigation clobbered the first. The fix lives in `useSpendFilters`, which coalesces
           patches, so the two v-models here are safe — do not "simplify" that buffer away. -->
      <template #filters>
        <DateRangeFilter v-model:from="f.from.value" v-model:to="f.to.value" label="Dates" />
        <FilterSelect v-model="f.vehicleIds.value" :options="truckOptions" label="Trucks" multiple />
        <FilterSelect v-if="tab === 'spend'" v-model="f.grain.value" :options="grainOptions" label="Grain" />
        <BaseButton v-if="f.active.value" variant="ghost" @click="f.reset()">Clear filters</BaseButton>
      </template>
      <template #actions>
        <ReportExportButton
          :query="f.asQuery.value"
          :from="f.from.value"
          :to="f.to.value"
          :grain="f.grain.value"
          :truck-count="f.vehicleIds.value.length"
        />
      </template>
    </FilterBar>

    <SpendTrendTab v-if="tab === 'spend'" :filters="queryFilters" :grain="f.grain.value" :query="f.asQuery.value" />

    <ReconcileTab v-else-if="tab === 'reconcile'" @saved="refetch()" />

    <!-- ── feed-fed policy reports ──────────────────────────────────────────────────────────── -->
    <template v-else-if="isFeedTab">
      <p v-if="feedLoading" class="text-sm text-ink-muted">Loading…</p>

      <p v-if="feedError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
        Couldn't load your fills: {{ feedErr instanceof Error ? feedErr.message : "unknown error" }}
      </p>

      <template v-else>
        <ExceptionsTab
          v-if="tab === 'avoid_brand'"
          title="ONE9 and other off-brand sites"
          :blurb="`Networks your fuel policy says to avoid. Across this window they cost ${usd(exceptions.avoidedBrands.netPerGal)} a gallon against ${usd(exceptions.avoidedBrands.baselinePerGal)} for the rest of the fleet.`"
          :report="exceptions.avoidedBrands"
          slug="one9-off-brand"
        />
        <ExceptionsTab
          v-else-if="tab === 'california'"
          title="California"
          blurb="CARB diesel and California's fuel taxes make every gallon bought in the state cost more, which is why the policy is to cross on as little fuel as possible."
          :report="exceptions.avoidedStates"
          slug="california"
          :note="caNote"
        />
        <DiscountCaptureTab v-else-if="tab === 'discount'" :lines="feedLines" />
        <ExceptionsTab
          v-else
          title="Off the preferred network"
          blurb="Fills outside Pilot and Flying J, including sites we could not identify — an unidentified site is certainly not a preferred one, so it counts here rather than being assumed compliant."
          :report="exceptions.offNetwork"
          slug="off-network"
        />
      </template>
    </template>

    <!-- ── statement-fed views ──────────────────────────────────────────────────────────────── -->
    <template v-else>
      <p class="text-sm text-ink-muted">
        {{ scopedStatements.length }} statement{{ scopedStatements.length === 1 ? "" : "s" }} on file
        <template v-if="statementLines.length">· {{ statementLines.length.toLocaleString() }} lines</template>
        <template v-if="stmtLinesLoading"> · loading…</template>
      </p>

      <p v-if="stmtError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
        Couldn't load your statements.
      </p>

      <BaseCard v-else-if="!(statements ?? []).length && !stmtLoading">
        <h3 class="text-sm font-semibold text-ink">No statements on file</h3>
        <p class="mt-1 text-sm text-ink-muted">
          This view needs the vendor's weekly statement, because it is the only source that prints the POSTED price
          beside what we paid — the EFS feed records what we paid and never what was on the sign. Upload one on
          <strong>Reconcile a file</strong> and it stays here. Every other tab reads the feed and works without it.
        </p>
      </BaseCard>

      <template v-else>
        <!-- The statement's OWN story: what the vendor billed, the market-vs-discount decomposition
             only it can support, and the non-fuel charges it bundles onto a fuel ticket. -->
        <SpendOverviewTab :lines="statementLines" />
        <StatementsCard
          :statements="statements ?? []"
          :loading="stmtLoading"
          :error="stmtError ? 'Could not load statements' : null"
        />
      </template>
    </template>
  </div>
</template>
