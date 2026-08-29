<script setup lang="ts">
import { AppCard as BaseCard } from "@silvicom/ui";
import StatCard from "@/components/ui/StatCard.vue";
import type { CpmProvenance } from "./useCpm";

/**
 * The whole-fleet bottom line, straight out of McLeod's own ledger — every dollar, including the
 * ones no truck can carry: office payroll, lease cheques, interest. Proven to reproduce the owner's
 * printed income statement to the dollar (2026-08-28 reconciliation).
 *
 * It is a TAB rather than a card under the per-truck table because it answers a different question.
 * The table attributes what can be attributed; this states what the company actually earned and
 * spent, and the gap between them is unattributed overhead and the contractor pool — never missing
 * money. Read as a footnote under a table, that gap looked like an error.
 */
const props = defineProps<{ gl: CpmProvenance["glCheck"]; loading: boolean }>();

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
const fmtCpm = (n: number) => `$${(n / 100).toFixed(2)}`;
const monthList = () => props.gl.monthsCovered.join(", ");
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Money in" :value="fmtUsd(gl.revenue)" :sub="`the ledger for ${monthList()}`" :loading="loading" />
      <StatCard label="Money out" :value="fmtUsd(gl.expenses)" sub="every dollar, not only per-truck cost" :loading="loading" />
      <StatCard
        label="Profit"
        :value="fmtUsd(gl.net)"
        :sub="gl.net >= 0 ? 'what the company kept' : 'the company spent more than it earned'"
        :sub-tone="gl.net >= 0 ? 'text-success-700' : 'text-danger-700'"
        :loading="loading"
      />
      <StatCard label="Profit per mile" :value="fmtCpm(gl.netCpm)" sub="profit spread over the miles driven" :loading="loading" />
    </div>

    <BaseCard padding="sm">
      <p class="text-sm text-ink-secondary">
        These four figures are the company's real result for {{ monthList() }}. The per-truck table
        places every cost it can place on a truck; the difference between the two is company overhead
        that no truck carries, plus what the contractors hauled. It is never missing money.
      </p>
      <p v-if="gl.monthsMissing.length" class="mt-2 text-xs text-danger-600">
        The ledger has not been read yet for: {{ gl.monthsMissing.join(", ") }}. Figures for those
        months are incomplete.
      </p>
      <p v-if="Math.abs(gl.unclassifiedNet) > 0.01" class="mt-2 text-xs text-danger-600">
        {{ fmtUsd(gl.unclassifiedNet) }} sits in accounts the chart of accounts cannot classify —
        re-run the McLeod sweep.
      </p>
    </BaseCard>
  </div>
</template>
