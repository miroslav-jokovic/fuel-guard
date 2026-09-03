<script setup lang="ts">
import { computed, ref } from "vue";
import { AppTabs, AppCard as BaseCard, AppButton as BaseButton, AppIcon, type TabItem } from "@silvicom/ui";
import { ArrowUpTrayIcon } from "@silvicom/ui/icons";
import { type SpendLine } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import ReconcileDrawer from "@/features/reconcile/ReconcileDrawer.vue";
import StatementsCard from "@/features/reconcile/StatementsCard.vue";
import DiscountCaptureCard from "@/features/reconcile/DiscountCaptureCard.vue";
import SpendOverviewTab from "@/features/reconcile/SpendOverviewTab.vue";
import BuyDisciplineTab from "@/features/reconcile/BuyDisciplineTab.vue";
import SpendTrendTab from "@/features/reconcile/SpendTrendTab.vue";
import { useStatementsQuery, useStatementLinesQuery } from "@/features/reconcile/useStatements";
import { useSpendLinesQuery } from "@/features/reconcile/useSpendLines";
import { useBuyFillsQuery } from "@/features/reconcile/useBuyFills";
import { useSpendFilters } from "@/features/reconcile/useSpendFilters";
import { useSpendFreshnessQuery } from "@/features/reconcile/useSpendFreshness";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import ReportExportButton from "@/features/reconcile/ReportExportButton.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useFuelPolicy } from "@/composables/useRouteFuelSettings";
import { usd, pct1 } from "@/features/reconcile/format";

/**
 * Fuel spend — what the fuel bill is, why it moved, and where the policy is not being followed.
 *
 * ── THREE TABS, DOWN FROM EIGHT (FUEL-C5, D-FUI4) ───────────────────────────────────────────────
 * `Spend & trend | Buy discipline | Statements`. What went where, and why:
 *
 * · **Reconcile a file** is an upload, and every other upload in this plan is a drawer (D-FUI3). It
 *   is also the tab that had to be excepted from the rest of the page three separate times — the
 *   filter bar, the freshness line and the coverage line were all suppressed on it, because a period
 *   control means nothing while you are reading a file. Three special cases for one tab is the page
 *   saying it is not a view of the same data. It opens from Statements now, next to the empty state
 *   that asks for it.
 * · **Discount capture** folds into Spend & trend as a KPI that discloses the fills behind it. "Were
 *   we billed what Pilot quoted" is a question about the fuel bill, and it belongs beside the bill
 *   rather than behind a tab somebody has to know to visit.
 * · **The three policy reports** — the avoided brands, the avoided states, off-network — stop being
 *   tabs and become finding kinds in C6 (D-FUI5). ⚠ Their bodies are KEPT IN THE TREE, unmounted:
 *   `ExceptionsTab.vue` and `features/reconcile/policyReports.ts`, the latter written in this step
 *   precisely so the titles, the blurbs and the buy-minimum note did not die with this page's markup.
 *   A report deleted before its replacement produces anything is a capability gap, however brief.
 *
 * Eight tabs was not a long list, it was three different jobs wearing one strip: a cost report, a
 * policy audit and two file surfaces. What is left is the cost report, the discipline check, and the
 * vendor's own paperwork.
 *
 * ── TWO SOURCES, AND EVERY TAB SAYS WHICH ONE IT IS ON ───────────────────────────────────────────
 * The EFS feed is continuous and covers every fill; the vendor's weekly statement is uploaded by hand
 * and covers whatever weeks somebody remembered. So each tab is fed by whichever can actually answer
 * its question:
 *
 *   FEED       Spend & trend, including the discount KPI. Brand, state and distance came with the
 *              station backfill; the POSTED price — which EFS never records — comes from the daily
 *              price reports, kept since 0245 and joined per station-day by `fuel_spend_lines` (0246).
 *   STATEMENT  The statement list and the vendor's own market-vs-discount decomposition. What is left
 *              that only a statement can answer: what the vendor BILLED, line by line.
 *
 * Every tab but the first used to read statements, which is why they were empty until somebody uploaded
 * a PDF — for questions the carrier asks weekly and a document that arrives monthly.
 *
 * ── WHY THE TAB AND WINDOW ARE IN THE URL ────────────────────────────────────────────────────────
 * A page whose state dies on refresh cannot be sent to anybody, and this one exists to be sent to
 * somebody. Both live in the query string so a link opens on what the sender was looking at.
 */

const f = useSpendFilters();
/**
 * Falls back to the trend for anything this page cannot show — and after C5 that includes the FIVE
 * retired `?tab=` values. A link to `?tab=discount` or `?tab=avoid_brand` sent last week lands on
 * Spend & trend rather than on nothing, which is the same fallback the unknown-tab case always took.
 * `visibleTabs` is declared below and read lazily, which is what a computed is for.
 */
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

/**
 * How current the spend rollup is for THIS window (FUEL-T5, A6, D-FUI18).
 *
 * `fuel_spend_days` rebuilds only the trailing 14 days, so a window reaching further back shows figures
 * derived once and never re-derived through any correction since — 29,114 production rows all built
 * inside one week in August. Every number on the tabs below is a claim about how things stood when the
 * rollup last ran, and until now nothing said when that was.
 */
const freshness = useSpendFreshnessQuery(queryFilters);

// ── the feed source: every recorded fill, with its brand ────────────────────────────────────────
const { data: feedData } = useSpendLinesQuery(queryFilters);
const feedLines = computed<SpendLine[]>(() => feedData.value ?? []);
// This org's own policy, from `route_fuel_settings` — the same three columns the route planner has
// honoured since 0058. Read here for Buy discipline; `policyReports.ts` reads it for the three
// reports C6 will file, which is where the rest of this page's use of it went.
const policy = useFuelPolicy();

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
 * Three tabs, and the list is now FIXED where it used to vary with the org's policy.
 *
 * Two of the eight only existed when `route_fuel_settings` named a brand or a state to avoid, so the
 * strip changed shape per carrier. Nothing here does: every carrier has a fuel bill, a fill sequence
 * and a vendor. The policy-dependent half moved to `policyReports.ts`, which still returns a list
 * whose length varies — because that variability was right, it was just wrong in a tab strip.
 */
const tabs = computed<TabItem[]>(() => [
  { value: "spend", label: "Spend & trend" },
  { value: "buy_discipline", label: "Buy discipline" },
  { value: "statements", label: "Statements", badge: scopedStatements.value.length || undefined },
]);

// A link to a tab this page no longer has must not land on a blank page — see `tab` above.
const visibleTabs = computed(() => new Set(tabs.value.map((t) => t.value)));

/** The reconcile drawer, opened from Statements. */
const reconcileOpen = ref(false);

/**
 * X8 — the count is the count of what THIS tab is showing.
 *
 * It was `feedLines.length` on every tab: the unfiltered fill count sitting beside statement data on
 * one tab, beside a deliberately smaller measured-fills figure on another, and beside three exception
 * reports each of which selects a fraction of it. A number in a filter bar is read as "this is what
 * you are looking at", and on four of the six tabs it was not. Three tabs, three answers, and the
 * cases this switch lost went with the tabs that needed them.
 */
const barCount = computed<{ n: number; label: string }>(() => {
  switch (tab.value) {
    // The legs the truck drove, not the fills — this tab counts pairs, and a fill count beside it
    // would be the X8 defect again (a number in a filter bar reads as "this is what you are seeing").
    case "buy_discipline": return { n: buyFills.value.filter((x) => x.inWindow !== false).length, label: "fills in sequence" };
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
    statements: scopedStatements.value.length,
  };
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What fuel is costing, why it moved, and where the fuel policy is not being followed." />

    <AppTabs v-model="tab" :tabs="tabs" label="Fuel spend views" />

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

    <!-- WHEN the figures below were derived, above the figures rather than under them (T5). A stale
         rollup is not a smaller number, it is an older one, and a reader cannot infer it from anything
         on screen. Only the warning form gets a tone: a fresh rebuild is context, not an alert.

         ⚠ No `tab !== 'reconcile'` guard any more, and that is C5's done-when: the freshness line and
         the coverage line below it now render above ALL THREE tabs, because all three read data from
         the same window. The one surface they did not describe was the file reader, and it is a
         drawer now. -->
    <p
      v-if="freshness.data.value?.lead"
      :class="freshness.data.value.stale
        ? 'rounded-surface bg-caution-50 px-4 py-2.5 text-sm text-caution-800 ring-1 ring-caution-100'
        : 'text-xs text-ink-tertiary'"
    >
      {{ freshness.data.value.lead }}
    </p>

    <!-- How much of this window the page can speak about, in one line. Every figure below is a claim
         about some subset of it, and without this they all read as claims about the whole. -->
    <p v-if="coverageLine" class="text-xs text-ink-tertiary">
      This window covers <strong class="text-ink-secondary">{{ usd(coverageLine.spend) }}</strong> of tractor fuel —
      <strong :class="(coverageLine.pricedShare ?? 0) < 0.75 ? 'text-caution-800' : 'text-ink-secondary'">{{
        pct1(coverageLine.pricedShare)
      }}</strong>
      priced against a contract quote, {{ pct1(coverageLine.resolvedShare) }} resolved to a station,
      {{ coverageLine.statements }} statement{{ coverageLine.statements === 1 ? "" : "s" }} on file.
    </p>

    <!-- ONE filter bar for every view. Dates, trucks and grain are the page's, so a figure read on one
         tab is the same period as a figure read on the next, and the export sends exactly these to
         the server. -->
    <FilterBar :count="barCount.n" :count-label="barCount.label">
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

    <!-- ── Spend & trend: the bill, then whether it was the bill we were quoted ──────────────── -->
    <template v-if="tab === 'spend'">
      <SpendTrendTab :filters="queryFilters" :grain="f.grain.value" :query="f.asQuery.value" />
      <DiscountCaptureCard
        :lines="feedLines"
        :from="f.from.value"
        :to="f.to.value"
        @narrow="(from, to) => f.setWindow(from, to)"
      />
    </template>

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

    <!-- ── statement-fed views ──────────────────────────────────────────────────────────────── -->
    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-ink-muted">
          {{ scopedStatements.length }} statement{{ scopedStatements.length === 1 ? "" : "s" }} on file
          <template v-if="statementLines.length">· {{ statementLines.length.toLocaleString() }} lines</template>
          <template v-if="stmtLinesLoading"> · loading…</template>
        </p>
        <BaseButton variant="secondary" @click="reconcileOpen = true">
          <AppIcon :icon="ArrowUpTrayIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Reconcile a file
        </BaseButton>
      </div>

      <p v-if="stmtError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
        Couldn't load your statements.
      </p>

      <BaseCard v-else-if="!scopedStatements.length && !stmtLoading">
        <h3 class="text-sm font-semibold text-ink">No statements for {{ f.from.value }} → {{ f.to.value }}</h3>
        <p class="mt-1 text-sm text-ink-muted">
          This view needs the vendor's weekly statement, because it is the only source that prints the POSTED price
          beside what we paid — the EFS feed records what we paid and never what was on the sign. Use
          <strong>Reconcile a file</strong> above and it stays here. Every other view reads the feed and works without it.
        </p>
      </BaseCard>

      <template v-else>
        <!-- The statement's OWN story: what the vendor billed, the market-vs-discount decomposition
             only it can support, and the non-fuel charges it bundles onto a fuel ticket. -->
        <SpendOverviewTab :lines="statementLines" />
        <StatementsCard
          :statements="scopedStatements"
          :loading="stmtLoading"
          :error="stmtError ? 'Could not load statements' : null"
        />
      </template>
    </template>

    <ReconcileDrawer :open="reconcileOpen" @close="reconcileOpen = false" @saved="refetch()" />
  </div>
</template>
