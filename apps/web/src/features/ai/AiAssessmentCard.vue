<script setup lang="ts">
import { computed } from "vue";
import { SparklesIcon } from "@heroicons/vue/24/outline";
import type { AiVerificationRecord } from "@fuelguard/shared";

const props = defineProps<{ assessment: AiVerificationRecord | null; loading?: boolean }>();

const badge = computed(() => {
  switch (props.assessment?.risk_level) {
    case "critical":
      return "bg-danger-100 text-danger-800";
    case "high":
      return "bg-caution-100 text-caution-800";
    case "medium":
      return "bg-warning-100 text-warning-800";
    default:
      return "bg-surface-muted text-ink-secondary";
  }
});

const actionLabel: Record<string, string> = {
  monitor: "Monitor",
  investigate: "Investigate",
  contact_driver: "Contact driver",
  block_card: "Block card",
  none: "No action",
};
</script>

<template>
  <div class="rounded-lg border border-brand-100 bg-brand-50/40 p-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <SparklesIcon class="size-5 text-brand-500" aria-hidden="true" />
        <h4 class="text-sm font-semibold text-ink">AI assessment</h4>
        <span class="text-xs text-ink-subtle">AI-generated · for review</span>
      </div>
      <span v-if="assessment" :class="['inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', badge]">
        {{ assessment.risk_level }} · {{ assessment.risk_score }}/100
      </span>
    </div>

    <div v-if="loading" class="mt-3 text-sm text-ink-muted">Running AI assessment…</div>

    <p v-else-if="!assessment" class="mt-3 text-sm text-ink-muted">
      No AI assessment yet.
    </p>

    <div v-else class="mt-3 space-y-2 text-sm">
      <p class="text-ink-secondary">{{ assessment.summary }}</p>

      <p v-if="assessment.location_plausible === false" class="text-danger-700">
        Location looks implausible<span v-if="assessment.implied_speed_mph">
          — implied {{ assessment.implied_speed_mph }} mph between stations</span
        >.
      </p>

      <ul v-if="assessment.contributing_factors.length" class="list-disc pl-5 text-ink-secondary">
        <li v-for="(f, i) in assessment.contributing_factors" :key="i">{{ f }}</li>
      </ul>

      <div class="flex items-center gap-2 pt-1">
        <span class="text-xs text-ink-muted">Recommended:</span>
        <span class="rounded-md bg-surface px-2 py-0.5 text-xs font-medium text-ink-secondary ring-1 ring-edge ring-inset">
          {{ actionLabel[assessment.recommended_action] ?? assessment.recommended_action }}
        </span>
        <span v-if="assessment.confidence != null" class="ml-auto text-xs text-ink-subtle">
          confidence {{ Math.round(assessment.confidence * 100) }}%
        </span>
      </div>
    </div>
  </div>
</template>
