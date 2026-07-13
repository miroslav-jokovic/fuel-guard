<script setup lang="ts">
import { ref, watch } from "vue";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/vue/20/solid";

const props = withDefaults(
  defineProps<{ modelValue: string; placeholder?: string; debounce?: number }>(),
  { placeholder: "Search…", debounce: 250 },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

// Local mirror so typing feels instant while we debounce the emitted value.
const local = ref(props.modelValue);
watch(
  () => props.modelValue,
  (v) => {
    if (v !== local.value) local.value = v;
  },
);

let timer: ReturnType<typeof setTimeout> | undefined;
watch(local, (v) => {
  clearTimeout(timer);
  timer = setTimeout(() => emit("update:modelValue", v.trim()), props.debounce);
});

function clear() {
  local.value = "";
  clearTimeout(timer);
  emit("update:modelValue", "");
}
</script>

<template>
  <div class="relative">
    <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
      <MagnifyingGlassIcon class="size-5 text-ink-subtle" aria-hidden="true" />
    </div>
    <input
      v-model="local"
      type="text"
      :placeholder="placeholder"
      class="block w-full rounded-md border-0 py-1.5 pr-9 pl-10 text-sm text-ink ring-1 ring-edge-strong ring-inset placeholder:text-ink-subtle focus:ring-2 focus:ring-brand-600"
    />
    <button
      v-if="local"
      type="button"
      class="absolute inset-y-0 right-0 flex items-center pr-3 text-ink-subtle hover:text-ink-secondary"
      aria-label="Clear search"
      @click="clear"
    >
      <XMarkIcon class="size-5" aria-hidden="true" />
    </button>
  </div>
</template>
