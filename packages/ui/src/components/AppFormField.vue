<script setup lang="ts">
import { computed, useId } from "vue";

const props = withDefaults(
  defineProps<{ label?: string; hint?: string; error?: string; required?: boolean; id?: string }>(),
  { label: undefined, hint: undefined, error: undefined, required: false, id: undefined },
);
const generated = useId();
const fieldId = computed(() => props.id ?? generated);
const descriptionId = computed(() =>
  props.error || props.hint ? `${fieldId.value}-description` : undefined,
);
</script>

<template>
  <div>
    <label v-if="label" :for="fieldId" class="block text-sm font-medium text-ink-secondary">
      {{ label }}<span v-if="required" class="text-danger-700" aria-hidden="true"> *</span>
    </label>
    <div :class="label ? 'mt-1' : ''">
      <slot
        :id="fieldId"
        :aria-describedby="descriptionId"
        :aria-invalid="error ? true : undefined"
        :aria-required="required ? true : undefined"
      />
    </div>
    <p v-if="error" :id="descriptionId" class="mt-1 text-sm text-danger-700">{{ error }}</p>
    <p v-else-if="hint" :id="descriptionId" class="mt-1 text-xs text-ink-tertiary">{{ hint }}</p>
  </div>
</template>
