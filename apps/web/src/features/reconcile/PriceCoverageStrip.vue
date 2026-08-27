<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@silvicom/ui";
import { usePriceCoverageQuery, pricedRangeIsNarrower } from "./usePriceCoverage";
import { pct1 } from "./format";

/**
 * Which days in this window can be priced — and an offer to look only at those.
 *
 * ── WHY A STRIP AND NOT A COUNT ──────────────────────────────────────────────────────────────────
 * The tab already said "1,409 of 5,552 fills had no quote in range". That is true, and it tells the
 * reader nothing they can act on: which days? Contiguous or scattered? Did the reports stop, or is one
 * missing in the middle? Measured on production the answer was "they start on 2026-08-02 and there is
 * nothing before it", which is a completely different problem from four scattered Mondays — and the
 * count alone cannot distinguish them.
 *
 * ── AND WHY THE WINDOW IS OFFERED, NOT MOVED ─────────────────────────────────────────────────────
 * The obvious fix is to default the tab to the priced range. It is the wrong fix: the window belongs to
 * the reader, it is in the URL so it can be sent to somebody, and a page that silently narrows it
 * produces a figure the recipient cannot reproduce from the link they were given. So the offer is a
 * button that changes the same filter the reader controls, and it says what it will do first.
 */
const props = defineProps<{ from: string; to: string }>();
const emit = defineEmits<{ narrow: [from: string, to: string] }>();

const window = computed(() => ({ from: props.from, to: props.to }));
const { data: coverage, isLoading } = usePriceCoverageQuery(window);

const share = computed(() => {
  const c = coverage.value;
  return !c || c.days.length === 0 ? null : (c.covered + c.carried) / c.days.length;
});
const canNarrow = computed(() => pricedRangeIsNarrower(coverage.value));

/** One cell per day. Three states, because "carried forward" is a weaker claim than "quoted today". */
const cells = computed(() =>
  (coverage.value?.days ?? []).map((d) => ({
    day: d.day,
    tone:
      d.quotedSites > 0 ? "bg-success-500"
      : d.staleDays != null && d.staleDays <= 1 ? "bg-success-200"
      : "bg-edge-strong",
    title:
      d.quotedSites > 0 ? `${d.day} — ${d.quotedSites} stations quoted`
      : d.staleDays != null && d.staleDays <= 1 ? `${d.day} — carried forward from the day before`
      : `${d.day} — no quote can reach this day`,
  })),
);
</script>

<template>
  <BaseCard v-if="!isLoading && coverage && coverage.days.length" padding="sm">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h4 class="text-sm font-semibold text-ink">Which days can be priced</h4>
        <p class="mt-1 max-w-2xl text-sm text-ink-muted">
          A fill can only be scored against a quote from that station's daily price report.
          <template v-if="coverage.uncovered > 0">
            {{ coverage.uncovered }} of {{ coverage.days.length }} days in this window have no report
            close enough to reach them, so nothing bought on them appears in the figures above.
          </template>
          <template v-else>Every day in this window is covered.</template>
        </p>
      </div>
      <div class="shrink-0 text-right">
        <p class="text-lg font-semibold text-ink">{{ pct1(share) }}</p>
        <p class="text-2xs text-ink-tertiary">of days covered</p>
      </div>
    </div>

    <!-- One cell per day, oldest first. Solid is a report issued that day; pale is one carried
         forward from the day before; grey is a day no quote reaches. -->
    <div class="mt-3 flex flex-wrap gap-0.5" role="img" :aria-label="`Price report coverage, ${coverage.covered} of ${coverage.days.length} days`">
      <span v-for="c in cells" :key="c.day" :title="c.title" class="h-3 w-2 rounded-detail" :class="c.tone" />
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-tertiary">
      <span class="flex items-center gap-1"><span class="h-2 w-2 rounded-detail bg-success-500" /> report that day</span>
      <span class="flex items-center gap-1"><span class="h-2 w-2 rounded-detail bg-success-200" /> carried forward</span>
      <span class="flex items-center gap-1"><span class="h-2 w-2 rounded-detail bg-edge-strong" /> no quote</span>
    </div>

    <div v-if="canNarrow" class="mt-3 flex flex-wrap items-center gap-3 border-t border-edge-subtle pt-3">
      <p class="min-w-0 flex-1 text-sm text-ink-secondary">
        Quotes reach back to <strong class="text-ink">{{ coverage.firstPricedDay }}</strong>. Narrowing to
        the days that can be priced makes every figure above cover the whole window it describes.
      </p>
      <BaseButton
        variant="secondary"
        @click="emit('narrow', coverage.firstPricedDay!, coverage.lastPricedDay ?? to)"
      >
        Show the priced range
      </BaseButton>
    </div>
  </BaseCard>
</template>
