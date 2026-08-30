<script setup lang="ts">
import { computed } from "vue";
import type { Finding, FindingTier } from "@hazmat/engine";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import CitationText from "./CitationText.vue";
import { tierLabel } from "./reviewModel";

/**
 * One engine Finding, tier-colored via the shared semantic badge tones. Tiers (D2): `violation` blocks a
 * load, `conditional` forces review (fail-closed on unknowns), `warning`/`info` ride along on a cleared
 * load. Reusing toneClass keeps it visually identical to alerts/loads badges across the app.
 */
const props = defineProps<{ finding: Finding }>();

const TONE: Record<FindingTier, string> = {
  violation: "danger",
  conditional: "warning",
  warning: "warning",
  info: "neutral",
};

// The label vocabulary is shared with the review panel (reviewModel) so the same tier cannot read
// two different ways on two surfaces of one verdict.
const tier = computed(() => ({ tone: TONE[props.finding.tier], label: tierLabel(props.finding.tier) }));
</script>

<template>
  <div class="flex flex-col gap-1.5 border-b border-edge py-2.5 last:border-0">
    <div class="flex items-start gap-2">
      <span :class="[BADGE_BASE, toneClass(tier.tone), 'mt-0.5 shrink-0']">{{ tier.label }}</span>
      <p class="text-sm text-ink">{{ finding.message }}</p>
    </div>
    <div class="pl-1">
      <CitationText :citations="finding.citations" />
    </div>
  </div>
</template>
