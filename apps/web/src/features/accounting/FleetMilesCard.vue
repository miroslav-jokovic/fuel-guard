<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import type { FleetReportResponse } from "./useFleetReport";

/**
 * The two denominators (G9), as one bar (R4, D-FRUI4): the miles Samsara measured against the
 * miles McLeod billed, with the gap — the miles run with no load — as the share the reader acts
 * on. Plan §1.5.4: "the figure a boss can act on"; it used to be the third card row under a
 * footnote.
 *
 * Every figure is the report's own. When the period's mileage could not cover the fleet the
 * report carries no empty share (`emptyPct` null, D-FIN10), and this card prints the reason
 * instead of a bar that would be drawn from a denominator missing part of the fleet.
 */

const props = defineProps<{ report: FleetReportResponse; loading?: boolean }>();

const fmtMiles = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString());
const fmtRate = (n: number | null) =>
  n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const emptyWidth = computed(() => `${Math.max(0, Math.min(100, props.report.emptyPct ?? 0))}%`);
</script>

<template>
  <BaseCard>
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold text-ink">Miles driven and miles billed</h3>
      <p class="text-xs text-ink-tertiary">the gap is what running empty costs</p>
    </div>

    <template v-if="report.emptyPct != null">
      <dl class="mt-3 space-y-2 text-sm">
        <div class="flex items-baseline justify-between gap-3">
          <dt class="text-ink-secondary">Miles driven <span class="text-ink-tertiary" title="Measured by Samsara, empty miles included">(Samsara)</span></dt>
          <dd class="font-semibold tabular-nums text-ink">{{ fmtMiles(report.total.miles) }}</dd>
        </div>
        <!-- Driven is the whole track; the empty share overlays its right end in the spend hue,
             separated by a surface gap rather than a stroke. -->
        <div class="relative h-3 overflow-hidden rounded-detail bg-brand-500/70" aria-hidden="true">
          <span class="absolute inset-y-0 right-0 rounded-r-detail bg-caution-500/75 ring-2 ring-surface" :style="{ width: emptyWidth }" />
        </div>
        <div class="flex items-baseline justify-between gap-3">
          <dt class="text-ink-secondary">Miles billed <span class="text-ink-tertiary" title="McLeod's billed distance, re-dated to the day each load delivered">(McLeod)</span></dt>
          <dd class="font-semibold tabular-nums text-ink">{{ fmtMiles(report.billedMiles) }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-3">
          <dt class="text-ink-secondary">Run with no load <span class="text-ink-tertiary" title="Deadhead — miles driven that no load was priced on">(empty)</span></dt>
          <dd class="font-semibold tabular-nums text-caution-700">{{ fmtMiles(report.emptyMiles) }} · {{ report.emptyPct.toFixed(1) }}%</dd>
        </div>
      </dl>
      <dl class="mt-3 grid grid-cols-2 gap-3 border-t border-edge pt-3 text-sm">
        <div>
          <dt class="text-xs text-ink-tertiary">Earned per billed mile</dt>
          <dd class="font-semibold tabular-nums text-ink" title="What the loads were priced at, before empty miles are counted">{{ fmtRate(report.revenuePerBilledMile) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-ink-tertiary">Earned per mile driven</dt>
          <dd class="font-semibold tabular-nums text-ink" title="Revenue over every mile Samsara measured, empty miles included">{{ fmtRate(report.total.revenuePerMile) }}</dd>
        </div>
      </dl>
      <p class="mt-2 text-xs text-ink-tertiary">
        Cost per mile driven is what the fleet burned; revenue per mile billed is what the loads paid.
        Neither is ever called "per mile" alone.
      </p>
    </template>

    <p v-else class="mt-3 text-sm text-warning-700">
      No empty-mile figure for this period: {{ report.mileageReason ?? "Samsara did not measure the whole fleet, so miles driven cannot be set against miles billed." }}
    </p>
  </BaseCard>
</template>
