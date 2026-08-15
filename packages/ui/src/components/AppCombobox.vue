<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { CheckIcon, ChevronUpDownIcon } from "../icons";
import AppIcon from "./AppIcon.vue";
import AppInput from "./AppInput.vue";

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: ComboboxOption[];
    id?: string;
    placeholder?: string;
    disabled?: boolean;
  }>(),
  { id: undefined, placeholder: "Select…", disabled: false },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const selectedLabel = computed(
  () => props.options.find((option) => option.value === props.modelValue)?.label ?? "",
);
const query = ref(selectedLabel.value);
const open = ref(false);
const activeIndex = ref(-1);
const listboxId = `combo-${useId()}`;
const filtered = computed(() => {
  const value = query.value.trim().toLowerCase();
  if (!value || query.value === selectedLabel.value) return props.options;
  return props.options.filter((option) => option.label.toLowerCase().includes(value));
});

watch(selectedLabel, (label) => {
  if (!open.value) query.value = label;
});
watch(filtered, (options) => {
  if (activeIndex.value >= options.length) activeIndex.value = options.length - 1;
});

function focus() {
  if (props.disabled) return;
  open.value = true;
  activeIndex.value = Math.max(
    0,
    filtered.value.findIndex((option) => option.value === props.modelValue),
  );
}
function input(value: string) {
  query.value = value;
  open.value = true;
  activeIndex.value = filtered.value.findIndex((option) => !option.disabled);
}
function pick(option: ComboboxOption) {
  if (option.disabled) return;
  emit("update:modelValue", option.value);
  query.value = option.label;
  open.value = false;
}
function blur() {
  query.value = selectedLabel.value;
  open.value = false;
}
function move(delta: number) {
  const options = filtered.value;
  if (!options.length) return;
  let next = activeIndex.value;
  do next = (next + delta + options.length) % options.length;
  while (options[next]?.disabled && next !== activeIndex.value);
  activeIndex.value = next;
}
function onKeydown(event: KeyboardEvent) {
  if (props.disabled) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    open.value = true;
    move(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Home" && open.value) {
    event.preventDefault();
    activeIndex.value = filtered.value.findIndex((option) => !option.disabled);
  } else if (event.key === "End" && open.value) {
    event.preventDefault();
    activeIndex.value = filtered.value.findLastIndex((option) => !option.disabled);
  } else if (
    (event.key === "Enter" || event.key === " ") &&
    open.value &&
    filtered.value[activeIndex.value]
  ) {
    event.preventDefault();
    pick(filtered.value[activeIndex.value]!);
  } else if (event.key === "Escape" && open.value) {
    event.preventDefault();
    blur();
  } else if (event.key === "Tab") {
    blur();
  }
}
</script>

<template>
  <div class="relative" @focusout="blur" @focusin="focus">
    <AppInput
      :id="id"
      :model-value="query"
      :placeholder="placeholder"
      :disabled="disabled"
      autocomplete="off"
      role="combobox"
      :aria-expanded="open"
      aria-autocomplete="list"
      :aria-controls="listboxId"
      :aria-activedescendant="
        open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
      "
      class="pr-9"
      @update:model-value="input"
      @keydown="onKeydown"
    />
    <AppIcon
      :icon="ChevronUpDownIcon"
      class="pointer-events-none absolute top-1/2 right-2.5 size-5 -translate-y-1/2 text-ink-tertiary"
      aria-hidden="true"
    />
    <ul
      v-if="open"
      :id="listboxId"
      class="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-control bg-surface py-1 text-sm shadow-md ring-1 ring-edge"
      role="listbox"
    >
      <li
        v-for="(option, index) in filtered"
        :id="`${listboxId}-option-${index}`"
        :key="option.value"
        class="flex items-center gap-2 px-3 py-1.5"
        :class="[
          option.disabled ? 'cursor-not-allowed text-ink-disabled' : 'cursor-pointer',
          option.value === modelValue ? 'font-medium text-brand-700' : 'text-ink-secondary',
          index === activeIndex
            ? 'bg-selected-surface'
            : !option.disabled && 'hover:bg-surface-subtle',
        ]"
        role="option"
        :aria-selected="option.value === modelValue"
        :aria-disabled="option.disabled || undefined"
        @mousedown.prevent="pick(option)"
      >
        <AppIcon
          :icon="CheckIcon"
          class="size-4 shrink-0 text-brand-600"
          :class="option.value === modelValue ? 'opacity-100' : 'opacity-0'"
          aria-hidden="true"
        />
        <span class="truncate">{{ option.label }}</span>
      </li>
      <li v-if="filtered.length === 0" class="px-3 py-2 text-ink-tertiary">No matches</li>
    </ul>
  </div>
</template>
