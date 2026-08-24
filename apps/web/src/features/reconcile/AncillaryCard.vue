<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { analyzeAncillary, DEF_EXPECTED_RATIO, type SpendLine } from "@fuelguard/shared";
import { usd, usd3, gal, pct1 } from "./format";

/**
 * Everything on the bill that is not tractor fuel (plan §4.7) — reefer diesel, DEF, in-store
 * purchases and tax. Invisible on a fuel-only report and not small.
 *
 * The DEF ratio is the line worth watching: engines burn DEF at 2–3% of fuel volume, so a materially
 * higher purchase ratio is over-buying, spillage, or DEF leaving in containers. Stated as a prompt to
 * look, never as a verdict.
 */
const props = defineProps<{ lines: SpendLine[] }>();
const a = computed(() => analyzeAncillary(props.lines));
const band = `${(DEF_EXPECTED_RATIO.low * 100).toFixed(0)}–${(DEF_EXPECTED_RATIO.high * 100).toFixed(0)}%`;
</script>

<template>
  <BaseCard>
    <h3 class="text-sm font-semibold text-ink">Beyond tractor fuel</h3>
    <dl class="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div>
        <dt class="text-xs text-ink-muted">Tractor diesel</dt>
        <dd class="text-sm font-medium text-ink">{{ gal(a.tractorFuel.gallons) }} gal</dd>
        <dd class="text-xs text-ink-tertiary">{{ usd(a.tractorFuel.spend) }}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Reefer diesel</dt>
        <dd class="text-sm font-medium text-ink">{{ gal(a.reeferFuel.gallons) }} gal</dd>
        <dd class="text-xs text-ink-tertiary">{{ usd(a.reeferFuel.spend) }} · {{ a.reeferFuel.lines }} fills</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">DEF</dt>
        <dd class="text-sm font-medium text-ink">{{ gal(a.def.gallons) }} gal</dd>
        <dd class="text-xs text-ink-tertiary">{{ usd(a.def.spend) }} at {{ usd3(a.def.perGal) }}/gal</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">In-store &amp; tax</dt>
        <dd class="text-sm font-medium text-ink">{{ usd(a.merchandise.spend + a.salesTax) }}</dd>
        <dd class="text-xs text-ink-tertiary">{{ a.merchandise.lines }} purchases</dd>
      </div>
    </dl>

    <p
      v-if="a.def.ratio != null"
      class="mt-4 rounded-surface px-3 py-2 text-sm ring-1"
      :class="a.def.outsideExpected ? 'bg-caution-50 text-caution-800 ring-caution-100' : 'bg-surface-muted text-ink-secondary ring-edge'"
    >
      DEF is {{ pct1(a.def.ratio) }} of diesel volume.
      <template v-if="a.def.outsideExpected">
        Engines consume it at about {{ band }}, so this is worth a look — over-buying, spillage, or DEF leaving in
        containers all read the same way here.
      </template>
      <template v-else>That sits inside the {{ band }} engines actually consume.</template>
    </p>
    <p v-if="a.nonFuelShare != null" class="mt-2 text-xs text-ink-tertiary">
      {{ pct1(a.nonFuelShare) }} of the bill is not tractor fuel.
    </p>
  </BaseCard>
</template>
