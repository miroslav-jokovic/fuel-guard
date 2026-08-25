<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { MIN_IDLE_COVERAGE, type SpendPeriod } from "@fuelguard/shared";
import { usd, gal, pct1 } from "./format";

/**
 * What the fleet spent standing still.
 *
 * ── WHY IT SITS ON THE FUEL BILL AND NOT ONLY ON THE IDLING PAGE ────────────────────────────────
 * Idle is roughly half of engine-on time on this fleet, and it is bought with the same gallons as the
 * miles beside it. Reported only as a percentage on a separate page, it never meets the spend it is
 * part of; the question "why is fuel up" cannot be answered honestly without it.
 *
 * ── WHY IT IS VALUED AT THE PERIOD'S OWN PRICE ───────────────────────────────────────────────────
 * Not at a configured constant. An idle hour in a $5.22 week did not cost what an idle hour in a $3.96
 * week cost, and the whole point of putting this beside the fuel bill is that the two are comparable.
 *
 * ── WHY IT CAN REFUSE TO ANSWER ─────────────────────────────────────────────────────────────────
 * The Samsara engine feed was largely down from 2026-07-13 to 07-26 — 467 truck-days recorded against a
 * normal 1,100, each covering 10.9% of its day. Idle computed across that reads as a collapse in idling,
 * which is a broken sync being reported as an achievement. Below `MIN_IDLE_COVERAGE` this card says what
 * it does not know instead.
 */
const props = defineProps<{ periods: SpendPeriod[]; grainLabel: string }>();

/** Only periods the feed actually watched can be summed; the rest are named, not averaged in. */
const usable = computed(() => props.periods.filter((p) => p.idleUsable));
const withheld = computed(() => props.periods.filter((p) => !p.idleUsable && p.idleCoverage != null));

const totals = computed(() => {
  const rows = usable.value;
  const idleSec = rows.reduce((a, p) => a + p.idleSec, 0);
  const driveSec = rows.reduce((a, p) => a + p.driveSec, 0);
  const gallons = rows.reduce((a, p) => a + (p.idleGallons ?? 0), 0);
  const cost = rows.reduce((a, p) => a + (p.idleCost ?? 0), 0);
  const fuelSpend = rows.reduce((a, p) => a + p.spend, 0);
  return {
    hours: idleSec / 3600,
    share: idleSec + driveSec > 0 ? idleSec / (idleSec + driveSec) : null,
    gallons,
    cost,
    // Idle as a share of the fuel bill for the SAME periods — the comparison this card exists to make.
    ofSpend: fuelSpend > 0 ? cost / fuelSpend : null,
    perWeek: rows.length > 0 ? cost / rows.length : 0,
  };
});

const annualised = computed(() =>
  props.grainLabel === "week" ? totals.value.perWeek * 52 : props.grainLabel === "month" ? totals.value.perWeek * 12 : totals.value.perWeek * 365,
);
</script>

<template>
  <BaseCard>
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold text-ink">Fuel burned standing still</h3>
      <p class="text-xs text-ink-muted">
        {{ usable.length }} of {{ periods.length }} {{ grainLabel }}{{ periods.length === 1 ? "" : "s" }} measured
      </p>
    </div>

    <template v-if="usable.length">
      <p class="mt-2 text-sm text-ink-secondary">
        The fleet idled <span class="font-medium text-ink">{{ gal(totals.hours) }} hours</span> across the measured
        {{ grainLabel }}s — <span class="font-medium text-ink">{{ pct1(totals.share) }}</span> of every hour an engine
        was running — burning <span class="font-medium text-ink">{{ gal(totals.gallons) }} gallons</span> worth
        <span class="font-semibold text-danger-700">{{ usd(totals.cost) }}</span> at the prices actually paid.
      </p>

      <dl class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt class="text-xs text-ink-muted">Idle hours</dt>
          <dd class="text-sm font-medium text-ink">{{ gal(totals.hours) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-ink-muted">Gallons</dt>
          <dd class="text-sm font-medium text-ink">{{ gal(totals.gallons) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-ink-muted">Share of the fuel bill</dt>
          <dd class="text-sm font-medium text-ink">{{ pct1(totals.ofSpend) }}</dd>
        </div>
        <div>
          <dt class="text-xs text-ink-muted">At this rate, a year</dt>
          <dd class="text-sm font-medium text-ink">{{ usd(annualised) }}</dd>
        </div>
      </dl>

      <p class="mt-3 text-xs text-ink-tertiary">
        Costed at the org's configured idle burn rate against each period's own price per gallon. Not all of this is
        waste — a driver resting in a sleeper through a summer night is idling for a reason. The Idling page separates
        avoidable idle from unavoidable, using the truck's confirmed APU equipment as the evidence.
      </p>
    </template>

    <p v-else class="mt-2 text-sm text-ink-muted">
      No period in this range had enough engine-feed coverage to measure idle against.
    </p>

    <p
      v-if="withheld.length"
      class="mt-3 rounded-surface bg-caution-50 px-3 py-2 text-xs text-caution-800 ring-1 ring-caution-100"
    >
      {{ withheld.length }} {{ grainLabel }}{{ withheld.length === 1 ? " is" : "s are" }} left out: the engine feed
      covered less than {{ pct1(MIN_IDLE_COVERAGE) }} of those days, and idle measured across a gap in the feed reads
      as a fleet that stopped idling rather than as a sync that stopped reporting. Their FUEL is still counted
      everywhere else on this page — only the idle claim is withheld.
    </p>
  </BaseCard>
</template>
