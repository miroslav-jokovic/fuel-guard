<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { compareTrailing, discountMarketLink, weeklySpendSeries, type SpendLine } from "@fuelguard/shared";
import { usd, usd2, gal } from "./format";

/**
 * "Why did fuel cost more?" — as attribution rather than a number (plan §4.6).
 *
 * The four bars are an algebraic identity, not an estimate, so the residual is printed: a waterfall
 * whose parts don't sum to the whole invites the reader to distrust the attribution, and the
 * attribution is the point.
 *
 * ⚠ The discount↔retail correlation is shown BESIDE the rate bar deliberately. A rate bar on its own
 * reads as an accusation against the vendor. A strongly negative slope means the discount narrows as
 * the market rises — a rack-linked deal behaving normally — and that is a different conversation from
 * a repricing. Reading a monthly average as a repricing is a mistake this project already made once.
 */
const props = defineProps<{ lines: SpendLine[]; weeks?: number }>();

const bridge = computed(() => compareTrailing(props.lines, props.weeks ?? 4));
const series = computed(() => weeklySpendSeries(props.lines));
const link = computed(() => discountMarketLink(series.value));

const bars = computed(() => {
  const b = bridge.value;
  if (!b) return [];
  return [
    { key: "volume", label: "More gallons", detail: `${gal(b.after.gallons / b.after.weeks)} vs ${gal(b.before.gallons / b.before.weeks)} gal a week`, c: b.volume },
    { key: "market", label: "The market", detail: `posted price ${usd2(b.before.retailPerGal)} → ${usd2(b.after.retailPerGal)} a gallon`, c: b.market },
    { key: "rate", label: "Discount rate", detail: "same sites, a different deal", c: b.discountRate },
    { key: "mix", label: "Where we fuelled", detail: "same deals, a different share of gallons", c: b.discountMix },
  ];
});
/** Bar width is share of the LARGEST component, so a small bar stays visible. */
const widest = computed(() => Math.max(1, ...bars.value.map((b) => Math.abs(b.c.dollars))));
const pct = (n: number) => `${Math.max(2, (Math.abs(n) / widest.value) * 100).toFixed(1)}%`;

const linkReading = computed(() => {
  const s = link.value.slope;
  if (s == null) return null;
  if (s < -0.05) return "The discount narrows as the market rises — the signature of a rack-linked deal, not a repricing.";
  if (s > 0.05) return "The discount widens as the market rises, which a flat cents-off deal would not do.";
  return "The discount holds steady as the market moves — the signature of a flat cents-off deal.";
});
</script>

<template>
  <BaseCard>
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold text-ink">Why spend moved</h3>
      <p v-if="bridge" class="text-xs text-ink-muted">
        {{ bridge.before.label }} vs {{ bridge.after.label }} · {{ bridge.after.weeks }}-week averages
      </p>
    </div>

    <p v-if="!bridge" class="mt-3 text-sm text-ink-muted">
      Not enough history yet. A bridge needs {{ (props.weeks ?? 4) * 2 }} weeks of statements so it can compare
      {{ props.weeks ?? 4 }} against the {{ props.weeks ?? 4 }} before them — upload earlier weeks and this fills in.
    </p>

    <template v-else>
      <p class="mt-2 text-sm text-ink-secondary">
        Weekly fuel spend went
        <span class="font-medium text-ink">{{ usd(bridge.before.spend) }}</span> →
        <span class="font-medium text-ink">{{ usd(bridge.after.spend) }}</span>, a change of
        <span class="font-semibold text-ink">{{ usd(bridge.deltaSpend) }}</span> a week.
      </p>

      <dl class="mt-4 space-y-3">
        <div v-for="b in bars" :key="b.key" class="grid grid-cols-[9rem_1fr_7rem] items-center gap-3">
          <dt class="text-sm text-ink">
            {{ b.label }}
            <span class="block text-2xs text-ink-tertiary">{{ b.detail }}</span>
          </dt>
          <dd class="h-2 rounded-detail bg-surface-muted">
            <div
              class="h-2 rounded-detail"
              :class="b.c.dollars >= 0 ? 'bg-danger-200' : 'bg-success-200'"
              :style="{ width: pct(b.c.dollars) }"
            />
          </dd>
          <dd class="text-right text-sm font-medium tabular-nums" :class="b.c.dollars >= 0 ? 'text-danger-700' : 'text-success-700'">
            {{ usd(b.c.dollars) }}
            <span class="block text-2xs font-normal text-ink-tertiary">
              {{ b.c.share == null ? "—" : `${(b.c.share * 100).toFixed(0)}%` }}
            </span>
          </dd>
        </div>
      </dl>

      <p class="mt-3 border-t border-edge pt-3 text-xs text-ink-tertiary">
        The four add to {{ usd(bridge.deltaSpend) }} exactly (residual {{ usd2(bridge.residual) }}), decomposed by
        {{ bridge.groupedBy }}.
      </p>

      <p v-if="link.correlation != null" class="mt-2 text-xs text-ink-muted">
        Across {{ link.weeks }} weeks the captured discount tracks the posted price at
        <span class="font-medium text-ink-secondary">{{ link.correlation.toFixed(2) }}</span>
        ({{ usd2(link.slope ?? 0) }} of discount per $1.00 of posted price).
        {{ linkReading }}
      </p>
    </template>
  </BaseCard>
</template>
