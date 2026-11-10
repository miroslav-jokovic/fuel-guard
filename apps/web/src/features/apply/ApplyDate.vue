<script setup lang="ts">
import { AppTypedDate, type TypedDateKind } from "@silvicom/ui";
import { applyLanguage } from "./language";
import { APPLY_COPY } from "./strings";

/**
 * The applicant's date box: `AppTypedDate` in the page's language (D-AM6, APPLICATION-SCREEN-MAP §9).
 *
 * One component rather than the language and the five sentences repeated at every date on the form —
 * fourteen places, and the fifteenth would be the one left in English. `kind` is the only thing a date
 * here has to say about itself: it decides which year a short answer means.
 */
defineOptions({ inheritAttrs: false });
withDefaults(defineProps<{ modelValue?: string | null; kind?: TypedDateKind }>(), { modelValue: "", kind: "any" });
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <AppTypedDate
    v-bind="$attrs"
    :model-value="modelValue"
    :kind="kind"
    :language="applyLanguage"
    :problems="APPLY_COPY.dates.problems"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
