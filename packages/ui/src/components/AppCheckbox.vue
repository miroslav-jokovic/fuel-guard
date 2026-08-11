<script setup lang="ts">
defineOptions({ inheritAttrs: false });
withDefaults(defineProps<{ modelValue?: boolean; label?: string; disabled?: boolean }>(), {
  modelValue: false,
  label: undefined,
  disabled: false,
});
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>

<template>
  <label class="inline-flex min-h-9 items-center gap-2 text-sm text-ink-secondary">
    <input
      v-bind="$attrs"
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      class="size-4 rounded-detail border-edge-control accent-action-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span v-if="label"
      ><slot>{{ label }}</slot></span
    >
    <slot v-else />
  </label>
</template>
