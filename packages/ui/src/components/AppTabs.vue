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
    /**
     * A vertical list of tabs — a master–detail rail, where picking a row swaps the panel beside it.
     * Same widget, same roving tabindex; Up/Down move the selection instead of Left/Right, which is
     * what WAI-ARIA's pattern prescribes for `aria-orientation="vertical"`. The strip's well and pill
     * do not apply: a rail sits on the page ground and marks its selection with the selected surface.
     */
    orientation?: "horizontal" | "vertical";
  }>(),
  { idPrefix: undefined, scrollable: false, orientation: "horizontal" },
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
  const vertical = props.orientation === "vertical";
  switch (event.key) {
    case vertical ? "ArrowDown" : "ArrowRight":
      select(i === last ? 0 : i + 1);
      break;
    case vertical ? "ArrowUp" : "ArrowLeft":
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
    class="flex text-sm"
    :class="[
      orientation === 'vertical'
        ? 'flex-col gap-0.5'
        : 'gap-1 rounded-surface bg-surface-muted p-1',
      scrollable ? 'overflow-x-auto' : '',
    ]"
    role="tablist"
    :aria-label="label"
    :aria-orientation="orientation === 'vertical' ? 'vertical' : undefined"
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
        orientation === 'vertical' ? 'flex w-full items-center justify-between gap-2 text-left' : '',
        tab.value === modelValue
          ? orientation === 'vertical'
            ? 'bg-selected-surface text-ink'
            : 'bg-surface text-ink'
          : orientation === 'vertical'
            ? 'text-ink-secondary hover:bg-surface-subtle hover:text-ink'
            : 'text-ink-muted hover:text-ink-secondary',
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
