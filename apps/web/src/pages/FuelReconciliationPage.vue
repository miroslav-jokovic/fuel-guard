<script setup lang="ts">
import { computed } from "vue";
import { AppTabs, AppCard as BaseCard, AppButton as BaseButton, type TabItem } from "@fuelguard/ui";
import { analyzePolicyExceptions, avoidedBrandsLabel, avoidedStatesLabel, listStates, type SpendLine } from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import ReconcileTab from "@/features/reconcile/ReconcileTab.vue";
import StatementsCard from "@/features/reconcile/StatementsCard.vue";
import DiscountCaptureTab from "@/features/reconcile/DiscountCaptureTab.vue";
import SpendOverviewTab from "@/features/reconcile/SpendOverviewTab.vue";
import ExceptionsTab from "@/features/reconcile/ExceptionsTab.vue";
import BuyDisciplineTab from "@/features/reconcile/BuyDisciplineTab.vue";
import SpendTrendTab from "@/features/reconcile/SpendTrendTab.vue";
import { useStatementsQuery, useStatementLinesQuery } from "@/features/reconcile/useStatements";
import { useSpendLinesQuery } from "@/features/reconcile/useSpendLines";
import { useBuyFillsQuery } from "@/features/reconcile/useBuyFills";
import { useSpendFilters } from "@/features/reconcile/useSpendFilters";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import ReportExportButton from "@/features/reconcile/ReportExportButton.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useFuelPolicy } from "@/composables/useRouteFuelSettings";
import { usd, usd3, pct1 } from "@/features/reconcile/format";

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

const f = useSpendFilters();
// Falls back to the trend for anything this org cannot show: a stale link, a hand-edited one, or a tab
// whose policy list has since been emptied (see `tabs`). `visibleTabs` is declared below and read
// lazily, which is what a computed is for.
const tab = computed<string>({
  get: () => (visibleTabs.value.has(f.tab.value) ? f.tab.value : "spend"),
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
// This org's own policy, from `route_fuel_settings` — the same three columns the route planner has
// honoured since 0058. The report used to measure a hardcoded {CA} / {one9} instead, so a carrier who
// added Oregon got a planner that avoided it and a compliance report that said the policy held.
const policy = useFuelPolicy();
const exceptions = computed(() => analyzePolicyExceptions(feedLines.value, policy.value));

// ── the buy-discipline source ───────────────────────────────────────────────────────────────────
// A SECOND read of the same fills, and it has to be: `fuel_spend_lines` returns a business date (two
// fills on one date either side of a state line is exactly this tab's case), no vehicle id, and
// nothing about the tank. `fuel_buy_fills` (0254) returns the sequence with a 14-day lookback so the
// leg that crossed INTO the window keeps its predecessor. Only fetched when the tab is open — it is
// a different question from the rest of the page and nobody should pay for it to answer another.
const { data: buyFillData, isLoading: buyLoading, isError: buyError } = useBuyFillsQuery(f.range);
const buyFills = computed(() => buyFillData.value ?? []);

// ── the statement source ────────────────────────────────────────────────────────────────────────
// Scoped by the PAGE's window, like everything else here. There was a `scope` selector for this and it
// was never rendered — pinned to "all" forever, with two unreachable branches behind it — so the
// statement tab showed every week ever kept while the filter bar above it advertised a date range.
// One period control, and it is the one in the URL. See `useStatementsQuery`.
const { data: statements, isLoading: stmtLoading, isError: stmtError, refetch } = useStatementsQuery(f.range);
const scopedStatements = computed(() => statements.value ?? []);
const { data: stmtLineData, isLoading: stmtLinesLoading } = useStatementLinesQuery(
  computed(() => scopedStatements.value.map((s) => s.id)),
);
const statementLines = computed<SpendLine[]>(() => stmtLineData.value ?? []);

/**
 * The two policy tabs name the policy they measure, and disappear when there is none.
 *
 * "California" and "ONE9 & off-brand" were literal strings beside an analyzer reading a hardcoded
 * constant — true of one carrier and of no other. Both halves now come from `route_fuel_settings`, so
 * a tab cannot be headed with a state the org does not avoid. An EMPTY list is a policy too: a carrier
 * who clears `avoid_states` is saying there is no state to avoid, and the honest answer is no tab
 * rather than an empty report under a heading they did not choose.
 */
const stateLabel = computed(() => avoidedStatesLabel(policy.value.avoidStates));
const brandLabel = computed(() => avoidedBrandsLabel(policy.value.avoidBrands));

const tabs = computed<TabItem[]>(() => [
  { value: "spend", label: "Spend & trend" },
  ...(brandLabel.value
    ? [{ value: "avoid_brand", label: `${brandLabel.value} & off-brand`, badge: exceptions.value.avoidedBrands.lines || undefined }]
    : []),
  ...(stateLabel.value
    ? [{ value: "california", label: stateLabel.value, badge: exceptions.value.avoidedStates.lines || undefined }]
    : []),
  { value: "off_network", label: "Off-network", badge: exceptions.value.offNetwork.lines || undefined },
  { value: "buy_discipline", label: "Buy discipline" },
  { value: "discount", label: "Discount capture" },
  { value: "reconcile", label: "Reconcile a file" },
  { value: "statements", label: "Statements", badge: (statements.value ?? []).length || undefined },
]);

// A link to a tab this org's policy no longer has must not land on a blank page — the same fallback
// the unknown-tab case already takes.
const visibleTabs = computed(() => new Set(tabs.value.map((t) => t.value)));

const isFeedTab = computed(() => ["avoid_brand", "california", "off_network", "discount"].includes(tab.value));

/**
 * X8 — the count is the count of what THIS tab is showing.
 *
 * It was `feedLines.length` on every tab: the unfiltered fill count sitting beside statement data on
 * one tab, beside a deliberately smaller measured-fills figure on another, and beside three exception
 * reports each of which selects a fraction of it. A number in a filter bar is read as "this is what
 * you are looking at", and on four of the six tabs it was not.
 */
const barCount = computed<{ n: number; label: string }>(() => {
  switch (tab.value) {
    case "avoid_brand": return { n: exceptions.value.avoidedBrands.lines, label: "fills off-brand" };
    case "california": return { n: exceptions.value.avoidedStates.lines, label: "fills in state" };
    case "off_network": return { n: exceptions.value.offNetwork.lines, label: "fills off-network" };
    // The legs the truck drove, not the fills — this tab counts pairs, and a fill count beside it
    // would be the X8 defect again (a number in a filter bar reads as "this is what you are seeing").
    case "buy_discipline": return { n: buyFills.value.filter((x) => x.inWindow !== false).length, label: "fills in sequence" };
    case "discount": return { n: feedLines.value.length, label: "fills" };
    case "statements": return { n: scopedStatements.value.length, label: "statements" };
    default: return { n: feedLines.value.length, label: "fills" };
  }
});

/**
 * E8 — one line saying how much of this window the page can actually speak about.
 *
 * The ingredients existed and were scattered: measured-versus-unmeasured on the discount tab,
 * unresolved stations counted nowhere the reader looks, rejected odometer intervals in a footnote
 * under the trend table. A controller wants one sentence, and without it every figure on the page
 * reads as though it covered everything.
 */
const coverageLine = computed(() => {
  const lines = feedLines.value.filter((l) => l.product === "diesel" && l.tank !== "reefer" && l.gallons > 0);
  if (lines.length === 0) return null;
  const spend = lines.reduce((a, l) => a + (l.netAmount ?? 0), 0);
  const priced = lines.filter((l) => l.contractAmount != null);
  const pricedSpend = priced.reduce((a, l) => a + (l.netAmount ?? 0), 0);
  const resolved = lines.filter((l) => l.brand != null).length;
  return {
    spend,
    pricedShare: spend > 0 ? pricedSpend / spend : null,
    resolvedShare: lines.length > 0 ? resolved / lines.length : null,
    statements: (statements.value ?? []).length,
  };
});

/**
 * The avoided-state blurb, written from the policy rather than about California.
 *
 * The CARB-and-fuel-tax sentence was true and specific to one state, on a tab that measures whichever
 * states the org listed. Naming them is both more useful and the only version that stays true — but
 * the WHY differs per state and we do not know it, so the copy states the policy and the mechanism it
 * asks for, which is what the report actually measures.
 */
const stateBlurb = computed(() => {
  const names = listStates(policy.value.avoidStates);
  return `Every gallon bought in ${names} costs more — state fuel taxes, and in some of them a reformulated diesel — which is why the policy is to cross on as little fuel as possible.`;
});

const stateNote = computed(() => {
  const f = exceptions.value.avoidedStateFillSize;
  const names = listStates(policy.value.avoidStates);
  if (f.inside == null || f.outside == null) return null;
  return `Average fill inside ${names} is ${f.inside.toFixed(0)} gallons against ${f.outside.toFixed(0)} elsewhere — the buy-minimum discipline the policy asks for, and the gap to watch.`;
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What fuel is costing, why it moved, and where the fuel policy is not being followed." />

    <AppTabs v-model="tab" :tabs="tabs" label="Fuel spend views" scrollable />

    <!-- X4. `normalizeWindow` REPORTS what it corrected rather than correcting silently, and its own
         header says the page can therefore say so — and then nothing rendered it, so a link with a
         backwards or future-dated range was quietly fixed and the reader was shown a period they had
         not asked for. This page exists to be sent to somebody; a correction it does not mention is a
         correction the recipient cannot know about. -->
    <p
      v-if="f.windowNotice.value"
      class="rounded-surface bg-caution-50 px-4 py-2.5 text-sm text-caution-800 ring-1 ring-caution-100"
    >
      {{ f.windowNotice.value }}
    </p>

    <!-- How much of this window the page can speak about, in one line. Every figure below is a claim
         about some subset of it, and without this they all read as claims about the whole. -->
    <p v-if="coverageLine && tab !== 'reconcile'" class="text-xs text-ink-tertiary">
      This window covers <strong class="text-ink-secondary">{{ usd(coverageLine.spend) }}</strong> of tractor fuel —
      <strong :class="(coverageLine.pricedShare ?? 0) < 0.75 ? 'text-caution-800' : 'text-ink-secondary'">{{
        pct1(coverageLine.pricedShare)
      }}</strong>
      priced against a contract quote, {{ pct1(coverageLine.resolvedShare) }} resolved to a station,
      {{ coverageLine.statements }} statement{{ coverageLine.statements === 1 ? "" : "s" }} on file.
    </p>

    <!-- ONE filter bar for every view that reads data. Dates, trucks and grain are the page's, so a
         figure read on one tab is the same period as a figure read on the next, and the export sends
         exactly these to the server. -->
    <FilterBar v-if="tab !== 'reconcile'" :count="barCount.n" :count-label="barCount.label">
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

    <!-- Fuel carried out of a dearer state. Its own source (`fuel_buy_fills`), because the sequence
         needs an instant, a vehicle id and the tank — none of which `fuel_spend_lines` carries. -->
    <template v-else-if="tab === 'buy_discipline'">
      <p
        v-if="buyError"
        class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100"
      >
        Couldn't load the fill sequence for this window.
      </p>
      <BuyDisciplineTab v-else :fills="buyFills" :policy="policy" :loading="buyLoading" />
    </template>

    <!-- ── feed-fed policy reports ──────────────────────────────────────────────────────────── -->
    <template v-else-if="isFeedTab">
      <p v-if="feedLoading" class="text-sm text-ink-muted">Loading…</p>

      <p v-if="feedError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
        Couldn't load your fills: {{ feedErr instanceof Error ? feedErr.message : "unknown error" }}
      </p>

      <template v-else>
        <ExceptionsTab
          v-if="tab === 'avoid_brand'"
          :title="`${brandLabel} and other off-brand sites`"
          :blurb="`Networks your fuel policy says to avoid. Across this window they cost ${usd3(exceptions.avoidedBrands.netPerGal)} a gallon against ${usd3(exceptions.avoidedBrands.baselinePerGal)} for the rest of the fleet.`"
          :report="exceptions.avoidedBrands"
          slug="off-brand"
        />
        <ExceptionsTab
          v-else-if="tab === 'california'"
          :title="stateLabel ?? ''"
          :blurb="stateBlurb"
          :report="exceptions.avoidedStates"
          slug="avoided-states"
          :note="stateNote"
        />
        <DiscountCaptureTab
          v-else-if="tab === 'discount'"
          :lines="feedLines"
          :from="f.from.value"
          :to="f.to.value"
          @narrow="(from, to) => f.setWindow(from, to)"
        />
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
        <h3 class="text-sm font-semibold text-ink">No statements for {{ f.from.value }} → {{ f.to.value }}</h3>
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
