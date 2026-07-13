<script setup lang="ts">
/**
 * The one checkbox. Use the default slot for an inline label; without a
 * slot it renders just the box (table row selection, etc).
 */
defineOptions({ inheritAttrs: false });

withDefaults(defineProps<{ modelValue?: boolean; disabled?: boolean }>(), {
  modelValue: false,
  disabled: false,
});
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>

<template>
  <label class="inline-flex items-center gap-2 text-sm text-ink-secondary" :class="disabled ? 'opacity-50' : ''">
    <input
      v-bind="$attrs"
      type="checkbox"
      class="size-4 shrink-0 rounded border-edge-strong accent-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      :checked="modelValue"
      :disabled="disabled"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <slot />
  </label>
</template>
