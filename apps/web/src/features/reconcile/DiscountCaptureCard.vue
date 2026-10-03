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
import { computed } from "vue";
import { contractHeadline, type ContractTotals, type SpendLine } from "@silvicom/shared";
import StatCard from "@/components/ui/StatCard.vue";
import DiscountCaptureTab from "./DiscountCaptureTab.vue";
import { usd, pct1 } from "./format";

const props = defineProps<{
  /** The tile's four sums, added up in the database (`fuel_contract_totals`, Q-FSV18). */
  totals: ContractTotals;
  /** The rows behind the tile. Read only once the tile is open, so empty and idle until then. */
  lines: SpendLine[];
  linesLoading?: boolean;
  linesError?: boolean;
  from: string;
  to: string;
}>();
/** Whether the fills behind the tile are showing. The page owns the request that waits on it. */
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ narrow: [from: string, to: string] }>();

/**
 * The tile is `contractHeadline` over the database's four sums; the fills under it are
 * `DiscountCaptureTab`, which makes its own `analyzeContractCapture` over the rows once they arrive, and
 * `analyzeContractCapture` takes its two shared figures from the same `contractHeadline`. Two renderers
 * over one formula is not two sources of truth.
 */
const capture = computed(() => contractHeadline(props.totals));

/** Nothing to disclose, and nothing to claim: the tab renders its own "cannot be priced yet" card. */
const measurable = computed(() => capture.value.measuredLines > 0);

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
        label="Paid vs Pilot quote"
        title="Billed against contract"
        :value="measurable ? value : '—'"
        :sub="measurable ? sub : 'no fill in this window matched a quote'"
        :sub-tone="subTone"
        :muted="!measurable"
        :pressed="open"
        @toggle="open = !open"
      />
    </div>

    <!-- The fills behind it, unchanged: the same component the tab rendered, with the same props. -->
    <p v-if="open && linesError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
      Couldn't load the fills behind this figure. Close it and open it again to retry.
    </p>
    <p v-else-if="open && linesLoading" class="text-sm text-ink-muted">Loading the fills behind this figure…</p>
    <DiscountCaptureTab
      v-else-if="open"
      :lines="lines"
      :from="from"
      :to="to"
      @narrow="(f, t) => emit('narrow', f, t)"
    />
  </div>
</template>
