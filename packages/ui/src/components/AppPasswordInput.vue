<script setup lang="ts">
import { ref } from "vue";
import { EyeIcon, EyeSlashIcon } from "../icons";
import AppIconButton from "./AppIconButton.vue";
import AppInput from "./AppInput.vue";

/**
 * A password input with a show/hide toggle — AppInput with an eye button inside it, the same shape as
 * AppSearchField's clear button.
 *
 * Attributes (`id`, `autocomplete`, `required`, `disabled`, …) land on the INPUT, not the wrapper, so
 * AppFormField's label and the browser's password manager both keep working exactly as they do on a
 * bare `AppInput type="password"`.
 *
 * Hidden by default and never remembered: a reveal is a moment, and a page that reopened with the
 * password showing would put it on screen for whoever looks next.
 */
defineOptions({ inheritAttrs: false });

withDefaults(defineProps<{ modelValue?: string | null; invalid?: boolean }>(), {
  modelValue: "",
  invalid: false,
});
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const shown = ref(false);
</script>

<template>
  <div class="relative">
    <AppInput
      v-bind="$attrs"
      :model-value="modelValue"
      :type="shown ? 'text' : 'password'"
      :invalid="invalid"
      class="pr-10"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <AppIconButton
      :icon="shown ? EyeSlashIcon : EyeIcon"
      :label="shown ? 'Hide password' : 'Show password'"
      :aria-pressed="shown"
      size="sm"
      class="absolute top-1/2 right-0.5 -translate-y-1/2"
      @click="shown = !shown"
    />
  </div>
</template>
