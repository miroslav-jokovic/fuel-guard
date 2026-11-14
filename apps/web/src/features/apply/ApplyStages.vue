<script setup lang="ts">
import { computed } from "vue";
import { APPLICATION_STAGES } from "@silvicom/shared";
import { APPLY_COPY } from "@/features/apply/strings";
import { stageStates, type StageFacts } from "@/features/apply/stages";

/**
 * The three stages, on every screen (U1; SCREEN-MAP §1: "a three-stage progress bar").
 *
 * ── WHY IT IS NOT A COUNT OF SCREENS ──────────────────────────────────────────────────────────
 * The number of screens is the driver's own history — three jobs or nine — so a count grows under them
 * as they answer. What does not move is where they are among three visits, and that the next one waits
 * for the office. So the bar says only that: done, here, later.
 *
 * Not interactive: a stage opens when the office acts, never by a tap, and a control that looks
 * tappable and is not is worse than one that does not.
 */
const props = defineProps<{ facts: StageFacts }>();
const copy = APPLY_COPY.stages;
const states = computed(() => stageStates(props.facts));
</script>

<template>
  <ol class="flex items-stretch gap-2" :aria-label="copy.label" data-apply-stages>
    <li
      v-for="stage in APPLICATION_STAGES"
      :key="stage"
      class="min-w-0 flex-1 space-y-1"
      :aria-current="states[stage] === 'current' ? 'step' : undefined"
      :data-state="states[stage]"
    >
      <div
        class="h-1.5 rounded-detail"
        :class="states[stage] === 'ahead' ? 'bg-surface-muted ring-1 ring-inset ring-edge' : 'bg-brand-500'"
        aria-hidden="true"
      />
      <p class="truncate text-xs" :class="states[stage] === 'current' ? 'font-semibold text-ink' : 'text-ink-muted'">
        {{ copy.names[stage] }}
        <span class="sr-only">— {{ copy.state[states[stage]] }}</span>
      </p>
    </li>
  </ol>
</template>
