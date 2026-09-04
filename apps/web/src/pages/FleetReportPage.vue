<script setup lang="ts">
import { computed, ref } from "vue";
import { AppTabs, type TabItem } from "@silvicom/ui";
import ExplainerPanel from "@/components/ui/ExplainerPanel.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import ActivityTable from "@/features/accounting/ActivityTable.vue";
import FleetContractorsTab from "@/features/accounting/FleetContractorsTab.vue";
import FleetOverview from "@/features/accounting/FleetOverview.vue";
import FleetTrendChart from "@/features/accounting/FleetTrendChart.vue";
import FleetTrucksTab from "@/features/accounting/FleetTrucksTab.vue";
import IncomeStatementTab from "@/features/accounting/IncomeStatementTab.vue";
import { fleetProvenanceLine } from "@/features/accounting/fleetProvenance";
import { useFleetReportQuery } from "@/features/accounting/useFleetReport";
import { useIncomeStatementQuery } from "@/features/accounting/useIncomeStatement";
import { useMileageCoverageQuery } from "@/features/accounting/useMileageCoverage";
import { lastFullMonth } from "@/lib/dateWindow";

/**
 * The fleet report (`/fleet-report`, D-FLEET1–8): what the fleet earned, spent and kept over a
 * period, the ledger in McLeod's own shape, and the two per-unit views that are precise.
 *
 * This file is the SHELL — the period, the three queries the period turns into, the tab strip and
 * the provenance line. Each tab is its own component under `features/accounting/` since R1 of the
 * UI plan (docs/plans/financial/FLEET-REPORT-UI-PLAN.md): the page was 402 lines under a 500-line
 * budget and could not take the period rail and the headline strip the plan adds without the
 * split. The file is named for the route it serves; it was `CpmReportPage.vue` until R1, a name
 * that stopped being true at G7 when the per-truck cost table it was named for was retired.
 *
 * Both ends of the period are INCLUSIVE ("Jul 1 to Jul 31"), matching what the picker shows; the
 * query layer converts the end to the API's exclusive bound. Default: the trailing full month —
 * the report is a period figure, and a part-month reads low on fixed-cadence costs. (R2 replaces
 * this with the latest month the sweep has finished, read from the data rather than the calendar.)
 */
const defaultWindow = lastFullMonth();
const from = ref<string>(defaultWindow.from);
const to = ref<string>(defaultWindow.to);

/**
 * Views of one period, so each table gets a page to itself (owner ruling, 2026-08-29). They used to
 * be stacked on one scroll: 169 truck rows, then the contractors, then the ledger check, which read
 * as one report with two footnotes rather than answers to separate questions. Overview leads (G5):
 * it answers the question a boss actually opens the page with — did we make money this period, and
 * where did it go — and the per-truck table answers a follow-up.
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

const period = computed(() => ({ from: from.value, to: to.value }));

/**
 * The fleet report (G1/G5) — one call carrying every tab's rows since G7b: the overview, the
 * families, the per-truck rows and the contractor rows (plan §2.5, every figure out of one call).
 */
const { data: fleet, isLoading: fleetLoading, isError: fleetError, refetch: fleetRefetch } = useFleetReportQuery(period);

/**
 * The income statement (G3) — its own query rather than a field on the fleet report: the statement
 * is the whole ledger for the period and the fleet report is a fleet calculation over part of it,
 * and loading ninety-four account rows to render the overview would make every other tab slower
 * for nothing. `useQuery` fetches it when the tab is opened and caches it after.
 */
const { data: statement, isLoading: statementLoading, isError: statementError } = useIncomeStatementQuery(period);

/**
 * How many trucks this period measured, and whether that is all of them (G4 + G10). It rides
 * beside every tab rather than inside one, because it is the answer to "can a per-mile figure be
 * trusted for this period at all". Samsara telematics finished rolling out during 2026, so an
 * early-2026 period measured fewer trucks than delivered loads and its cost per mile reads low on
 * miles and high on cost. The banner is how that stops being invisible.
 */
const { data: coverage } = useMileageCoverageQuery(period);

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
 * The provenance line (G8) — which months, swept when, does it tie, over how many trucks and miles.
 * It reads the fleet report, so the sentence qualifying the figures comes from the same request
 * that produced them. Empty until that call lands: a provenance line assembled from a half-loaded
 * page is worse than none.
 */
const provenanceLine = computed(() => (fleet.value ? fleetProvenanceLine(fleet.value) : ""));
const fleetErrorText = computed(() => (fleetError.value ? "Failed to load" : null));
</script>

<template>
  <div class="space-y-6">
    <!-- The description follows the tab, because the page answers different questions on each: what
         the fleet earned and spent, the ledger in McLeod's own order, or what one truck drove.
         One sentence describing all of them would describe none.

         Under it, the provenance line (G8). It replaced the Company total TAB, which restated the
         ledger's revenue, expenses and net beside a tie-out — every figure of which the overview now
         leads with. What was left is the part that qualifies the whole page: the months, the sweep's
         own stamp (D-FIN3, never the page's clock — a report that looks current while its source
         stopped three weeks ago is the failure the 2026-08 audit found), whether the split still
         ties, and the denominator under the rates. A reader who has to open a tab to learn whether
         the figures tie will not open it. -->
    <PageHeader :description="pageDescription" />
    <p v-if="provenanceLine" class="-mt-4 text-xs text-ink-tertiary">{{ provenanceLine }}</p>

    <!-- The method, one click away. Every sentence here used to sit in the page description or in
         trailing cards, in front of the figures rather than behind them — and none of it can be
         lost: a cost-per-mile number whose assumptions are invisible is worse than none, because it
         gets quoted. -->
    <ExplainerPanel>
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

    <!-- The coverage banner (G10), the WARNING only: a period short of trucks carries no per-mile
         figure at all, and saying so once, at the top, beats a dash on every row. Its "all measured"
         form was retired because the provenance line states the same count for every tab. -->
    <p
      v-if="coverage?.reason"
      class="rounded-control bg-warning-50 px-3 py-2 text-sm text-warning-700 ring-1 ring-inset ring-warning-600/20"
    >
      {{ coverage.reason }}
    </p>

    <!-- The ledger's own shortfall (G11) is NOT a page-level banner, unlike the mileage one above.
         It affects only the two tabs that read the ledger — the overview and the income statement —
         and both say it themselves; a banner as well printed the same sentence twice on one screen. -->
    <AppTabs v-model="tab" :tabs="TABS" label="Fleet report views" id-prefix="fleet-report" />

    <!-- Each tab is mounted fresh (v-if, not v-show) on purpose: a tab owns its page number and its
         filters, and remounting is what resets them on a tab change (owner ruling 2026-08-29). -->
    <div v-if="tab === 'overview'">
      <p v-if="fleetError" class="text-sm text-danger-600">
        The overview could not be loaded. Try the period again in a moment.
      </p>
      <FleetOverview v-else-if="fleet" :report="fleet" :loading="fleetLoading" />
      <p v-else class="text-sm text-ink-secondary">Loading the overview…</p>

      <!-- The trend (G9). The overview says what this period did; the trend says whether that is
           where the fleet has been sitting or where it has just moved to, which is the difference
           between a figure and a decision. It ends on the period on screen and reads its own
           twelve months back, so widening the picker does not stretch the chart. -->
      <FleetTrendChart class="mt-4" :to="to" />
    </div>

    <!-- Week by week (W2): revenue and activity from billing alone, bucketed on the day each load
         delivered. No cost and no per-driven-mile figure — see the component's own header. -->
    <ActivityTable v-if="tab === 'activity'" :from="from" :to="to" />

    <IncomeStatementTab
      v-if="tab === 'statement'"
      :statement="statement ?? null"
      :statement-loading="statementLoading"
      :statement-error="statementError"
      :fleet="fleet ?? null"
      :fleet-loading="fleetLoading"
    />

    <FleetTrucksTab
      v-if="tab === 'trucks'"
      :trucks="fleet?.trucks ?? []"
      :loading="fleetLoading"
      :error="fleetErrorText"
      :from="from"
      :to="to"
      @retry="fleetRefetch"
      @update:from="from = $event"
      @update:to="to = $event"
    />

    <FleetContractorsTab
      v-if="tab === 'contractors'"
      :owner-operators="fleet?.ownerOperators ?? []"
      :loading="fleetLoading"
      :error="fleetErrorText"
      :from="from"
      :to="to"
      @update:from="from = $event"
      @update:to="to = $event"
    />
  </div>
</template>
