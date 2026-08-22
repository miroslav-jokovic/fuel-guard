<script setup lang="ts">
import { computed, ref, watch } from "vue";

/**
 * The one tab strip (UI plan U4, D-UI4).
 *
 * ── WHY IT EXISTS, AND IT IS NOT THE DEDUPLICATION ────────────────────────────────────────────
 * Six pages had hand-rolled this recipe byte-for-byte — `CompliancePage`, `DriverDetailPage`,
 * `AssignmentsPage`, `AuditPage`, `DispatchLoadsPage`, `DriverAppSettingsPage`. `AuditPage`'s own
 * header comment says the quiet part: "the house pattern is a `role="tablist"` strip of
 * `BaseButton`s … Following it beats inventing a seventh." Somebody had already noticed it was a
 * copied pattern and copied it once more, correctly, because there was nowhere to put it.
 *
 * ⚠ **The argument for the primitive is that not one of the six was accessible.** `role="tablist"`
 * is a promise to a screen reader and a keyboard: WAI-ARIA's tabs pattern requires a ROVING
 * TABINDEX — exactly one tab in the page's tab order — and Left/Right/Home/End to move between
 * them. All six put every tab in the tab order and handled no keys at all, so the markup announced
 * a widget the keyboard could not drive. Six copies of that is six bugs, and the seventh copy would
 * have been the seventh.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────────────────────────
 * No panel rendering. The six call sites each `v-if` their own panels, some of them lazily, and a
 * component that owned the panels would have to own their loading too. This owns the strip, the
 * roles, and the keyboard; the page still owns what a tab reveals.
 */
export interface TabItem {
  value: string;
  label: string;
  /** Trailing count, e.g. a queue depth. Rendered muted; omit rather than passing 0 to hide it. */
  badge?: number | string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    tabs: TabItem[];
    /**
     * Names the widget for a screen reader — required, because "tablist" alone says nothing.
     *
     * ⚠ Called `label`, not `ariaLabel`: `aria-label` is a real HTML attribute, so a prop by that
     * name is ambiguous with a fallthrough attribute and vue-tsc rejects the call site outright.
     */
    label: string;
    /**
     * When the page renders matching panels, pass the prefix it uses. Produces `${prefix}-tab-${v}`
     * on each tab and points `aria-controls` at `${prefix}-panel-${v}`. Omit when there is no panel
     * element to point at — a dangling `aria-controls` is worse than none.
     */
    idPrefix?: string;
    /** Many tabs: scroll the strip instead of wrapping it. */
    scrollable?: boolean;
  }>(),
  { idPrefix: undefined, scrollable: false },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const buttons = ref<HTMLButtonElement[]>([]);
const activeIndex = computed(() => Math.max(0, props.tabs.findIndex((t) => t.value === props.modelValue)));

watch(
  () => props.tabs.length,
  () => {
    buttons.value = buttons.value.slice(0, props.tabs.length);
  },
);

function select(index: number): void {
  const tab = props.tabs[index];
  if (!tab) return;
  emit("update:modelValue", tab.value);
  // Follow-focus: the ARIA pattern for automatic activation moves focus with the selection, so the
  // next arrow press continues from where the user actually is rather than from the old tab.
  void buttons.value[index]?.focus();
}

function onKey(event: KeyboardEvent): void {
  const last = props.tabs.length - 1;
  const i = activeIndex.value;
  switch (event.key) {
    case "ArrowRight":
      select(i === last ? 0 : i + 1);
      break;
    case "ArrowLeft":
      select(i === 0 ? last : i - 1);
      break;
    case "Home":
      select(0);
      break;
    case "End":
      select(last);
      break;
    default:
      return;
  }
  // Only for keys actually handled — swallowing everything would eat Tab out of the widget.
  event.preventDefault();
}

const tabId = (value: string): string | undefined =>
  props.idPrefix ? `${props.idPrefix}-tab-${value}` : undefined;
const panelId = (value: string): string | undefined =>
  props.idPrefix ? `${props.idPrefix}-panel-${value}` : undefined;
</script>

<template>
  <nav
    class="flex gap-1 rounded-surface bg-surface-muted p-1 text-sm"
    :class="scrollable ? 'overflow-x-auto' : ''"
    role="tablist"
    :aria-label="label"
    @keydown="onKey"
  >
    <button
      v-for="(tab, index) in tabs"
      :id="tabId(tab.value)"
      :key="tab.value"
      ref="buttons"
      type="button"
      role="tab"
      class="rounded-control px-3 py-1.5 font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      :class="[
        scrollable ? 'shrink-0' : '',
        tab.value === modelValue ? 'bg-surface text-ink' : 'text-ink-muted hover:text-ink-secondary',
      ]"
      :aria-selected="tab.value === modelValue"
      :aria-controls="panelId(tab.value)"
      :tabindex="index === activeIndex ? 0 : -1"
      @click="select(index)"
    >
      {{ tab.label }}
      <span v-if="tab.badge !== undefined" class="ml-0.5 text-ink-tertiary">{{ tab.badge }}</span>
    </button>
  </nav>
</template>
