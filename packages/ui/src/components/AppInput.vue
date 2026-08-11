<script setup lang="ts">
/** Shared text/number/date input. text-base on mobile prevents iOS focus zoom. */
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
    class="block h-9 w-full rounded-control border-0 bg-surface px-3 text-base text-ink ring-1 ring-inset placeholder:text-ink-disabled focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-disabled sm:text-sm"
    :class="
      invalid ? 'ring-danger-600 focus:ring-danger-600' : 'ring-edge-control focus:ring-focus-ring'
    "
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
