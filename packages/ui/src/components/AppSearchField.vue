<script setup lang="ts">
import { MagnifyingGlassIcon, XMarkIcon } from "../icons";
import { onBeforeUnmount, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import AppIconButton from "./AppIconButton.vue";
import AppInput from "./AppInput.vue";

const props = withDefaults(
  defineProps<{ modelValue: string; placeholder?: string; debounce?: number; label?: string }>(),
  { placeholder: "Search…", debounce: 250, label: "Search" },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const local = ref(props.modelValue);
let timer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => props.modelValue,
  (value) => {
    if (value !== local.value) local.value = value;
  },
);
watch(local, (value) => {
  clearTimeout(timer);
  timer = setTimeout(() => emit("update:modelValue", value.trim()), props.debounce);
});
onBeforeUnmount(() => clearTimeout(timer));

/**
 * The field itself, for a dialog that opens on a search (BaseModal `initialFocus`, 2026-11-01). The
 * root is a wrapper and `AppInput` renders one <input>, so the element is read from the wrapper
 * rather than threaded through a second component's expose.
 */
const root = ref<HTMLElement | null>(null);
defineExpose({ input: () => root.value?.querySelector("input") ?? null });

function clear() {
  local.value = "";
  clearTimeout(timer);
  emit("update:modelValue", "");
}
</script>

<template>
  <div ref="root" class="relative">
    <AppIcon
      :icon="MagnifyingGlassIcon"
      class="pointer-events-none absolute top-1/2 left-3 z-sticky size-4 -translate-y-1/2 text-ink-tertiary"
      aria-hidden="true"
    />
    <AppInput
      v-model="local"
      type="search"
      :placeholder="placeholder"
      :aria-label="label"
      class="app-search-field-input pr-10 pl-9"
    />
    <AppIconButton
      v-if="local"
      :icon="XMarkIcon"
      label="Clear search"
      size="sm"
      class="absolute top-1/2 right-0.5 -translate-y-1/2"
      @click="clear"
    />
  </div>
</template>

<style scoped>
/* Keep the component's accessible clear button and suppress browser-specific duplicate affordances. */
.app-search-field-input::-webkit-search-cancel-button,
.app-search-field-input::-webkit-search-decoration,
.app-search-field-input::-webkit-search-results-button,
.app-search-field-input::-webkit-search-results-decoration {
  appearance: none;
  display: none;
}
</style>
