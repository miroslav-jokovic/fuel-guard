<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import type { FleetReportResponse } from "./useFleetReport";

/**
 * Our trucks, contractors, everything — the three-column split of the period (G5, D-FLEET7), moved
 * from the Overview to the Contractors tab at R4 (D-FRUI6), where it is the question being asked:
 * how much of the month was the company's own fleet and how much the contractors'.
 *
 * Written for a reader whose first language is not English: the plain word leads, the industry
 * term sits in the hover. Nothing is computed here. A rate that arrives as `null` prints as a dash
 * (D-FIN10), never as $0.00. It is a definition list rather than a `DataTable` because it is a
 * summary panel with eight fixed rows, and the tab beneath it already holds the one table a tab
 * gets (owner ruling 2026-08-29).
 */

const props = defineProps<{ report: FleetReportResponse }>();

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtRate = (n: number | null) =>
  n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const fmtMiles = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString());
const fmtCount = (n: number | null) => (n == null ? "—" : n.toLocaleString());

interface Row {
  key: string;
  label: string;
  hint: string;
  company: string;
  ownerOperator: string;
  total: string;
  emphasis?: boolean;
  rule?: boolean;
}

const rows = computed<Row[]>(() => {
  const r = props.report;
  const line = (key: string, label: string, hint: string, pick: (c: typeof r.total) => string, emphasis = false, rule = false): Row => ({
    key, label, hint, company: pick(r.company), ownerOperator: pick(r.ownerOperator), total: pick(r.total), emphasis, rule,
  });
  return [
    line("trucks", "Trucks", "Trucks Samsara measured miles for in this period", (c) => fmtCount(c.trucks)),
    line("miles", "Miles driven", "Measured by Samsara — includes miles run empty", (c) => fmtMiles(c.miles)),
    line("revenue", "Earned", "Revenue, straight from McLeod's ledger", (c) => fmtUsd(c.revenue), false, true),
    line("expenses", "Spent", "Every expense account in the ledger for this period", (c) => fmtUsd(c.expenses)),
    line("net", "Kept", "Earned less spent — net income", (c) => fmtUsd(c.net), true),
    line("revenuePerMile", "Earned per mile", "Revenue ÷ miles driven", (c) => fmtRate(c.revenuePerMile), false, true),
    line("costPerMile", "Spent per mile", "Cost per mile driven — the figure a rate is judged against", (c) => fmtRate(c.costPerMile)),
    line("netPerMile", "Kept per mile", "What is left on every mile the fleet ran", (c) => fmtRate(c.netPerMile), true),
  ];
});

/** The contractor column's own arithmetic, so a reader can check the split rather than trust it. */
const contractorNote = computed(() => {
  const b = props.report.ownerOperatorBasis;
  if (!b.trucks.length) return null;
  return `${b.trucks.length} contractor truck${b.trucks.length === 1 ? "" : "s"} · ${fmtUsd(b.loadRevenue)} earned on their loads, plus ${fmtUsd(b.deductionIncome)} we charged them · ${fmtUsd(b.pay)} paid out`;
});
</script>

<template>
  <BaseCard>
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold text-ink">Our trucks and contractors</h3>
      <p class="text-xs text-ink-tertiary">contractors are paid a share of each load and carry none of the company's costs</p>
    </div>
    <dl class="mt-3 text-sm">
      <div class="grid grid-cols-[1fr_8rem_8rem_8rem] items-baseline gap-x-4 pb-1 text-2xs font-medium uppercase tracking-wide text-ink-tertiary">
        <span />
        <span class="text-right">Our trucks</span>
        <span class="text-right">Contractors</span>
        <span class="text-right">Everything</span>
      </div>
      <div
        v-for="row in rows"
        :key="row.key"
        :class="['grid grid-cols-[1fr_8rem_8rem_8rem] items-baseline gap-x-4 py-1', row.rule ? 'border-t border-edge' : '']"
      >
        <dt :title="row.hint" :class="row.emphasis ? 'font-semibold text-ink' : 'text-ink-secondary'">{{ row.label }}</dt>
        <dd :class="['text-right tabular-nums', row.emphasis ? 'font-semibold text-ink' : 'text-ink']">{{ row.company }}</dd>
        <dd class="text-right tabular-nums text-ink-secondary">{{ row.ownerOperator }}</dd>
        <dd :class="['text-right tabular-nums', row.emphasis ? 'font-semibold text-ink' : 'text-ink']">{{ row.total }}</dd>
      </div>
    </dl>
    <p v-if="contractorNote" class="mt-2 text-xs text-ink-tertiary">{{ contractorNote }}</p>
  </BaseCard>
</template>
