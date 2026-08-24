<script setup lang="ts">
import { AppIcon, AppInput } from "@fuelguard/ui";
import {
  CheckIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@fuelguard/ui/icons";
import { computed, nextTick, ref, watch } from "vue";
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/vue";

/**
 * Compact toolbar filter (see docs/DESIGN-SYSTEM-CONTRACT.md). Renders as a small
 * trigger button — "Risk ▾" when idle, "Risk: Review ✕" with a brand tint
 * when active — and opens the standard popover with the option list.
 * Options with more than 8 entries get an inline search box automatically
 * (units, drivers, error codes). The "" option means "no filter".
 *
 *   <FilterSelect v-model="suspicion" label="Risk" :options="suspicionOptions" />
 */
interface Option {
  value: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: Option[];
    /** Dimension name shown on the trigger, e.g. "Risk", "Unit". */
    label: string;
    disabled?: boolean;
    /** Full-width trigger — for use inside the "Filters" popover. */
    block?: boolean;
  }>(),
  { disabled: false, block: false },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const open = ref(false);
const query = ref("");
watch(open, (o) => {
  if (!o) query.value = "";
});

const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const { floatingStyles } = useFloating(triggerRef, panelRef, {
  placement: "bottom-start",
  middleware: [offset(4), flip(), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
});

const selected = computed(() => props.options.find((o) => o.value !== "" && o.value === props.modelValue));
const searchable = computed(() => props.options.length > 8);
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.options;
  return props.options.filter((o) => o.label.toLowerCase().includes(q));
});

function optionButtons(): HTMLButtonElement[] {
  return Array.from(panelRef.value?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []);
}
async function focusOption(position: "first" | "last") {
  await nextTick();
  const buttons = optionButtons();
  buttons[position === "first" ? 0 : buttons.length - 1]?.focus();
}
function onTriggerKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    open.value = true;
    void focusOption(event.key === "ArrowDown" ? "first" : "last");
  } else if (event.key === "Escape") {
    open.value = false;
  }
}
function onOptionKeydown(event: KeyboardEvent) {
  const buttons = optionButtons();
  const current = buttons.indexOf(event.currentTarget as HTMLButtonElement);
  let next: number;
  if (event.key === "ArrowDown") next = Math.min(current + 1, buttons.length - 1);
  else if (event.key === "ArrowUp") next = Math.max(current - 1, 0);
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = buttons.length - 1;
  else if (event.key === "Escape") {
    event.preventDefault();
    open.value = false;
    triggerRef.value?.focus();
    return;
  } else return;
  event.preventDefault();
  buttons[next]?.focus();
}

function select(value: string) {
  emit("update:modelValue", value);
  open.value = false;
}
function clear() {
  emit("update:modelValue", "");
  open.value = false;
}
</script>

<template>
  <div :class="block ? 'w-full' : 'inline-block'">
    <div class="flex items-center gap-1" :class="block ? 'w-full' : ''">
      <button
        ref="triggerRef"
        type="button"
        :disabled="disabled"
        class="inline-flex h-8 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
        :class="[
          selected
            ? 'bg-brand-50/60 text-brand-800 ring-edge hover:bg-brand-50'
            : 'bg-surface text-ink-secondary ring-edge hover:bg-surface-subtle',
          block ? 'min-w-0 flex-1 justify-between' : '',
        ]"
        :aria-expanded="open"
        aria-haspopup="listbox"
        @click.stop="open = !open"
        @keydown="onTriggerKeydown"
      >
        <span class="truncate" :class="block ? '' : 'max-w-[14rem]'">
          {{ label }}<template v-if="selected">: {{ selected.label }}</template>
        </span>
        <AppIcon :icon="ChevronDownIcon" class="size-4 shrink-0 text-ink-tertiary" aria-hidden="true" />
      </button>
      <button
        v-if="selected"
        type="button"
        class="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-brand-700 ring-1 ring-inset ring-edge hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        :aria-label="`Clear ${label} filter`"
        @click.stop="clear"
      >
        <AppIcon :icon="XMarkIcon" class="size-4" aria-hidden="true" />
      </button>
    </div>

    <Teleport to="body">
      <template v-if="open">
        <button type="button" class="fixed inset-0 z-scrim" aria-label="Close filter options" @click.stop="open = false" />
        <div
          ref="panelRef"
          :style="floatingStyles"
          class="z-popover w-60 rounded-control bg-surface py-1 text-sm shadow-overlay ring-1 ring-edge-subtle"
          role="listbox"
          :aria-label="`${label} options`"
        >
          <div v-if="searchable" class="border-b border-edge-subtle px-2 pb-2 pt-1.5">
            <div class="relative">
              <AppIcon :icon="MagnifyingGlassIcon" class="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-ink-tertiary" aria-hidden="true" />
              <AppInput
                v-model="query"
                type="text"
                :placeholder="`Filter ${label.toLowerCase()}s…`"
                class="h-8 py-1 pl-7 pr-2"
                @click.stop
              />
            </div>
          </div>
          <div class="max-h-64 overflow-auto py-0.5">
            <button
              v-for="opt in filtered"
              :key="opt.value"
              type="button"
              class="flex w-full items-center px-3 py-1.5 text-left"
              :class="
                opt.value === modelValue || (opt.value === '' && !selected)
                  ? 'bg-brand-50 font-medium text-brand-700'
                  : 'text-ink hover:bg-surface-subtle'
              "
              role="option"
              :aria-selected="opt.value === modelValue"
              @click="select(opt.value)"
              @keydown="onOptionKeydown"
            >
              <AppIcon
:icon="CheckIcon"
                class="mr-2 size-4 shrink-0 text-brand-600"
                :class="opt.value === modelValue || (opt.value === '' && !selected) ? 'opacity-100' : 'opacity-0'"
                aria-hidden="true"
              />
              <span class="truncate">{{ opt.label }}</span>
            </button>
            <p v-if="filtered.length === 0" class="px-3 py-2 text-ink-muted">No matches</p>
          </div>
        </div>
      </template>
    </Teleport>
  </div>
</template>
