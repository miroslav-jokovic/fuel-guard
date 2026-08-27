<script setup lang="ts">
import { AppIcon, AppInput } from "@silvicom/ui";
import {
  CheckIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@silvicom/ui/icons";
import { computed, nextTick, ref, watch } from "vue";
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/vue";

/**
 * Compact toolbar filter (see docs/DESIGN-SYSTEM-CONTRACT.md). Renders as a small
 * trigger button — "Risk ▾" when idle, "Risk: Review ✕" with a brand tint
 * when active — and opens the standard popover with the option list.
 * Options with more than 8 entries get an inline search box automatically
 * (units, drivers, error codes). The "" option means "no filter".
 *
 * ── WHY `multiple` DRAWS A BOX AND SINGLE-SELECT DRAWS A TICK ───────────────────────────────────
 * Single-select showed a tick on the chosen row and `opacity-0` on the rest, which is right: exactly
 * one row is in force and an empty box beside every other one would be noise.
 *
 * Multi-select inherited that, and it was wrong. An unchosen truck rendered NOTHING — no box, no
 * outline, nothing to click at — so the panel gave no sign it accepted more than one answer, and the
 * only evidence a truck WAS picked was a tick on a tint measuring 1.04:1 against the panel behind it.
 * Reported as "the checkboxes are so light they are almost invisible", which was generous: for the
 * unchecked rows there was no checkbox at all.
 *
 * So `multiple` gets a real box — `border-edge-control` at 3.43:1 empty, filled `brand-600` at 4.60:1
 * with a white tick — and the row tint moved to `brand-100`. The tint is support, never the signal:
 * even `brand-200` only reaches 1.34:1, so no wash can carry selection on its own.
 *
 *   <FilterSelect v-model="suspicion" label="Risk" :options="suspicionOptions" />
 */
interface Option {
  value: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    /** Single-select value, or the selected values when `multiple`. */
    modelValue: string | string[];
    options: Option[];
    /** Dimension name shown on the trigger, e.g. "Risk", "Unit". */
    label: string;
    disabled?: boolean;
    /** Full-width trigger — for use inside the "Filters" popover. */
    block?: boolean;
    /**
     * Pick several at once. The panel stays open between clicks and the trigger summarises the count.
     *
     * Added here rather than as a second component on purpose: a multi-select filter is the same job as
     * a single-select filter — same toolbar chip, same popover, same search, same keyboard handling —
     * and the design contract's "one primitive per job" is what stops a page growing two controls that
     * look almost but not quite alike.
     */
    multiple?: boolean;
  }>(),
  { disabled: false, block: false, multiple: false },
);
const emit = defineEmits<{ "update:modelValue": [value: string | string[]] }>();

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

/** Selected values, normalised — one code path for both modes below. */
const chosen = computed<string[]>(() =>
  props.multiple
    ? Array.isArray(props.modelValue) ? props.modelValue : []
    : typeof props.modelValue === "string" && props.modelValue !== "" ? [props.modelValue] : [],
);
const isChosen = (value: string) => chosen.value.includes(value);
/**
 * What the row should LOOK like, which is not always what is in `modelValue`.
 *
 * The "" row means "no filter", so with nothing picked it is the row that is in force and has always
 * been ticked. Its checkbox has to agree, or a multi-select opens with every box empty while the
 * trigger says "All trucks" — the state shown and the state described disagreeing on the first frame.
 */
const rowChecked = (value: string) => isChosen(value) || (value === "" && !active.value);
const selected = computed(() => (chosen.value.length > 0 ? props.options.find((o) => o.value === chosen.value[0]) : undefined));
/** What the trigger says after the label: one name, or how many are picked. */
const summary = computed(() => {
  if (chosen.value.length === 0) return "";
  if (chosen.value.length === 1) return selected.value?.label ?? chosen.value[0]!;
  return `${chosen.value.length} selected`;
});
const active = computed(() => chosen.value.length > 0);
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
  if (!props.multiple) {
    emit("update:modelValue", value);
    open.value = false;
    return;
  }
  // Multi-select keeps the panel OPEN: picking five trucks should be five clicks, not five
  // click-reopen-scroll cycles. The scrim click and Escape are how it closes.
  if (value === "") {
    emit("update:modelValue", []);
    return;
  }
  const next = isChosen(value) ? chosen.value.filter((v) => v !== value) : [...chosen.value, value];
  emit("update:modelValue", next);
}
function clear() {
  emit("update:modelValue", props.multiple ? [] : "");
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
          active
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
          {{ label }}<template v-if="summary">: {{ summary }}</template>
        </span>
        <AppIcon :icon="ChevronDownIcon" class="size-4 shrink-0 text-ink-tertiary" aria-hidden="true" />
      </button>
      <button
        v-if="active"
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
          :aria-multiselectable="multiple || undefined"
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
                rowChecked(opt.value)
                  ? 'bg-brand-100 font-medium text-brand-700'
                  : 'text-ink hover:bg-surface-subtle'
              "
              role="option"
              :aria-selected="isChosen(opt.value)"
              @click="select(opt.value)"
              @keydown="onOptionKeydown"
            >
              <!-- ── MULTI-SELECT: A BOX THAT IS THERE WHEN IT IS EMPTY ────────────────────────
                   Drawn, not an <input type="checkbox">: this row is a `role="option"` button and
                   nesting a focusable control inside it would break both the listbox semantics and
                   the keyboard handling above. `aria-selected` on the button is what a screen reader
                   reads; the box is for eyes, so it is aria-hidden.

                   `AppCheckbox` is the real control and is deliberately NOT used here for the same
                   reason — it wraps a native input in a <label>. -->
              <span
                v-if="multiple"
                class="mr-2.5 flex size-4 shrink-0 items-center justify-center rounded-detail border transition-colors"
                :class="rowChecked(opt.value)
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-edge-control bg-surface'"
                aria-hidden="true"
              >
                <AppIcon v-if="rowChecked(opt.value)" :icon="CheckIcon" class="size-3" />
              </span>
              <AppIcon
                v-else
                :icon="CheckIcon"
                class="mr-2 size-4 shrink-0 text-brand-600"
                :class="rowChecked(opt.value) ? 'opacity-100' : 'opacity-0'"
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
