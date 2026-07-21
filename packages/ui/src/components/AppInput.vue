<script setup lang="ts">
/**
 * The one text input (shared design primitive). Native attributes fall through via $attrs; v-model yields
 * a string. Mirrors apps/web BaseInput. text-base on mobile avoids iOS focus-zoom; sm:text-sm from tablet.
 */
defineOptions({ inheritAttrs: false });

withDefaults(defineProps<{ modelValue?: string | number | null; invalid?: boolean }>(), {
  modelValue: "",
  invalid: false,
});
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <input
    v-bind="$attrs"
    :value="modelValue ?? ''"
    class="block w-full rounded-md border-0 bg-surface px-3 py-1.5 text-base text-ink ring-1 ring-inset placeholder:text-ink-subtle focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
    :class="invalid ? 'ring-danger-400 focus:ring-danger-500' : 'ring-edge-strong focus:ring-brand-600'"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
