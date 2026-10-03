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
}>();

const linkFor = (kind: string) => ({
  path: "/findings",
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
  <section class="space-y-2" aria-labelledby="fuel-opportunities-heading">
    <h3 id="fuel-opportunities-heading" class="text-sm font-semibold text-ink">Open fuel findings</h3>

    <p v-if="error" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
      Couldn't load the open findings. Reload to try again.
    </p>
    <p v-else-if="loading && rows === undefined" class="text-sm text-ink-muted">Loading the open findings…</p>
    <p v-else-if="rows && rows.length === 0" class="text-sm text-ink-muted">
      Nothing is waiting for review in these dates.
    </p>

    <template v-else-if="rows">
      <ul class="divide-y divide-edge rounded-surface bg-surface ring-1 ring-edge">
        <li v-for="o in rows" :key="o.kind" class="flex items-center justify-between gap-4 px-4 py-3">
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
  </section>
</template>
