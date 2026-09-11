<script setup lang="ts">
import { computed } from "vue";
import { AppFormField as FormField } from "@silvicom/ui";
import { useApplyIssues } from "@/features/apply/issues";
import type { FieldPath } from "@/features/apply/fieldLabels";

/**
 * One labelled control on the application, which knows its own contract path (D-AX3).
 *
 * ── WHY THE PATH IS THE PROP ──────────────────────────────────────────────────────────────────
 * `AppFormField` takes an `id` and an `error` and has no way to know what either should be. Every
 * caller would have had to write both — `:id="idFor(['addresses', i, 'city'])"` beside
 * `:error="errorFor(['addresses', i, 'city'])"` — fifty times, with the two able to disagree by a
 * typo on any one of them. A field that shows an error for a different box than the one the cursor
 * lands in is worse than a field with no error at all, because it sends the driver somewhere.
 *
 * So the path is given once and both are derived from it. This is a composition over the shared
 * primitive, not a replacement for it: the label, the hint, the error text, the `aria-describedby`
 * and the `aria-invalid` are all still `AppFormField`'s, and a field that needs none of this can
 * still use `AppFormField` directly.
 *
 * ── AND WHY THE SLOT STILL HANDS BACK AN `id` ─────────────────────────────────────────────────
 * Unchanged from `AppFormField`, so adopting this is a rename and a prop at each call site and
 * never a rewrite of the control inside it.
 */
const props = defineProps<{
  path: FieldPath;
  label?: string;
  hint?: string;
}>();

const { errorFor, idFor } = useApplyIssues();
const id = computed(() => idFor(props.path));
const error = computed(() => errorFor(props.path));
</script>

<template>
  <FormField :id="id" :label="label" :hint="hint" :error="error">
    <template #default="slotProps">
      <slot v-bind="slotProps" />
    </template>
  </FormField>
</template>
