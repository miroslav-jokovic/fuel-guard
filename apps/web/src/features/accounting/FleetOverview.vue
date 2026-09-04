<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import StatCard from "@/components/ui/StatCard.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import type { FleetReportResponse } from "./useFleetReport";

/**
 * The overview (G5) — what the company earned, spent and kept over a period, and each of those per
 * mile, with contractors kept in their own column.
 *
 * Written for a reader whose first language is not English and whose question is "did we make money
 * and where did it go": the plain word leads, the industry term sits in the hover, and the method
 * is one sentence under the table rather than a paragraph above it.
 *
 * Nothing is computed here. Every figure comes from `computeFleetReport`, which is the only place
 * the arithmetic lives, and a rate that arrives as `null` prints as a dash with the reason beside
 * it — never as $0.00, which is a plausible number and a wrong one.
 */

const props = defineProps<{ report: FleetReportResponse; loading?: boolean }>();

/**
 * A period whose ledger months were all withheld has no figures — not zero ones (G11).
 *
 * Measured 2026-09-03: the page opens on the last full calendar month, which that morning was
 * August, and August's ledger held eleven lines swept four days before the month ended. Every card
 * below would have read $0 earned, $8,430 spent, −$8,430 kept: arithmetically correct over the rows
 * that were there, and not a fact about August. A zero in a money column is a claim.
 */
const noReportableMonth = computed(
  () => props.report.monthsCovered.length === 0 && props.report.ledgerReason !== null,
);

const fmtUsd = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtRate = (n: number | null) =>
  n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const fmtMiles = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString());
const fmtCount = (n: number | null) => (n == null ? "—" : n.toLocaleString());

/**
 * Three columns, one row per figure — the shape of the question rather than the shape of the data.
 * A boss compares company against contractors down a column; a table with trucks as rows would make
 * him compare across a hundred and seventy of them instead.
 */
interface Row {
  key: string;
  label: string;
  hint: string;
  company: string;
  ownerOperator: string;
  total: string;
  emphasis?: boolean;
}

const rows = computed<Row[]>(() => {
  const r = props.report;
  const line = (
    key: string,
    label: string,
    hint: string,
    pick: (c: typeof r.total) => string,
    emphasis = false,
  ): Row => ({
    key,
    label,
    hint,
    company: pick(r.company),
    ownerOperator: pick(r.ownerOperator),
    total: pick(r.total),
    emphasis,
  });
  return [
    line("trucks", "Trucks", "Trucks Samsara measured miles for in this period", (c) => fmtCount(c.trucks)),
    line("miles", "Miles driven", "Measured by Samsara — includes miles run empty", (c) => fmtMiles(c.miles)),
    line("revenue", "Earned", "Revenue, straight from McLeod's ledger", (c) => fmtUsd(c.revenue)),
    line("expenses", "Spent", "Every expense account in the ledger for this period", (c) => fmtUsd(c.expenses)),
    line("net", "Kept", "Earned less spent — net income", (c) => fmtUsd(c.net), true),
    line("revenuePerMile", "Earned per mile", "Revenue ÷ miles driven", (c) => fmtRate(c.revenuePerMile)),
    line("costPerMile", "Spent per mile", "Cost per mile driven — the figure a rate is judged against", (c) => fmtRate(c.costPerMile)),
    line("netPerMile", "Kept per mile", "What is left on every mile the fleet ran", (c) => fmtRate(c.netPerMile), true),
  ];
});

const columns: DataTableColumn[] = [
  { key: "label", label: "" },
  { key: "company", label: "Our trucks", numeric: true },
  { key: "ownerOperator", label: "Contractors", numeric: true },
  { key: "total", label: "Everything", numeric: true },
];

/** The contractor column's own arithmetic, so a reader can check the split rather than trust it. */
const contractorNote = computed(() => {
  const b = props.report.ownerOperatorBasis;
  if (!b.trucks.length) return null;
  return `${b.trucks.length} contractor truck${b.trucks.length === 1 ? "" : "s"} · ${fmtUsd(b.loadRevenue)} earned on their loads, plus ${fmtUsd(b.deductionIncome)} we charged them · ${fmtUsd(b.pay)} paid out`;
});
</script>

<template>
  <div class="space-y-4">
    <div
      v-if="noReportableMonth"
      class="rounded-control bg-warning-50 px-4 py-3 text-sm text-warning-700 ring-1 ring-inset ring-warning-600/20"
    >
      <p class="font-semibold">There are no figures for this period yet.</p>
      <p class="mt-1">{{ report.ledgerReason }}</p>
      <p class="mt-1 text-warning-700/80">
        Pick a period that ends in a finished month, or run the McLeod financial sweep again now that
        this one has closed.
      </p>
    </div>

    <template v-else>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        label="Earned"
        :value="fmtUsd(report.total.revenue)"
        :sub="report.total.revenuePerMile === null
          ? 'per-mile figure not available for this period'
          : `${fmtRate(report.total.revenuePerMile)} per mile driven`"
      />
      <StatCard
        label="Spent"
        :value="fmtUsd(report.total.expenses)"
        :sub="report.total.costPerMile === null
          ? 'per-mile figure not available for this period'
          : `${fmtRate(report.total.costPerMile)} per mile driven`"
      />
      <StatCard
        label="Kept"
        :value="fmtUsd(report.total.net)"
        :sub="report.total.netPerMile === null
          ? 'per-mile figure not available for this period'
          : `${fmtRate(report.total.netPerMile)} per mile driven`"
        :sub-tone="report.total.net < 0 ? 'text-danger-600' : undefined"
      />
    </div>

    <BaseCard padding="none">
      <DataTable embedded :columns="columns" :rows="rows" row-key="key" :loading="loading">
        <template #cell-label="{ row }">
          <span :title="row.hint" :class="row.emphasis ? 'font-semibold text-ink' : 'text-ink-secondary'">
            {{ row.label }}
          </span>
        </template>
        <template #cell-company="{ row }">
          <span class="tabular-nums" :class="row.emphasis ? 'font-semibold text-ink' : 'text-ink'">{{ row.company }}</span>
        </template>
        <template #cell-ownerOperator="{ row }">
          <span class="tabular-nums text-ink-secondary">{{ row.ownerOperator }}</span>
        </template>
        <template #cell-total="{ row }">
          <span class="tabular-nums" :class="row.emphasis ? 'font-semibold text-ink' : 'text-ink'">{{ row.total }}</span>
        </template>
      </DataTable>
    </BaseCard>

    <p v-if="contractorNote" class="text-xs text-ink-tertiary">{{ contractorNote }}</p>

    <!-- The two denominators (G9). Miles driven is what the fleet burned; miles billed is what the
         loads were priced on, and the gap between them is what running empty costs. -->
    <div v-if="report.emptyPct !== null" class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        label="Miles billed"
        :value="fmtMiles(report.billedMiles)"
        :sub="`the miles the loads were priced on`"
      />
      <StatCard
        label="Miles with no load"
        :value="fmtMiles(report.emptyMiles)"
        :sub="`${report.emptyPct}% of everything driven`"
      />
      <StatCard
        label="Earned per billed mile"
        :value="fmtRate(report.revenuePerBilledMile)"
        sub="what the loads paid, before empty miles are counted"
      />
    </div>

    <p class="text-xs text-ink-tertiary">
      Money comes from McLeod's ledger and miles from Samsara. Nothing here is estimated or shared
      out: what a column shows is what that side of the fleet earned and was paid.
      <template v-if="report.monthsCovered.length">
        Covering {{ report.monthsCovered.join(", ") }}.
      </template>
      <template v-if="report.monthsMissing.length">
        The McLeod sweep has not reached {{ report.monthsMissing.join(", ") }} yet.
      </template>
      <template v-if="report.ledgerReason">{{ report.ledgerReason }}</template>
    </p>
    </template>
  </div>
</template>
