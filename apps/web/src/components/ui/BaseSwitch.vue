<script setup lang="ts">
/**
 * Accessible on/off control for immediate settings. The visible label lives at
 * the call site; pass aria-label when the surrounding text does not label it.
 */
defineOptions({ inheritAttrs: false });

withDefaults(defineProps<{ modelValue?: boolean; disabled?: boolean }>(), {
  modelValue: false,
  disabled: false,
});
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>

<template>
  <button
    v-bind="$attrs"
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    class="relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
    :class="modelValue ? 'bg-brand-600' : 'bg-ink-subtle'"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      aria-hidden="true"
      class="pointer-events-none absolute left-0.5 top-0.5 size-5 rounded-full bg-surface shadow-sm transition-transform"
      :class="modelValue ? 'translate-x-5' : 'translate-x-0'"
    />
  </button>
</template>
