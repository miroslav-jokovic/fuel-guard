<script setup lang="ts">
/**
 * Discount capture, as one KPI on Spend & trend that opens the fills behind it (FUEL-C5, D-FUI4).
 *
 * ── WHY IT IS NO LONGER A TAB ───────────────────────────────────────────────────────────────────
 * "Were we billed what Pilot quoted" is a question about the fuel bill, which is what Spend & trend
 * is. As its own tab it was a destination somebody had to already know to visit, sitting in a strip
 * of eight; as a tile it is beside the spend it qualifies, and the answer is a number rather than a
 * click. D-FUI4: "Discount capture folds into Spend & trend as a KPI with drill-down."
 *
 * ── WHY THE FIGURE IS INLINE AND NOT IN A DRAWER ────────────────────────────────────────────────
 * The drill-down is a REPORT — two tables, seven and five columns, plus the price-coverage strip —
 * and this section's other reports are full width. C4's drawers hold ACTIONS (an upload, a repair),
 * where a 512px panel is right and the table is incidental. Reading is not acting, so this discloses
 * in place.
 *
 * ── WHY `StatCard`'s TOGGLE AND NOT A NEW CONTROL ───────────────────────────────────────────────
 * The tile is `StatCard :pressed`, which the primitive already renders as a `<button>` carrying its
 * state in `aria-pressed` (D-UI5). Hand-rolling a KPI card is the exact drift `StatCard` was
 * extracted to end — `SpendTrendTab`'s own comment records the four that were replaced. ⚠ A
 * disclosure would ideally carry `aria-expanded` rather than `aria-pressed`; both are valid for a
 * toggle button, and reusing the shared control beats inventing a second one that differs by an
 * attribute.
 *
 * ── AND WHY THE TILE IS NOT IN `SpendTrendTab`'s ROW ────────────────────────────────────────────
 * ⚠ That row is captioned "these describe the last complete week" and this figure covers the WHOLE
 * window. A tile whose scope differs from the caption above it is X8's defect in a smaller box, and
 * the audit that produced this plan found it twice already. It sits below the trend with its own
 * scope stated.
 */
import { computed, ref } from "vue";
import { analyzeContractCapture, type SpendLine } from "@silvicom/shared";
import StatCard from "@/components/ui/StatCard.vue";
import DiscountCaptureTab from "./DiscountCaptureTab.vue";
import { usd, pct1 } from "./format";

const props = defineProps<{ lines: SpendLine[]; from: string; to: string }>();
const emit = defineEmits<{ narrow: [from: string, to: string] }>();

/**
 * One `analyzeContractCapture` call for the tile; `DiscountCaptureTab` makes its own for the report.
 * Two renderers over one PURE function of one input is not two sources of truth — it is the same
 * answer computed twice — and the alternative was passing the analysis down, which would have made
 * the tab unmountable on its own and broken the suite that mounts it.
 */
const capture = computed(() => analyzeContractCapture(props.lines));

/** Nothing to disclose, and nothing to claim: the tab renders its own "cannot be priced yet" card. */
const measurable = computed(() => capture.value.measuredLines > 0);

const open = ref(false);

const value = computed(() => usd(Math.abs(capture.value.netVariance)));
const direction = computed(() => (capture.value.netVariance >= 0 ? "over contract" : "under contract"));
/**
 * The scope, in the tile's own `sub` — beside the figure, never a paragraph away.
 *
 * On production 2026-08-25 this headline covered $849,913 of $3,056,926 — 27.8% of the window's fuel
 * — while reading as a fleet-wide verdict. A dollar figure whose denominator is somewhere else is
 * the defect this section spent FUEL-T5 removing, and a tile is the easiest place to reintroduce it.
 */
const sub = computed(() => {
  const share = capture.value.measuredSpendShare;
  if (share == null) return direction.value;
  return `${direction.value} · ${pct1(share)} of this window's fuel priced`;
});
const subTone = computed(() =>
  (capture.value.measuredSpendShare ?? 1) < 0.75 ? "text-caution-800" : undefined,
);
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-1 gap-3 sm:max-w-sm">
      <StatCard
        label="Billed against contract"
        :value="measurable ? value : '—'"
        :sub="measurable ? sub : 'no fill in this window matched a quote'"
        :sub-tone="subTone"
        :muted="!measurable"
        :pressed="open"
        @toggle="open = !open"
      />
    </div>

    <!-- The fills behind it, unchanged: the same component the tab rendered, with the same props. -->
    <DiscountCaptureTab
      v-if="open"
      :lines="lines"
      :from="from"
      :to="to"
      @narrow="(f, t) => emit('narrow', f, t)"
    />
  </div>
</template>
