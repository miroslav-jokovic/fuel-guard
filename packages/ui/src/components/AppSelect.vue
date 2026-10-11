<script setup lang="ts">
import { useTouchTargets } from "../touchTargets";

defineOptions({ inheritAttrs: false });
/** 36 px, or 44 inside a thumb-pressed layout (`touchTargets.ts`), as `AppInput`. */
const touchTargets = useTouchTargets();

export type SelectValue = string | number | undefined | null;
export interface SelectOption {
  value: SelectValue;
  label: string;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: SelectValue;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    invalid?: boolean;
  }>(),
  { placeholder: "Select…", disabled: false, invalid: false },
);
const emit = defineEmits<{ "update:modelValue": [value: SelectValue] }>();

function update(raw: string) {
  const option = props.options.find((candidate) => String(candidate.value ?? "") === raw);
  emit("update:modelValue", option?.value ?? null);
}
</script>

<template>
  <select
    v-bind="$attrs"
    :value="modelValue ?? ''"
    :disabled="disabled"
    class="block w-full rounded-control border-0 bg-surface px-3 pr-8 text-base text-ink ring-1 ring-inset focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-disabled sm:text-sm"
    :class="[
      touchTargets ? 'h-11' : 'h-9',
      invalid ? 'ring-danger-600 focus:ring-danger-600' : 'ring-edge-control focus:ring-focus-ring',
    ]"
    @change="update(($event.target as HTMLSelectElement).value)"
  >
    <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
    <option
      v-for="option in options"
      :key="String(option.value)"
      :value="String(option.value ?? '')"
      :disabled="option.disabled"
    >
      {{ option.label }}
    </option>
  </select>
</template>
