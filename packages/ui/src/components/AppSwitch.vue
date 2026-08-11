<script setup lang="ts">
withDefaults(defineProps<{ modelValue?: boolean; disabled?: boolean; label?: string }>(), {
  modelValue: false,
  disabled: false,
  label: undefined,
});
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    class="relative inline-flex h-6 w-10 shrink-0 rounded-full ring-1 ring-inset ring-edge-control transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
    :class="modelValue ? 'bg-action-primary' : 'bg-surface-muted'"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      aria-hidden="true"
      class="mt-1 size-4 rounded-full bg-surface transition-transform"
      :class="modelValue ? 'translate-x-5' : 'translate-x-1'"
    />
  </button>
</template>
