<script setup lang="ts">
import { computed, ref } from "vue";
import { AppSearchField, AppSegmentedControl, type SegmentOption } from "@silvicom/ui";
import StatCard from "@/components/ui/StatCard.vue";
import { monthKey, shiftMonth, type ReportPeriod } from "@/lib/reportPeriod";
import FamilySummaryTable from "./FamilySummaryTable.vue";
import IncomeStatementTable from "./IncomeStatementTable.vue";
import { monthName } from "./fleetProvenance";
import type { FleetReportResponse } from "./useFleetReport";
import type { IncomeStatementResponse, StatementCompare, StatementSection } from "./useIncomeStatement";

/**
 * The income statement tab (G3 + G6, R6): the period's ledger in the shape the owner's own printed
 * McLeod P&L takes, with the ten-family summary above it. Sections in McLeod's order, accounts by
 * code inside each, and a row opens to show which parts of McLeod posted it.
 *
 * Since R6 the reader chooses what the comparative column holds — the previous period, the year to
 * date, or nothing — and can find an account by name or code. The compare choice is the page's
 * (it changes the request), so it arrives as a `v-model`; the search is this tab's own, because it
 * only narrows what is already on screen. Two queries feed the tab and both are passed in, so the
 * page shell stays the only place a period turns into a request. A failed fetch is said in words,
 * never swallowed into an empty state (D-FIN15).
 *
 * `print-target` marks the whole tab as what "Print statement" puts on paper; the tools row and
 * the headline cards carry `print-hide` because the printed document is the statement itself.
 */

const props = defineProps<{
  statement: IncomeStatementResponse | null;
  statementLoading: boolean;
  statementError: boolean;
  fleet: FleetReportResponse | null;
  fleetLoading: boolean;
  period: ReportPeriod;
  compare: StatementCompare;
}>();
const emit = defineEmits<{ "update:compare": [value: StatementCompare] }>();

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

/** The previous period's name for the control and the column: "June 2026", "Q2 2026", "the 3 months before". */
const previousLabel = computed(() => {
  const endKey = monthKey(props.period.to);
  switch (props.period.grain) {
    case "month":
      return monthName(shiftMonth(endKey, -1));
    case "quarter": {
      const startKey = shiftMonth(monthKey(props.period.from), -3);
      return `Q${Math.floor((Number(startKey.slice(5, 7)) - 1) / 3) + 1} ${startKey.slice(0, 4)}`;
    }
    case "ytd":
    case "custom":
    default: {
      const months = (Number(endKey.slice(0, 4)) - Number(props.period.from.slice(0, 4))) * 12 + Number(endKey.slice(5, 7)) - Number(props.period.from.slice(5, 7)) + 1;
      return `the ${months} months before`;
    }
  }
});

const COMPARE_OPTIONS = computed<readonly SegmentOption[]>(() => [
  { value: "previous", label: `Compare to ${previousLabel.value}` },
  { value: "ytd", label: "Year to date" },
  { value: "none", label: "No comparison" },
]);

/** What the comparative column actually holds, from the response — not from what was asked for. */
const comparisonKind = computed<StatementCompare>(() => props.statement?.comparison?.kind ?? "ytd");
const compareLabel = computed(() => (comparisonKind.value === "previous" ? previousLabel.value : "Year to date"));
const showCompare = computed(() => comparisonKind.value !== "none" && props.statement?.toDateRevenue != null);
/** The comparative line under a statement headline. Absent when the period has no comparative. */
const compareSub = (n: number | null) => (n === null || !showCompare.value ? undefined : `${fmtUsd(n)} ${compareLabel.value === "Year to date" ? "year to date" : compareLabel.value}`);

/** Months of the comparative window the sweep has not reached — a stated absence beside the column. */
const comparisonMissing = computed(() => props.statement?.comparison?.monthsMissing ?? []);

/**
 * Find an account by name or code. It narrows the rows already on screen and hides a section with
 * nothing left in it; the totals in each heading are still the whole section's, because a search
 * is a way of looking, not a different statement.
 */
const search = ref("");
const query = computed(() => search.value.trim().toLowerCase());
const sections = computed<StatementSection[]>(() => {
  const all = props.statement?.sections ?? [];
  if (!query.value) return all;
  return all
    .map((s) => ({ ...s, lines: s.lines.filter((l) => (l.descr ?? "").toLowerCase().includes(query.value) || l.glid.includes(query.value)) }))
    .filter((s) => s.lines.length > 0);
});
const accountCount = computed(() => (props.statement?.sections ?? []).reduce((a, s) => a + s.lines.length, 0));
const shownCount = computed(() => sections.value.reduce((a, s) => a + s.lines.length, 0));
</script>

<template>
  <div class="print-target space-y-4">
    <p v-if="statementError" class="text-sm text-danger-600">
      The income statement could not be loaded. Try the period again in a moment.
    </p>

    <template v-else-if="statement">
      <div class="print-hide grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Earned" :value="fmtUsd(statement.revenue)" :sub="compareSub(statement.toDateRevenue)" />
        <StatCard label="Spent" :value="fmtUsd(statement.expenses)" :sub="compareSub(statement.toDateExpenses)" />
        <StatCard
          label="Kept"
          :value="fmtUsd(statement.net)"
          :sub="compareSub(statement.toDateNet)"
          :sub-tone="statement.net < 0 ? 'text-danger-600' : undefined"
        />
      </div>

      <!-- A month the sweep reached mid-month is not a month the sweep has not reached: its rows
           are staged and real, and they are left out because part of a month reported as the
           month is a precise wrong answer (G11). -->
      <p v-if="statement.ledgerReason" class="text-sm text-warning-700">{{ statement.ledgerReason }}</p>
      <p v-if="statement.monthsMissing.length" class="text-sm text-warning-700">
        The McLeod sweep has not reached
        {{ statement.monthsMissing.join(", ") }}, so
        {{ statement.monthsMissing.length === 1 ? "that month is" : "those months are" }}
        missing from these figures.
      </p>
      <p v-if="statement.unrecognisedNet !== 0" class="text-sm text-warning-700">
        {{ fmtUsd(statement.unrecognisedNet) }} sits in an account group this report does not
        recognise. It is shown below and counted in neither total.
      </p>

      <!-- The family summary (G6) leads the statement. Ninety-four rows is the document the owner
           reconciles; ten rows is the answer a boss acts on, and the second cannot be derived from
           the first — the grouping is signed (see glFamilies.ts). Its comparative is the fleet
           report's own year to date, whatever the statement below compares with. -->
      <FamilySummaryTable
        v-if="fleet"
        :families="fleet.families"
        :show-to-date="fleet.statement.toDateRevenue !== null"
        :loading="fleetLoading"
      />

      <div class="print-hide flex flex-wrap items-center gap-3">
        <div class="w-full sm:w-72">
          <AppSearchField v-model="search" placeholder="Find an account or code…" label="Find an account" />
        </div>
        <AppSegmentedControl :model-value="compare" :options="COMPARE_OPTIONS" label="Compare the statement to" @update:model-value="(v) => emit('update:compare', v as StatementCompare)" />
        <p v-if="query" class="text-xs text-ink-tertiary">{{ shownCount }} of {{ accountCount }} accounts</p>
      </div>
      <p v-if="comparisonKind !== 'none' && comparisonMissing.length" class="text-sm text-warning-700">
        The McLeod sweep has not reached {{ comparisonMissing.join(", ") }} in the comparison, so
        {{ comparisonMissing.length === 1 ? "that month is" : "those months are" }} missing from the
        {{ compareLabel }} column.
      </p>

      <IncomeStatementTable
        v-for="section in sections"
        :key="section.typeId ?? 'unclassified'"
        class="print-section"
        :section="section"
        :loading="statementLoading"
        :show-to-date="showCompare"
        :compare-label="compareLabel"
      />
      <p v-if="query && !sections.length" class="text-sm text-ink-secondary">
        No account matches “{{ search }}”. Try the code, or part of the name as McLeod prints it.
      </p>

      <p class="text-xs text-ink-tertiary">
        Straight from McLeod's own ledger, grouped and ordered the way McLeod prints it. Money is
        reported by whole calendar month, because that is the grain the ledger keeps — a period
        that covers part of a month shows the whole month
        <template v-if="statement.monthsCovered.length">
          ({{ statement.monthsCovered.join(", ") }})</template
        >.
        <template v-if="showCompare && comparisonKind === 'ytd'">Year to date runs from {{ statement.toDateFrom }}.</template>
        <template v-else-if="showCompare">The comparison column is {{ compareLabel }}.</template>
      </p>
    </template>

    <p v-else class="text-sm text-ink-secondary">Loading the income statement…</p>
  </div>
</template>
