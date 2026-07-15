<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChevronUpDownIcon } from "@heroicons/vue/20/solid";
import { CheckIcon } from "@heroicons/vue/20/solid";
import BaseInput from "./BaseInput.vue";

/**
 * Field-styled searchable select (see docs/DESIGN-SYSTEM.md §3). Same look as the
 * other form fields — it IS a BaseInput with a droplist below — so "search and
 * droplist work together": click to see every option, type to filter. Use inside
 * a FormField for the label. For a compact table-toolbar filter use FilterSelect
 * instead; this is the data-entry form control.
 *
 *   <FormField v-slot="{ id }" label="Truck">
 *     <ComboSelect :id="id" v-model="vehicleId" :options="truckOptions" placeholder="Search trucks…" />
 *   </FormField>
 */
interface Option {
  value: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: Option[];
    id?: string;
    placeholder?: string;
    disabled?: boolean;
  }>(),
  { id: undefined, placeholder: "Select…", disabled: false },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const selectedLabel = computed(() => props.options.find((o) => o.value === props.modelValue)?.label ?? "");

const query = ref(selectedLabel.value);
const open = ref(false);
// Keep the box text in sync when the selection changes from outside.
watch(selectedLabel, (l) => {
  if (!open.value) query.value = l;
});

// While the query still equals the current selection we show the whole list (a plain click to reopen), and
// only start filtering once the user actually types something different.
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q || query.value === selectedLabel.value) return props.options;
  return props.options.filter((o) => o.label.toLowerCase().includes(q));
});

function onFocus() {
  if (props.disabled) return;
  open.value = true;
}
function onInput(v: string) {
  query.value = v;
  open.value = true;
}
function pick(o: Option) {
  emit("update:modelValue", o.value);
  query.value = o.label;
  open.value = false;
}
function onBlur() {
  // Discard a half-typed non-match: fall back to the committed selection.
  query.value = selectedLabel.value;
  open.value = false;
}
</script>

<template>
  <div class="relative" @focusout="onBlur" @focusin="onFocus">
    <BaseInput
      :id="id"
      :model-value="query"
      :placeholder="placeholder"
      :disabled="disabled"
      autocomplete="off"
      role="combobox"
      :aria-expanded="open"
      class="pr-9"
      @update:model-value="onInput"
    />
    <span class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5">
      <ChevronUpDownIcon class="size-5 text-ink-subtle" aria-hidden="true" />
    </span>
    <ul
      v-if="open"
      class="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md bg-surface py-1 text-sm shadow-lg ring-1 ring-edge"
      role="listbox"
    >
      <li
        v-for="o in filtered"
        :key="o.value"
        class="flex cursor-pointer items-center gap-2 px-3 py-1.5"
        :class="o.value === modelValue ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-secondary hover:bg-surface-subtle'"
        role="option"
        :aria-selected="o.value === modelValue"
        @mousedown.prevent="pick(o)"
      >
        <CheckIcon class="size-4 shrink-0 text-brand-600" :class="o.value === modelValue ? 'opacity-100' : 'opacity-0'" aria-hidden="true" />
        <span class="truncate">{{ o.label }}</span>
      </li>
      <li v-if="filtered.length === 0" class="px-3 py-2 text-ink-muted">No matches</li>
    </ul>
  </div>
</template>
