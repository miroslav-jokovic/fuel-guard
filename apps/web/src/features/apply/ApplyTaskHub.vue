<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { CheckIcon } from "@silvicom/ui/icons";
import type { ApplicationCaptureView, ApplicationSection } from "@silvicom/shared";
import type { ApplicationDraft } from "@/features/apply/draft";
import { hubTasks, type TaskStatus } from "@/features/apply/taskHub";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * Part 2's task list (APPLICATION-FLOW-V2-PLAN.md §6.4, D-AW11, C3c2a).
 *
 * One full-width row per task — a 44 px target at least (§6.8, `size="row"` pads to it) — naming the
 * task and its status in words. Statuses come from `taskHub.ts` and nothing here decides one.
 * "Before you send" is shut until every required task passes, and says why on its row rather than
 * being hidden: a missing last step reads as a broken page.
 */
const props = defineProps<{
  draft: ApplicationDraft;
  v2AsOf: string | null;
  captures: readonly ApplicationCaptureView[];
  saveStatus: string | null;
}>();
const emit = defineEmits<{ open: [ApplicationSection] }>();

const copy = APPLY_COPY.hub;
const tasks = computed(() => hubTasks(props.draft, props.v2AsOf, props.captures));
const TONE: Record<TaskStatus, string> = {
  completed: "text-success-700",
  in_progress: "text-ink-secondary",
  not_started: "text-ink-muted",
  cannot_start: "",
};
</script>

<template>
  <section class="space-y-4">
    <div>
      <h2 class="text-lg font-semibold text-ink">{{ copy.heading }}</h2>
      <p class="mt-1 text-sm text-ink-muted">{{ copy.intro }}</p>
    </div>

    <ul class="divide-y divide-edge overflow-hidden rounded-surface bg-surface ring-1 ring-inset ring-edge">
      <li v-for="task in tasks" :key="task.section">
        <BaseButton
          variant="ghost"
          size="row"
          class="min-h-11"
          :disabled="task.status === 'cannot_start'"
          :aria-label="`${copy.open(task.label)}, ${copy.status[task.status]}`"
          @click="emit('open', task.section)"
        >
          <span class="flex w-full items-center gap-3">
            <span class="flex size-5 shrink-0 items-center justify-center">
              <AppIcon v-if="task.status === 'completed'" :icon="CheckIcon" class="size-5 text-success-700" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium" :class="task.status === 'cannot_start' ? '' : 'text-ink'">
                {{ task.label }}
              </span>
              <span v-if="task.status === 'cannot_start'" class="block text-xs">{{ copy.finishFirst }}</span>
              <span v-else-if="task.optional" class="block text-xs text-ink-muted">{{ copy.optional }}</span>
            </span>
            <span class="shrink-0 text-xs" :class="TONE[task.status]">{{ copy.status[task.status] }}</span>
          </span>
        </BaseButton>
      </li>
    </ul>

    <p v-if="saveStatus" class="text-xs text-ink-secondary" aria-live="polite">{{ saveStatus }}</p>
  </section>
</template>
