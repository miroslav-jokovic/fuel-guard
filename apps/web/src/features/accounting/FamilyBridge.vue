<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import type { FamilyRow, FamilySummaryResponse } from "./useFleetReport";

/**
 * Where every dollar went (R4, D-FRUI4): one bar of the ten expense families the owner signed
 * (G6, `glFamilies.ts`) plus what was kept, each as its share of what was earned, and the list
 * beneath it with the dollars, the per-mile figure and the share.
 *
 * It is the Overview's answer to "where did the money go" — the family summary on the statement
 * tab is the same money as a table, this is the same money as a shape. Nothing is computed here
 * that the harness does not expose: each family's `pctOfRevenue` is the report's, and Kept's share
 * is net over revenue, the one division the page makes because the harness returns both terms.
 *
 * ── Colour ────────────────────────────────────────────────────────────────────────────────────
 * One hue at graded opacity, largest family darkest (D-FRUI7): ten distinct hues cannot pass the
 * colour-vision separation the chart gate enforces, and an ordered ramp is the honest encoding of
 * an ordered list. Identity never rests on the hue — every segment has its row beneath, with the
 * swatch beside the name. Kept is the only second hue, because it is the only second meaning. The
 * steps are brand-ramp utilities with alpha rather than the chart's `--viz-*` roles, which are not
 * exposed as Tailwind colours; a segment is CSS, not canvas. A family the owner has not yet filed
 * ("Not yet grouped", `isUnassigned`) wears the warning tone so it is never mistaken for a ruled one.
 */

const props = defineProps<{
  families: FamilySummaryResponse;
  revenue: number;
  net: number;
  loading?: boolean;
}>();

// Tailwind must see each class literally to emit it, so these are literals, never templates.
const STEPS = [
  "bg-brand-700/90",
  "bg-brand-600/80",
  "bg-brand-600/65",
  "bg-brand-500/60",
  "bg-brand-500/48",
  "bg-brand-500/38",
  "bg-brand-400/40",
  "bg-brand-400/30",
  "bg-brand-400/22",
  "bg-brand-300/30",
] as const;
const KEPT_CLASS = "bg-success-500/75";
const UNASSIGNED_CLASS = "bg-warning-500/70";

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtPct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);
const fmtRate = (n: number | null) =>
  n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 });

interface Segment {
  key: string;
  label: string;
  swatch: string;
  amount: number;
  pct: number | null;
  perMile: number | null;
  accounts: number;
  unassigned: boolean;
}

const rows = computed<Segment[]>(() =>
  props.families.expense.map((f: FamilyRow, i: number) => ({
    key: f.key,
    label: f.label,
    swatch: f.isUnassigned ? UNASSIGNED_CLASS : (STEPS[Math.min(i, STEPS.length - 1)] as string),
    amount: f.amount,
    pct: f.pctOfRevenue,
    perMile: f.perMile,
    accounts: f.accounts,
    unassigned: f.isUnassigned,
  })),
);

/** Kept as a share of earned. Absent when the fleet spent more than it earned — there is no slice to draw. */
const keptPct = computed(() => (props.revenue > 0 && props.net > 0 ? (props.net / props.revenue) * 100 : null));
const keptPerMile = computed(() => {
  const f = props.families.expense.find((x) => x.perMile != null && x.amount > 0);
  // Per mile for Kept is net ÷ miles; the miles are implied by any family's amount ÷ perMile.
  return f && f.perMile ? props.net / (f.amount / f.perMile) : null;
});
const spentPct = computed(() => props.families.expense.reduce((a, f) => a + (f.pctOfRevenue ?? 0), 0));
const width = (pct: number | null) => `${Math.max(0, Math.min(100, pct ?? 0))}%`;
</script>

<template>
  <BaseCard>
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold text-ink">Where every dollar went</h3>
      <p class="text-xs text-ink-tertiary">of <span class="tabular-nums">{{ fmtUsd(revenue) }}</span> earned · ten families the owner signed</p>
    </div>

    <!-- The bar. Decorative to a screen reader: the list beneath carries every figure. A 2px
         surface gap separates segments, never a stroke (dataviz: the gap is the mechanism). -->
    <div v-if="!loading" class="mt-3 flex h-7 gap-0.5" aria-hidden="true">
      <span
        v-for="r in rows"
        :key="r.key"
        :class="['block h-full first:rounded-l-detail', r.swatch]"
        :style="{ width: width(r.pct) }"
        :title="`${r.label} ${fmtPct(r.pct)}`"
      />
      <span
        v-if="keptPct != null"
        :class="['block h-full rounded-r-detail', KEPT_CLASS]"
        :style="{ width: width(keptPct) }"
        :title="`Kept ${fmtPct(keptPct)}`"
      />
    </div>
    <div v-else class="mt-3 h-7 animate-pulse rounded-detail bg-surface-muted" />

    <dl class="mt-3">
      <div class="grid grid-cols-[0.75rem_1fr_auto_auto_auto] items-center gap-x-3 pb-1 text-2xs font-medium uppercase tracking-wide text-ink-tertiary">
        <span />
        <span>Family</span>
        <span class="text-right">This period</span>
        <span class="text-right">Per mile</span>
        <span class="text-right">Of earned</span>
      </div>
      <div
        v-for="r in rows"
        :key="r.key"
        class="grid grid-cols-[0.75rem_1fr_auto_auto_auto] items-center gap-x-3 border-t border-edge-subtle py-1.5 text-sm"
      >
        <span :class="['size-3 rounded-detail', r.swatch]" aria-hidden="true" />
        <dt :class="r.unassigned ? 'text-warning-700' : 'text-ink'">
          {{ r.label }}
          <span class="ml-1 text-2xs text-ink-tertiary" :title="`${r.accounts} McLeod account${r.accounts === 1 ? '' : 's'} in this family`">{{ r.accounts }}</span>
        </dt>
        <dd class="text-right font-medium tabular-nums text-ink">{{ fmtUsd(r.amount) }}</dd>
        <dd class="text-right tabular-nums text-ink-secondary">{{ fmtRate(r.perMile) }}</dd>
        <dd class="text-right tabular-nums text-ink-secondary">{{ fmtPct(r.pct) }}</dd>
      </div>
      <div class="grid grid-cols-[0.75rem_1fr_auto_auto_auto] items-center gap-x-3 border-t border-edge py-1.5 text-sm font-semibold">
        <span :class="['size-3 rounded-detail', KEPT_CLASS]" aria-hidden="true" />
        <dt :class="net < 0 ? 'text-danger-700' : 'text-ink'">{{ net < 0 ? "Lost" : "Kept" }}</dt>
        <dd class="text-right tabular-nums" :class="net < 0 ? 'text-danger-700' : 'text-ink'">{{ fmtUsd(net) }}</dd>
        <dd class="text-right tabular-nums text-ink-secondary">{{ fmtRate(keptPerMile) }}</dd>
        <dd class="text-right tabular-nums" :class="net < 0 ? 'text-danger-700' : 'text-ink'">{{ keptPct == null ? "—" : fmtPct(keptPct) }}</dd>
      </div>
    </dl>

    <p v-if="net < 0" class="mt-2 text-xs text-danger-700">
      The families add to {{ fmtPct(spentPct) }} of what was earned: the fleet spent more than it earned this period, so there is no kept share to draw.
    </p>
    <p v-else class="mt-2 text-xs text-ink-tertiary">
      The families add up to the income statement to the cent. The statement tab has the same money in McLeod's own accounts.
    </p>
  </BaseCard>
</template>
