<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import { operatingBridge, type SpendPeriod } from "@silvicom/shared";
import { usd, usd2, gal } from "./format";

/**
 * "Why did fuel cost more?" — answered from what the fleet DID, not from what a vendor billed.
 *
 * `SpendBridgeCard` beside it answers the procurement half of the same question (the market, the
 * discount, where we fuelled) from statement lines. This one answers the operating half from the daily
 * rollup: the pump price, the distance covered, and what efficiency did about it. They are deliberately
 * separate cards because they rest on different sources with different coverage, and a reader has to be
 * able to tell which is which.
 *
 * The bars are an algebraic identity, so the residual is printed. A waterfall whose parts do not sum to
 * the whole invites the reader to distrust the attribution, and the attribution is the product.
 */
const props = defineProps<{ prior: SpendPeriod; current: SpendPeriod; grainLabel: string }>();

const bridge = computed(() => operatingBridge(props.prior, props.current));

/** Bar width is a share of the LARGEST term, so a small but real contributor stays visible. */
const widest = computed(() => Math.max(1, ...bridge.value.terms.map((t) => Math.abs(t.dollars))));
const width = (n: number) => `${Math.max(2, (Math.abs(n) / widest.value) * 100).toFixed(1)}%`;
const share = (n: number) => {
  const d = bridge.value.deltaSpend;
  return d === 0 ? "—" : `${((n / d) * 100).toFixed(0)}%`;
};
</script>

<template>
  <BaseCard>
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold text-ink">Why spend moved</h3>
      <p class="text-xs text-ink-muted">
        {{ prior.from }} → {{ prior.to }} vs {{ current.from }} → {{ current.to }} · by {{ grainLabel }}
      </p>
    </div>

    <p class="mt-2 text-sm text-ink-secondary">
      Tractor fuel went
      <span class="font-medium text-ink">{{ usd(prior.spend) }}</span> →
      <span class="font-medium text-ink">{{ usd(current.spend) }}</span>, a change of
      <span class="font-semibold" :class="bridge.deltaSpend >= 0 ? 'text-danger-700' : 'text-success-700'">
        {{ usd(bridge.deltaSpend) }}
      </span>.
    </p>

    <dl class="mt-4 space-y-3">
      <div v-for="t in bridge.terms" :key="t.key" class="grid grid-cols-[9rem_1fr_7rem] items-center gap-3">
        <dt class="text-sm text-ink">
          {{ t.label }}
          <span class="block text-2xs text-ink-tertiary">{{ t.detail }}</span>
        </dt>
        <dd class="h-2 rounded-detail bg-surface-muted">
          <div
            class="h-2 rounded-detail"
            :class="t.dollars >= 0 ? 'bg-danger-200' : 'bg-success-200'"
            :style="{ width: width(t.dollars) }"
          />
        </dd>
        <dd class="text-right text-sm font-medium tabular-nums" :class="t.dollars >= 0 ? 'text-danger-700' : 'text-success-700'">
          {{ usd(t.dollars) }}
          <span class="block text-2xs font-normal text-ink-tertiary">{{ share(t.dollars) }}</span>
        </dd>
      </div>
    </dl>

    <p class="mt-3 border-t border-edge pt-3 text-xs text-ink-tertiary">
      <template v-if="bridge.tiesOut">
        These add to {{ usd(bridge.deltaSpend) }} exactly (residual {{ usd2(bridge.residual) }}).
      </template>
      <span v-else class="text-danger-700">
        These miss the change by {{ usd2(bridge.residual) }} — the decomposition is wrong, not the rounding.
      </span>
    </p>

    <!-- The distance bar is the one a reader will want to argue with, so it is broken down further:
         a bigger fleet and busier trucks call for different conversations. -->
    <p v-if="bridge.volumeSplit" class="mt-2 text-xs text-ink-muted">
      The extra distance is
      <span class="font-medium text-ink-secondary">{{ gal(bridge.volumeSplit.milesFrom.trucks) }} mi</span>
      from running {{ current.activeTrucks }} trucks against {{ prior.activeTrucks }}, and
      <span class="font-medium text-ink-secondary">{{ gal(bridge.volumeSplit.milesFrom.perTruck) }} mi</span>
      from each truck covering {{ gal(current.milesPerTruck) }} against {{ gal(prior.milesPerTruck) }}.
    </p>

    <p v-if="bridge.withheld" class="mt-2 rounded-surface bg-caution-50 px-3 py-2 text-xs text-caution-800 ring-1 ring-caution-100">
      {{ bridge.withheld }}
    </p>
    <p v-else-if="bridge.volumeSplit && (bridge.volumeSplit.measuredShare ?? 1) < 0.9" class="mt-2 text-xs text-ink-tertiary">
      {{ ((bridge.volumeSplit.measuredShare ?? 0) * 100).toFixed(0) }}% of this period's fuel could be paired with a usable
      odometer interval. The rest is carried at the same {{ current.mpg?.toFixed(2) }} MPG, which is the assumption behind
      the distance figures above.
    </p>
  </BaseCard>
</template>
