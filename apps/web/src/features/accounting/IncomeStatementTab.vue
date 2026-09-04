<script setup lang="ts">
import StatCard from "@/components/ui/StatCard.vue";
import FamilySummaryTable from "./FamilySummaryTable.vue";
import IncomeStatementTable from "./IncomeStatementTable.vue";
import type { FleetReportResponse } from "./useFleetReport";
import type { IncomeStatementResponse } from "./useIncomeStatement";

/**
 * The income statement tab (G3 + G6), lifted out of the page at R1 of the UI plan: the period's
 * ledger in the shape the owner's own printed McLeod P&L takes, with the ten-family summary above
 * it. Sections in McLeod's order, accounts by code inside each, and a row opens to show which parts
 * of McLeod posted it.
 *
 * Two queries feed it and both are passed in rather than issued here, so the page shell stays the
 * only place a period turns into a request: the statement is the whole ledger for the period, and
 * the family summary reads from the fleet report because that call holds the miles as well as the
 * lines (G6). A failed fetch is said in words, never swallowed into an empty state (D-FIN15).
 */

defineProps<{
  statement: IncomeStatementResponse | null;
  statementLoading: boolean;
  statementError: boolean;
  fleet: FleetReportResponse | null;
  fleetLoading: boolean;
}>();

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
/** The comparative line under a statement headline. Absent when the period has no wider window. */
const toDateSub = (n: number | null) => (n === null ? undefined : `${fmtUsd(n)} year to date`);
</script>

<template>
  <div class="space-y-4">
    <p v-if="statementError" class="text-sm text-danger-600">
      The income statement could not be loaded. Try the period again in a moment.
    </p>

    <template v-else-if="statement">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Earned" :value="fmtUsd(statement.revenue)" :sub="toDateSub(statement.toDateRevenue)" />
        <StatCard label="Spent" :value="fmtUsd(statement.expenses)" :sub="toDateSub(statement.toDateExpenses)" />
        <StatCard
          label="Kept"
          :value="fmtUsd(statement.net)"
          :sub="toDateSub(statement.toDateNet)"
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
           the first — the grouping is signed (see glFamilies.ts). -->
      <FamilySummaryTable
        v-if="fleet"
        :families="fleet.families"
        :show-to-date="statement.toDateRevenue !== null"
        :loading="fleetLoading"
      />

      <IncomeStatementTable
        v-for="section in statement.sections"
        :key="section.typeId ?? 'unclassified'"
        :section="section"
        :loading="statementLoading"
        :show-to-date="statement.toDateRevenue !== null"
      />

      <p class="text-xs text-ink-tertiary">
        Straight from McLeod's own ledger, grouped and ordered the way McLeod prints it. Money is
        reported by whole calendar month, because that is the grain the ledger keeps — a period
        that covers part of a month shows the whole month
        <template v-if="statement.monthsCovered.length">
          ({{ statement.monthsCovered.join(", ") }})</template
        >. Year to date runs from {{ statement.toDateFrom }}.
      </p>
    </template>

    <p v-else class="text-sm text-ink-secondary">Loading the income statement…</p>
  </div>
</template>
