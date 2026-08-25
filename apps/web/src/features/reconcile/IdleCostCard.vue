<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { useIdleBreakdown } from "@/composables/useIdleBreakdown";
import { useIdleCostBasis } from "@/composables/useIdleCostBasis";
import { usd, gal, pct1 } from "./format";

/**
 * What idling cost — and how much of it anyone could have done anything about.
 *
 * ── THE MISTAKE THIS CARD REPLACES ──────────────────────────────────────────────────────────────
 * Its first version multiplied `vehicle_engine_days.idle_sec` by a burn rate and printed the whole
 * figure in red as fuel "burned standing still". That is the every-truck-is-avoidable over-count
 * `docs/plans/IDLE-AVOIDABLE-HOS.md` exists to kill, reintroduced on a second page. A driver asleep in
 * a bunk with no APU is not wasting fuel; they have no alternative, and the plan is explicit that those
 * trucks are not blamed.
 *
 * ── THE THREE NUMBERS, AND WHY IT IS THREE ──────────────────────────────────────────────────────
 *   Idle fuel    every idling gallon. A fact about the fuel bill, stated neutrally — it is a cost of
 *                running trucks, not an accusation.
 *   Avoidable    idle on trucks with an ADMIN-CONFIRMED APU or Optimized Idle, judged by
 *                `computeAvoidable` with the HOS duty overlay and the temperature envelope. The only
 *                number here that is anybody's fault, and the only one shown in red.
 *   Reducible    what the same idle would be worth if the trucks that lack the equipment had it. The
 *                capex case, not a performance one — counted separately for exactly that reason.
 *
 * Read through `useIdleBreakdown`, the same composable the Idling page scores from, so the two surfaces
 * cannot disagree about what an idle hour was worth or whose it was.
 */
const props = defineProps<{ from: string; to: string }>();

const costBasis = useIdleCostBasis();
const filter = computed(() => ({ from: props.from, to: `${props.to}T23:59:59.999Z` }));
const { data, isLoading, isError } = useIdleBreakdown(filter, costBasis);

const fleet = computed(() => data.value?.fleet ?? null);
/** Trucks the equipment flags exclude from `avoidable` — the population the capex case is about. */
const unequipped = computed(() => {
  const f = fleet.value;
  return f ? Math.max(0, f.totalTrucks - f.reducibleTrucks) : 0;
});
</script>

<template>
  <BaseCard>
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold text-ink">Idling</h3>
      <p v-if="fleet" class="text-xs text-ink-muted">
        {{ fleet.confidentTrucks }} of {{ fleet.totalTrucks }} trucks measured with enough coverage to judge
      </p>
    </div>

    <p v-if="isLoading" class="mt-2 text-sm text-ink-muted">Loading…</p>
    <p v-else-if="isError" class="mt-2 text-sm text-danger-700">Couldn't load the idle breakdown.</p>
    <p v-else-if="!fleet || fleet.idleH === 0" class="mt-2 text-sm text-ink-muted">
      No idle measured in this period.
    </p>

    <template v-else>
      <p class="mt-2 text-sm text-ink-secondary">
        The fleet idled <span class="font-medium text-ink">{{ gal(fleet.idleH) }} hours</span> —
        <span class="font-medium text-ink">{{ pct1(fleet.idlePct / 100) }}</span> of every hour an engine was running.
        Most of that is not waste: only a truck with a confirmed APU or Optimized Idle had an alternative to running
        the main engine, and just {{ fleet.reducibleTrucks }} of {{ fleet.totalTrucks }} carry one.
      </p>

      <dl class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div class="rounded-control bg-surface-muted px-3 py-2">
          <dt class="text-xs text-ink-muted">Idle fuel</dt>
          <dd class="mt-0.5 text-lg font-bold text-ink">{{ gal(fleet.idleH) }} h</dd>
          <dd class="text-2xs text-ink-tertiary">a cost of running trucks, not a fault</dd>
        </div>
        <div class="rounded-control bg-danger-50 px-3 py-2 ring-1 ring-danger-100">
          <dt class="text-xs text-danger-700">Avoidable</dt>
          <dd class="mt-0.5 text-lg font-bold text-danger-700">{{ usd(fleet.avoidableUsd) }}</dd>
          <dd class="text-2xs text-danger-700">
            {{ gal(fleet.avoidableH) }} h on trucks that had an alternative
          </dd>
        </div>
        <div class="rounded-control bg-caution-50 px-3 py-2 ring-1 ring-caution-100">
          <dt class="text-xs text-caution-800">Reducible</dt>
          <dd class="mt-0.5 text-lg font-bold text-caution-800">{{ usd(fleet.reducibleUsd) }}</dd>
          <dd class="text-2xs text-caution-800">
            if the {{ unequipped }} trucks without the equipment had it
          </dd>
        </div>
      </dl>

      <p class="mt-3 text-xs text-ink-tertiary">
        Avoidability comes only from an admin-confirmed APU or Optimized Idle on the Vehicles page — a diesel APU is
        invisible to telematics, so a truck resting engine-off cannot be told from one simply shut down, and learned
        behaviour is never allowed to make idle somebody's fault. Trucks with thin engine-feed coverage are excluded
        from the totals rather than guessed at.
      </p>
    </template>
  </BaseCard>
</template>
