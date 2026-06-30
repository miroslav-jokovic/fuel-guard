<script setup lang="ts">
import { computed } from "vue";
import { SparklesIcon } from "@heroicons/vue/24/outline";
import type { AiVerificationRecord } from "@fleetguard/shared";

const props = defineProps<{ assessment: AiVerificationRecord | null; loading?: boolean }>();

const badge = computed(() => {
  switch (props.assessment?.risk_level) {
    case "critical":
      return "bg-red-100 text-red-800";
    case "high":
      return "bg-orange-100 text-orange-800";
    case "medium":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-gray-100 text-gray-600";
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
  <div class="rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <SparklesIcon class="size-5 text-indigo-500" aria-hidden="true" />
        <h4 class="text-sm font-semibold text-gray-900">AI assessment</h4>
        <span class="text-xs text-gray-400">AI-generated · for review</span>
      </div>
      <span v-if="assessment" :class="['inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', badge]">
        {{ assessment.risk_level }} · {{ assessment.risk_score }}/100
      </span>
    </div>

    <div v-if="loading" class="mt-3 text-sm text-gray-500">Running AI assessment…</div>

    <p v-else-if="!assessment" class="mt-3 text-sm text-gray-500">
      No AI assessment yet.
    </p>

    <div v-else class="mt-3 space-y-2 text-sm">
      <p class="text-gray-700">{{ assessment.summary }}</p>

      <p v-if="assessment.location_plausible === false" class="text-red-700">
        Location looks implausible<span v-if="assessment.implied_speed_mph">
          — implied {{ assessment.implied_speed_mph }} mph between stations</span
        >.
      </p>

      <ul v-if="assessment.contributing_factors.length" class="list-disc pl-5 text-gray-600">
        <li v-for="(f, i) in assessment.contributing_factors" :key="i">{{ f }}</li>
      </ul>

      <div class="flex items-center gap-2 pt-1">
        <span class="text-xs text-gray-500">Recommended:</span>
        <span class="rounded-md bg-white px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200 ring-inset">
          {{ actionLabel[assessment.recommended_action] ?? assessment.recommended_action }}
        </span>
        <span v-if="assessment.confidence != null" class="ml-auto text-xs text-gray-400">
          confidence {{ Math.round(assessment.confidence * 100) }}%
        </span>
      </div>
    </div>
  </div>
</template>
