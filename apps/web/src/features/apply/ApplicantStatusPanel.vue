<script setup lang="ts">
import { computed } from "vue";
import { applicantVideosPath, type ApplicantOwedKind } from "@silvicom/shared";
import { applicantStages, type ApplicantStage } from "@/features/apply/applicantStages";
import type { ApplyPhases } from "@/features/apply/useApplication";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * Where the application stands, and what the applicant still owes (HIRING-WORKFLOW-AUDIT §13 SP1).
 *
 * Four stages from the phases the link already serves (`applicantStages`, D-SP1), and the kinds the
 * server says are owed (D-SP2) — kinds only, never a site, a time or a reference (D-SP3). Shown inside
 * every wait screen, so the three read the same way. The videos item links to the videos page, which
 * this same token opens.
 */
const props = defineProps<{ phases: ApplyPhases; owes: readonly ApplicantOwedKind[]; carrier: string; token: string }>();

const copy = computed(() => APPLY_COPY.status);
const stages = computed(() => applicantStages(props.phases));
const stageLabel = (s: ApplicantStage): string => {
  const w = copy.value.stages[s];
  return typeof w === "function" ? w(props.carrier) : w;
};
const owedLine = (k: ApplicantOwedKind): string => {
  const w = copy.value.owes[k];
  return typeof w === "function" ? w(props.carrier) : w;
};
</script>

<template>
  <div class="mt-4 space-y-4" data-testid="applicant-status">
    <div>
      <h2 class="text-sm font-semibold text-ink">{{ copy.heading }}</h2>
      <ol class="mt-2 space-y-1.5">
        <li
          v-for="s in stages"
          :key="s.stage"
          class="flex items-baseline gap-2 text-sm"
          :data-testid="`stage-${s.stage}`"
          :data-state="s.state"
        >
          <span
            class="w-14 shrink-0 text-2xs font-semibold uppercase tracking-wide"
            :class="s.state === 'done' ? 'text-success-700' : s.state === 'current' ? 'text-brand-700' : 'text-ink-muted'"
          >
            {{ copy.stateWords[s.state] }}
          </span>
          <span :class="s.state === 'later' ? 'text-ink-muted' : 'text-ink'">{{ stageLabel(s.stage) }}</span>
        </li>
      </ol>
    </div>
    <div v-if="owes.length" data-testid="applicant-owes">
      <h2 class="text-sm font-semibold text-ink">{{ copy.owesHeading }}</h2>
      <ul class="mt-2 space-y-2">
        <li v-for="k in owes" :key="k" class="text-sm text-ink" :data-testid="`owes-${k}`">
          {{ owedLine(k) }}
          <a v-if="k === 'videos'" :href="applicantVideosPath(token)" class="ml-1 font-medium text-brand-700 underline">
            {{ copy.videosLink }}
          </a>
        </li>
      </ul>
    </div>
  </div>
</template>
