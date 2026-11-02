<script setup lang="ts">
import YesNoQuestion from "@/components/YesNoQuestion.vue";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * One yes/no question on the application, in the applicant's language (§6.2's gates and the
 * screening questions). The control itself is `@/components/YesNoQuestion.vue` since HW5b, where the
 * one employer form can reach it from the office's screens too; this keeps every applicant call site
 * as it was, with "Yes" and "No" read from `APPLY_COPY` so they follow the page's language.
 */
defineProps<{ legend: string; hint?: string; error?: string; id?: string }>();
const model = defineModel<boolean | null>({ required: true });
const copy = APPLY_COPY.partOne;
</script>

<template>
  <YesNoQuestion
    :id="id"
    v-model="model"
    :legend="legend"
    :hint="hint"
    :error="error"
    :yes="copy.yes"
    :no="copy.no"
  />
</template>
