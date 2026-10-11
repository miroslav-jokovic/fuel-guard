<script setup lang="ts">
import { useTouchTargets } from "../touchTargets";

/**
 * Shared text/number/date input. text-base on mobile prevents iOS focus zoom. 36 px, or 44 inside a
 * thumb-pressed layout (`touchTargets.ts`) — which `AppCombobox`, built on this, inherits.
 */
defineOptions({ inheritAttrs: false });
const touchTargets = useTouchTargets();

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
    class="block w-full rounded-control border-0 bg-surface px-3 text-base text-ink ring-1 ring-inset placeholder:text-ink-disabled focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-disabled sm:text-sm"
    :class="[
      touchTargets ? 'h-11' : 'h-9',
      invalid ? 'ring-danger-600 focus:ring-danger-600' : 'ring-edge-control focus:ring-focus-ring',
    ]"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
