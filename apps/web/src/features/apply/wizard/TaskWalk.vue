<script setup lang="ts">
import { computed } from "vue";
import { AppButton } from "@silvicom/ui";
import YesNoField from "@/features/apply/YesNoField.vue";
import { APPLY_COPY } from "@/features/apply/strings";
import WizardScreen from "./WizardScreen.vue";
import type { TaskWalk } from "./useTaskWalk";

/**
 * The open task, one screen at a time (F4 PR 1b-1). `useTaskWalk` decides which screen and checks it;
 * this draws it — the generated screen, the row it is about, "Any other …?" at a list's end, and the
 * removal of the row on show. The page's own buttons move the walk (`ApplyPage`), as they did the task.
 */
const props = defineProps<{ walk: TaskWalk }>();

/** Each list's own words: whose row this is, how the list asks for one more, how a row is removed. */
const LIST_WORDS = (): Record<string, { row: (n: number) => string; another: string; remove: string }> => {
  const w = APPLY_COPY.safety.walk;
  return {
    accidents: { row: w.accidentRow, another: w.anotherAccident, remove: w.removeAccident },
    violations: { row: w.violationRow, another: w.anotherViolation, remove: w.removeViolation },
  };
};

const step = computed(() => props.walk.current.value);
const words = computed(() => {
  const list = step.value?.another ?? step.value?.screen?.list;
  return list ? LIST_WORDS()[list] : undefined;
});
</script>

<template>
  <div v-if="step" class="space-y-4">
    <p class="text-xs font-medium text-ink-tertiary">{{ APPLY_COPY.hub.question(walk.step.value, walk.count.value) }}</p>
    <p v-if="words && step.row !== undefined" class="text-sm font-semibold text-ink">{{ words.row(step.row + 1) }}</p>

    <YesNoField
      v-if="step.another && words"
      :id="`apply-${step.another}-another`"
      :model-value="walk.another.value"
      :legend="words.another"
      :error="walk.anotherRefused.value ? APPLY_COPY.hub.chooseYesOrNo : undefined"
      @update:model-value="walk.answerAnother($event)"
    />
    <WizardScreen v-else-if="step.screen" :key="step.key" :screen="step.screen" :row="step.row" :binding="walk.binding" />

    <p v-for="problem in walk.stray.value" :key="problem" class="text-sm text-danger-700" role="alert">{{ problem }}</p>

    <div v-if="words && step.row !== undefined" class="flex justify-end">
      <AppButton variant="ghost" size="touch" @click="walk.removeRow()">{{ words.remove }}</AppButton>
    </div>
  </div>
</template>
