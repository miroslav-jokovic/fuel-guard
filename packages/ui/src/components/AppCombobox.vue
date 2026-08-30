<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch, nextTick } from "vue";
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
    /**
     * The options are already filtered by whoever supplied them (a server search), so this component
     * must not filter them a second time — a remote result set does not contain the substring the
     * user typed in the label often enough for a local pass to be anything but a bug. Callers using
     * this also listen to `update:query`, which is the only way they learn what to search for.
     */
    serverFiltered?: boolean;
    /** Shown in place of the list while a server search is in flight. */
    loading?: boolean;
    /** What an empty list means here — a remote lookup wants to say more than "No matches". */
    emptyText?: string;
  }>(),
  {
    id: undefined,
    placeholder: "Select…",
    disabled: false,
    serverFiltered: false,
    loading: false,
    emptyText: "No matches",
  },
);
const emit = defineEmits<{ "update:modelValue": [value: string]; "update:query": [value: string] }>();
const selectedLabel = computed(
  () => props.options.find((option) => option.value === props.modelValue)?.label ?? "",
);
const query = ref(selectedLabel.value);
const open = ref(false);
const activeIndex = ref(-1);
const listboxId = `combo-${useId()}`;
const filtered = computed(() => {
  if (props.serverFiltered) return props.options;
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


/**
 * D-H21 — the list is TELEPORTED to <body> and positioned in viewport coordinates.
 *
 * It used to be `absolute` inside this component's `relative` wrapper at `z-sticky-lead` (20), which
 * lost two fights it could not win from inside the flow:
 *  · any ancestor with `overflow: hidden` CLIPPED it — the hazmat product line is exactly that, and
 *    a 240 px option list inside a card that ends sooner simply disappears at the card's edge;
 *  · `--z-index-chrome` is 40, so on any page where the list opened near the top it painted UNDER
 *    the app top bar.
 * `tokens.css` has defined `--z-index-popover: 70` for "dropdowns, menus, flyouts (teleported)"
 * since the layer scale was written; this is the component finally using the layer it was given.
 *
 * Position is `fixed` from the trigger's own rect, recomputed on open and on any scroll or resize
 * while open (capture phase, so a scrolling ANCESTOR is caught, not just the window). The list flips
 * above the trigger when the space below cannot hold it.
 */
const root = ref<HTMLElement | null>(null);
const listStyle = ref<Record<string, string>>({});
const MAX_LIST_H = 240; // matches max-h-60 below — the flip decision needs the number, not the class

function place() {
  const el = root.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - 8;
  const above = r.top - 8;
  const flip = below < Math.min(MAX_LIST_H, 160) && above > below;
  listStyle.value = {
    position: "fixed",
    left: `${Math.round(r.left)}px`,
    width: `${Math.round(r.width)}px`,
    maxHeight: `${Math.round(Math.min(MAX_LIST_H, flip ? above : below))}px`,
    ...(flip ? { bottom: `${Math.round(window.innerHeight - r.top + 4)}px` } : { top: `${Math.round(r.bottom + 4)}px` }),
  };
}

function bindReposition(on: boolean) {
  const fn = on ? window.addEventListener : window.removeEventListener;
  fn("scroll", place, true);
  fn("resize", place);
}

watch(open, (isOpen) => {
  bindReposition(isOpen);
  if (isOpen) void nextTick(place);
});
onBeforeUnmount(() => bindReposition(false));

/**
 * Open the list. A DELIBERATE act — a click, an arrow key, or typing — never merely receiving focus.
 *
 * It used to be bound to `focusin` on the wrapper, and that made the list reopen by itself. Picking
 * an option deliberately leaves focus on the input (`@mousedown.prevent` on the options is what stops
 * focus moving), so the field is still the document's active element afterwards — and the moment
 * anything hands focus back to the page, `focusin` fires again and the list springs open. Switching
 * browser tabs and returning does it. So does alt-tabbing, or navigating away in the app and back:
 * the browser restores focus to the last active element, and the component read that as "the user
 * wants the list".
 *
 * Opening on focus is also what WAI-ARIA's combobox pattern does not ask for: the listbox opens on
 * Down/Alt+Down, on typing, or on a click — not because the control was focused. Tabbing through a
 * form now passes over a combobox without unfurling it, which is the behaviour the pattern intends.
 */
function openList() {
  if (props.disabled || open.value) return;
  open.value = true;
  activeIndex.value = Math.max(
    0,
    filtered.value.findIndex((option) => option.value === props.modelValue),
  );
}
function input(value: string) {
  query.value = value;
  open.value = true;
  emit("update:query", value);
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
    // Open on the FIRST arrow only. `openList` seeds `activeIndex` from the selected option, so
    // calling it on every press would reset the cursor and then move one — leaving it stuck.
    if (!open.value) openList();
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
  <div ref="root" class="relative" @focusout="blur">
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
      @click="openList"
    />
    <AppIcon
      :icon="ChevronUpDownIcon"
      class="pointer-events-none absolute top-1/2 right-2.5 size-5 -translate-y-1/2 text-ink-tertiary"
      aria-hidden="true"
    />
    <Teleport to="body">
      <ul
        v-if="open"
        :id="listboxId"
        :style="listStyle"
        class="z-popover overflow-auto rounded-control bg-surface py-1 text-sm shadow-overlay ring-1 ring-edge-subtle"
        role="listbox"
      >
        <li v-if="loading" class="px-3 py-2 text-ink-tertiary">Searching…</li>
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
        <li v-if="!loading && filtered.length === 0" class="px-3 py-2 text-ink-tertiary">{{ emptyText }}</li>
      </ul>
    </Teleport>
  </div>
</template>
