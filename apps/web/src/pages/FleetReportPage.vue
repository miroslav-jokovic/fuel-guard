<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppButton as BaseButton, AppTabs, type TabItem } from "@silvicom/ui";
import ExplainerPanel from "@/components/ui/ExplainerPanel.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import ActivityTable from "@/features/accounting/ActivityTable.vue";
import FleetContractorsTab from "@/features/accounting/FleetContractorsTab.vue";
import FleetHeadlines from "@/features/accounting/FleetHeadlines.vue";
import FleetOverview from "@/features/accounting/FleetOverview.vue";
import FleetPeriodRail from "@/features/accounting/FleetPeriodRail.vue";
import FleetTrendChart from "@/features/accounting/FleetTrendChart.vue";
import FleetTrucksTab from "@/features/accounting/FleetTrucksTab.vue";
import IncomeStatementTab from "@/features/accounting/IncomeStatementTab.vue";
import { fleetProvenanceLine, fleetTrust, monthName } from "@/features/accounting/fleetProvenance";
import { useFleetReportQuery } from "@/features/accounting/useFleetReport";
import { useFleetTrendQuery } from "@/features/accounting/useFleetTrend";
import { useIncomeStatementQuery, type StatementCompare } from "@/features/accounting/useIncomeStatement";
import { useMileageCoverageQuery } from "@/features/accounting/useMileageCoverage";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { lastFullMonth } from "@/lib/dateWindow";
import { latestReportableMonth, monthKey, periodForMonth, periodLabel, type ReportPeriod } from "@/lib/reportPeriod";

/**
 * The fleet report (`/fleet-report`, D-FLEET1–8): what the fleet earned, spent and kept over a
 * period, the ledger in McLeod's own shape, and the two per-unit views that are precise.
 *
 * This file is the SHELL — the period, the queries the period turns into, the tab strip and the
 * trust chip. Each tab is its own component under `features/accounting/` since R1 of the UI plan
 * (docs/plans/financial/FLEET-REPORT-UI-PLAN.md). The file is named for the route it serves; it
 * was `CpmReportPage.vue` until R1, a name that stopped being true at G7 when the per-truck cost
 * table it was named for was retired.
 *
 * ── The period (R2, D-FRUI1) ──────────────────────────────────────────────────────────────────
 * One clock for the whole section: the rail above the tabs holds the period and every tab reads
 * it. Both ends are INCLUSIVE ("Jul 1 to Jul 31"); the query layer converts the end to the API's
 * exclusive bound. The page OPENS on the latest month the McLeod sweep has finished, read from the
 * trend it fetches anyway — never on the calendar's last full month, which on 2026-09-04 was
 * August, swept on the 28th with eleven lines, so the page opened on "no figures" (G11). Until
 * that month is known the period queries stay off (`ready`), because a request for a month the
 * reader never asked for is a wasted read at best and a withheld-month callout at worst.
 */
const calendarCap = monthKey(lastFullMonth().to);
const bootstrapTo = ref(lastFullMonth().to);
const bootstrapMonths = ref(12);
const { data: bootstrap, isError: bootstrapError } = useFleetTrendQuery(bootstrapTo, bootstrapMonths);

const period = ref<ReportPeriod | null>(null);
/** Said once, above the tabs, when the page opened on an earlier month than the calendar's. */
const openedEarlierNote = ref<string | null>(null);

watch(
  [bootstrap, bootstrapError],
  ([trend, failed]) => {
    if (period.value) return;
    if (trend) {
      const latest = latestReportableMonth(trend) ?? calendarCap;
      period.value = periodForMonth(latest);
      if (latest !== calendarCap) {
        const partial = trend.monthsPartial.find((m) => m.month === calendarCap);
        const why = partial
          ? `was swept on ${partial.sweptAt?.slice(0, 10) ?? "an unknown day"}, before the month ended`
          : "has not been swept from McLeod yet";
        openedEarlierNote.value = `${monthName(calendarCap)} ${why}, so the report opens on ${periodLabel(period.value)}. Step forward to see what the ledger holds for it.`;
      }
    } else if (failed) {
      // The trend could not say which month is finished; the calendar is the only fallback left,
      // and the overview will say in full if that month is withheld.
      period.value = periodForMonth(calendarCap);
    }
  },
  { immediate: true },
);

const ready = computed(() => period.value !== null);
const filter = computed(() => ({ from: period.value?.from ?? "", to: period.value?.to ?? "" }));
const from = computed(() => filter.value.from);
const to = computed(() => filter.value.to);

/**
 * Views of one period, so each table gets a page to itself (owner ruling, 2026-08-29). Overview
 * leads (G5): it answers the question a boss actually opens the page with — did we make money this
 * period, and where did it go — and the per-truck table answers a follow-up.
 */
type FleetTab = "overview" | "activity" | "trucks" | "contractors" | "statement";
const TABS: TabItem[] = [
  { value: "overview", label: "Overview" },
  // Week by week (W2). It sits second because it answers the question asked BETWEEN closes, where
  // the tabs after it answer the ones asked at one.
  { value: "activity", label: "Week by week" },
  { value: "trucks", label: "Per truck" },
  { value: "contractors", label: "Contractors" },
  { value: "statement", label: "Income statement" },
];
const tab = ref<FleetTab>("overview");

/**
 * The fleet report (G1/G5) — one call carrying every tab's rows since G7b: the overview, the
 * families, the per-truck rows and the contractor rows (plan §2.5, every figure out of one call).
 */
const { data: fleet, isLoading: fleetLoading, isError: fleetError, refetch: fleetRefetch } = useFleetReportQuery(filter, ready);

/**
 * The trend behind the headlines (R3): the previous month's figures and the sparklines. It is the
 * same query the chart under the overview issues — same key, same twelve months ending on the
 * period — so vue-query serves both from one request.
 */
const trendMonths = ref(12);
const { data: trend } = useFleetTrendQuery(to, trendMonths);

/**
 * The income statement (G3) — its own query rather than a field on the fleet report: the statement
 * is the whole ledger for the period and the fleet report is a fleet calculation over part of it,
 * and loading ninety-four account rows to render the overview would make every other tab slower
 * for nothing. `useQuery` fetches it when the tab is opened and caches it after.
 */
/**
 * What the statement's comparative column holds (R6): the previous period for a month, the year to
 * date otherwise — a quarter compared with the quarter before is a fair question, but the default
 * for anything longer than a month is the comparative the printed statement carries. The reader can
 * change it on the tab; it is part of the request, so it lives beside the period.
 */
const compare = ref<StatementCompare>("previous");
watch(
  () => period.value?.grain,
  (grain) => {
    if (grain) compare.value = grain === "month" ? "previous" : "ytd";
  },
  { immediate: true },
);
const statementFilter = computed(() => ({ ...filter.value, compare: compare.value }));
const { data: statement, isLoading: statementLoading, isError: statementError } = useIncomeStatementQuery(statementFilter, ready);
/** The statement as a printed document (R6): the browser's own print, with everything but the statement hidden. */
function printStatement() {
  window.print();
}

/**
 * How many trucks this period measured, and whether that is all of them (G4 + G10). It rides
 * beside every tab rather than inside one, because it is the answer to "can a per-mile figure be
 * trusted for this period at all".
 */
const { data: coverage } = useMileageCoverageQuery(filter, ready);

const pageDescription = computed(() =>
  tab.value === "overview"
    ? "What the fleet earned, spent and kept — and each of those for every mile it ran."
    : tab.value === "statement"
      ? "The general ledger, in the shape McLeod prints it."
      : tab.value === "activity"
        ? "What went out and what it earned, week by week. Revenue and activity only — cost is a monthly question."
      : tab.value === "contractors"
        ? "What each contractor hauled, what they were paid, and what we kept — with their share read back from what settled."
        : "What each truck drove and earned. There is no per-truck cost figure that is precise, so there is none here.",
);

/**
 * Provenance (G8, D-FRUI2): the chip on the rail is the short form — ties or misses, swept when —
 * and the full sentence (months, sweep stamp, residual, trucks and miles) sits first in the
 * explainer, where a reader who wants to check the claim will look. Both come from the fleet
 * report call itself, so the sentence qualifying the figures is from the request that made them.
 */
const trust = computed(() => (fleet.value ? fleetTrust(fleet.value) : null));
const provenanceLine = computed(() => (fleet.value ? fleetProvenanceLine(fleet.value) : ""));
const fleetErrorText = computed(() => (fleetError.value ? "Failed to load" : null));
</script>

<template>
  <div class="space-y-6">
    <!-- The description follows the tab, because the page answers different questions on each. -->
    <PageHeader :description="pageDescription">
      <template v-if="tab === 'statement' && statement" #actions>
        <BaseButton variant="secondary" @click="printStatement">Print statement</BaseButton>
      </template>
    </PageHeader>

    <!-- The method, one click away: a cost-per-mile number whose assumptions are invisible is
         worse than none, because it gets quoted. The provenance sentence leads it. -->
    <ExplainerPanel>
      <p v-if="provenanceLine" class="font-medium text-ink">{{ provenanceLine }}</p>
      <p>
        Money comes from McLeod's general ledger and miles from Samsara. Nothing is estimated and
        nothing is shared out: the overview and the income statement are the ledger's own totals over
        the period, and every rate is that total divided by the miles Samsara measured.
      </p>
      <p>
        The per-truck tab shows only what is precise for one truck — the miles it drove and what its
        loads earned. There is no per-truck cost column, because no source at this carrier can put a
        lease payment, an insurance premium or an office wage on a particular truck, and a column
        that looks measured but is estimated is worse than one that is missing.
      </p>
    </ExplainerPanel>

    <!-- One clock for every tab (D-FRUI1), with the trust chip beside it (D-FRUI2). Until the
         opening month is known the rail waits with the tabs, rather than flashing the calendar's
         month and then correcting itself. -->
    <FleetPeriodRail v-if="period" v-model="period" :cap="calendarCap">
      <span v-if="trust" :class="[BADGE_BASE, toneClass(trust.tone)]" :title="trust.title">{{ trust.label }}</span>
      <span v-if="fleet?.total.trucks != null && fleet?.total.miles != null" class="text-xs text-ink-tertiary">
        {{ fleet.total.trucks.toLocaleString() }} trucks · {{ Math.round(fleet.total.miles).toLocaleString() }} measured miles
      </span>
    </FleetPeriodRail>
    <p v-else class="text-sm text-ink-secondary">Finding the latest month in the ledger…</p>
    <p v-if="openedEarlierNote" class="-mt-3 text-xs text-ink-tertiary">{{ openedEarlierNote }}</p>

    <!-- The coverage banner (G10), the WARNING only: a period short of trucks carries no per-mile
         figure at all, and saying so once, at the top, beats a dash on every row. -->
    <p
      v-if="coverage?.reason"
      class="rounded-control bg-warning-50 px-3 py-2 text-sm text-warning-700 ring-1 ring-inset ring-warning-600/20"
    >
      {{ coverage.reason }}
    </p>

    <AppTabs v-model="tab" :tabs="TABS" label="Fleet report views" id-prefix="fleet-report" />

    <!-- Each tab is mounted fresh (v-if, not v-show) on purpose: a tab owns its page number and its
         filters, and remounting is what resets them on a tab change (owner ruling 2026-08-29). -->
    <template v-if="period">
      <div v-if="tab === 'overview'" class="space-y-4">
        <p v-if="fleetError" class="text-sm text-danger-600">
          The overview could not be loaded. Try the period again in a moment.
        </p>
        <template v-else-if="fleet">
          <!-- The four headlines (R3): kept, earned, spent, kept per mile — each with its
               neighbour. Hidden with the rest when no month of the period could be reported; the
               overview says why in full. -->
          <FleetHeadlines
            v-if="fleet.monthsCovered.length"
            :report="fleet"
            :trend="trend ?? null"
            :period="period"
            :loading="fleetLoading"
          />
          <FleetOverview :report="fleet" :loading="fleetLoading" />
        </template>
        <p v-else class="text-sm text-ink-secondary">Loading the overview…</p>

        <!-- The trend (G9): whether this period is where the fleet has been sitting or where it has
             just moved to. It ends on the period on screen and reads its own twelve months back. -->
        <FleetTrendChart :to="to" />
      </div>

      <!-- Week by week (W2): revenue and activity from billing alone, bucketed on the day each load
         delivered. No cost and no per-driven-mile figure — see the component's own header. -->
    <ActivityTable v-if="tab === 'activity'" :from="from" :to="to" />

    <IncomeStatementTab
        v-if="tab === 'statement'"
        v-model:compare="compare"
        :statement="statement ?? null"
        :statement-loading="statementLoading"
        :statement-error="statementError"
        :fleet="fleet ?? null"
        :fleet-loading="fleetLoading"
        :period="period"
      />

      <FleetTrucksTab
        v-if="tab === 'trucks'"
        :trucks="fleet?.trucks ?? []"
        :loading="fleetLoading"
        :error="fleetErrorText"
        :from="from"
        :to="to"
        @retry="fleetRefetch"
      />

      <FleetContractorsTab
        v-if="tab === 'contractors'"
        :owner-operators="fleet?.ownerOperators ?? []"
        :report="fleet ?? null"
        :loading="fleetLoading"
        :error="fleetErrorText"
        :from="from"
        :to="to"
      />
    </template>
  </div>
</template>
