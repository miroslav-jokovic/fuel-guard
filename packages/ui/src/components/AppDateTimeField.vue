<script setup lang="ts">
import AppInput from "./AppInput.vue";

withDefaults(defineProps<{ modelValue?: string | null; invalid?: boolean }>(), {
  modelValue: "",
  invalid: false,
});
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <AppInput
    type="datetime-local"
    :model-value="modelValue"
    :invalid="invalid"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
