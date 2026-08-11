<script setup lang="ts">
defineOptions({ inheritAttrs: false });

withDefaults(defineProps<{ modelValue?: number | null; invalid?: boolean }>(), {
  modelValue: null,
  invalid: false,
});
const emit = defineEmits<{ "update:modelValue": [value: number | null] }>();

function update(raw: string) {
  emit("update:modelValue", raw === "" ? null : Number(raw));
}
</script>

<template>
  <input
    v-bind="$attrs"
    type="number"
    :value="modelValue ?? ''"
    class="block h-9 w-full rounded-control border-0 bg-surface px-3 text-base text-ink tabular-nums ring-1 ring-inset placeholder:text-ink-disabled focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-disabled sm:text-sm"
    :class="
      invalid ? 'ring-danger-600 focus:ring-danger-600' : 'ring-edge-control focus:ring-focus-ring'
    "
    @input="update(($event.target as HTMLInputElement).value)"
  />
</template>
