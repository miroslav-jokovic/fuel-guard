<script setup lang="ts">
import { useId } from "vue";

/**
 * Label + control + error/hint, standardized. The generated `id` is exposed
 * to the default slot so the control can bind it:
 *
 *   <FormField label="Make" :error="errors.make" v-slot="{ id }">
 *     <BaseInput :id="id" v-model="form.make" />
 *   </FormField>
 */
const props = withDefaults(
  defineProps<{ label?: string; hint?: string; error?: string; required?: boolean; id?: string }>(),
  { label: undefined, hint: undefined, error: undefined, required: false, id: undefined },
);

const generated = useId();
const fieldId = props.id ?? generated;
</script>

<template>
  <div>
    <label v-if="label" :for="fieldId" class="block text-sm font-medium text-ink-secondary">
      {{ label }}<span v-if="required" class="text-danger-600"> *</span>
    </label>
    <div :class="label ? 'mt-1' : ''">
      <slot :id="fieldId" />
    </div>
    <p v-if="error" class="mt-1 text-sm text-danger-600">{{ error }}</p>
    <p v-else-if="hint" class="mt-1 text-xs text-ink-muted">{{ hint }}</p>
  </div>
</template>
