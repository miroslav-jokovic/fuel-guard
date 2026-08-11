<script setup lang="ts">
defineOptions({ inheritAttrs: false });
withDefaults(defineProps<{ modelValue?: string | null; invalid?: boolean }>(), {
  modelValue: "",
  invalid: false,
});
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <textarea
    v-bind="$attrs"
    :value="modelValue ?? ''"
    class="block min-h-24 w-full rounded-control border-0 bg-surface px-3 py-2 text-base text-ink ring-1 ring-inset placeholder:text-ink-disabled focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-disabled sm:text-sm"
    :class="
      invalid ? 'ring-danger-600 focus:ring-danger-600' : 'ring-edge-control focus:ring-focus-ring'
    "
    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>
