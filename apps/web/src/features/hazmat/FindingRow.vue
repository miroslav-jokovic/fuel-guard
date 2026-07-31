<script setup lang="ts">
import { computed } from "vue";
import type { Finding, FindingTier } from "@hazmat/engine";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import CitationText from "./CitationText.vue";

/**
 * One engine Finding, tier-colored via the shared semantic badge tones. Tiers (D2): `violation` blocks a
 * load, `conditional` forces review (fail-closed on unknowns), `warning`/`info` ride along on a cleared
 * load. Reusing toneClass keeps it visually identical to alerts/loads badges across the app.
 */
const props = defineProps<{ finding: Finding }>();

const TIER: Record<FindingTier, { tone: string; label: string }> = {
  violation: { tone: "danger", label: "Violation" },
  conditional: { tone: "warning", label: "Review" },
  warning: { tone: "warning", label: "Warning" },
  info: { tone: "neutral", label: "Info" },
};

const tier = computed(() => TIER[props.finding.tier]);
</script>

<template>
  <div class="flex flex-col gap-1.5 border-b border-edge py-2.5 last:border-0">
    <div class="flex items-start gap-2">
      <span :class="[BADGE_BASE, toneClass(tier.tone), 'mt-0.5 shrink-0 !capitalize']">{{ tier.label }}</span>
      <p class="text-sm text-ink">{{ finding.message }}</p>
    </div>
    <div class="pl-1">
      <CitationText :citations="finding.citations" />
    </div>
  </div>
</template>
