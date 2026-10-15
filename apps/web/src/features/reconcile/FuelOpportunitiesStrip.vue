<script setup lang="ts">
/**
 * What is waiting to be reviewed, under the cost cards (FS-STRIP, Q-FSV15 ruling 1, design verdict
 * 2026-10-03: "lead with spending, the reason for its change, and ranked opportunities with a clear review
 * action").
 *
 * ── ONE ROW PER KIND, NO TOTAL, ON PURPOSE ───────────────────────────────────────────────────────
 * The kinds overlap and mean different things (see `summariseOpportunities`), so the strip says so in a
 * sentence instead of adding them. Each row is the findings inbox's own queue for that kind, in these
 * dates and for these trucks, and opens it — "review" is that inbox, where a finding is assigned,
 * evidenced and closed.
 *
 * ── WHAT IT WILL NOT SAY ─────────────────────────────────────────────────────────────────────────
 * Not "savings": an open finding is a claim or a price difference somebody still has to check. Not "0"
 * when the read failed: that is the `error` branch. (A caller without the fuel section never reaches this strip,
 * and is refused by the API: the Costs page and the route share one gate.)
 */
import { RouterLink } from "vue-router";
import { formatDisplayDate, type FuelOpportunity } from "@silvicom/shared";
import { QueryState } from "@silvicom/ui";
import { usd } from "./format";

const props = defineProps<{
  /** `undefined`: not loaded yet. */
  rows: FuelOpportunity[] | undefined;
  loading: boolean;
  error: boolean;
  from: string;
  to: string;
  vehicleIds: string[];
  /** Whether the Findings inbox opens for this caller (`useOpens`). */
  canOpenInbox: boolean;
  /**
   * `page` is the strip as the Fuel costs page draws it — its own heading, its own ringed list.
   * `card` is the same rows inside a Dashboard card (D-FO9, Fleet overview v3): the card supplies
   * the heading and the frame, so the strip drops both and keeps the rows, the link rule and the
   * "counted separately" caveat, which are the parts worth reusing.
   */
  variant?: "page" | "card";
}>();
/**
 * A failed read asks the page to read again (D-US5). It used to say "Reload to try again", which reset
 * everything else the page had open; the page owns the query, so its Retry refetches it.
 */
const emit = defineEmits<{ retry: [] }>();

const linkFor = (kind: string) => ({
  path: "/fuel-problems",
  query: { kind, from: props.from, to: props.to, ...(props.vehicleIds.length ? { trucks: props.vehicleIds.join(",") } : {}) },
});
const dollars = (o: FuelOpportunity) => (o.withAmount === 0 ? "no amount" : usd(o.amount));
const detail = (o: FuelOpportunity) =>
  [
    `${o.count.toLocaleString()} to review`,
    o.withAmount > 0 && o.withAmount < o.count ? `amount on ${o.withAmount.toLocaleString()} of them` : null,
    `oldest ${formatDisplayDate(o.oldest)}`,
  ].filter(Boolean).join(" · ");
</script>

<template>
  <section class="space-y-2" :aria-labelledby="variant === 'card' ? undefined : 'fuel-opportunities-heading'" :aria-label="variant === 'card' ? 'Open fuel findings' : undefined">
    <h3 v-if="variant !== 'card'" id="fuel-opportunities-heading" class="text-sm font-semibold text-ink">Open fuel findings</h3>

    <!-- Compact inside a Dashboard card, where the card is the frame; the block form on the page. -->
    <QueryState
      :loading="loading && rows === undefined"
      :error="error"
      :compact="variant === 'card'"
      loading-text="Loading the open findings…"
      error-text="Could not load the open findings."
      @retry="emit('retry')"
    >
    <p v-if="rows && rows.length === 0" class="text-sm text-ink-muted">
      Nothing is waiting for review in these dates.
    </p>

    <template v-else-if="rows">
      <ul :class="variant === 'card' ? 'divide-y divide-edge-subtle' : 'divide-y divide-edge rounded-surface bg-surface ring-1 ring-edge'">
        <li v-for="o in rows" :key="o.kind" class="flex items-center justify-between gap-4 py-3" :class="variant === 'card' ? 'first:pt-0' : 'px-4'">
          <div class="min-w-0">
            <RouterLink v-if="canOpenInbox" :to="linkFor(o.kind)" class="text-sm font-medium text-link hover:text-link-hover">
              {{ o.label }}
            </RouterLink>
            <p v-else class="text-sm font-medium text-ink">{{ o.label }}</p>
            <p class="text-xs text-ink-muted">{{ detail(o) }}</p>
          </div>
          <p class="shrink-0 text-base font-bold text-ink" data-testid="opportunity-amount">{{ dollars(o) }}</p>
        </li>
      </ul>
      <p class="text-xs text-ink-tertiary">
        Counted separately and not added up: one purchase can appear under more than one finding, and each is a
        claim or a price difference that still has to be checked, not money saved.
      </p>
    </template>
    </QueryState>
  </section>
</template>
