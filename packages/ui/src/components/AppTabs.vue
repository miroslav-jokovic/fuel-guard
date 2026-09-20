<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  SEGMENTED_COUNT,
  SEGMENTED_COUNT_IDLE,
  SEGMENTED_COUNT_SELECTED,
  SEGMENTED_IDLE,
  SEGMENTED_NAVIGATION_INK,
  SEGMENTED_PILL,
  SEGMENTED_SEGMENT,
  SEGMENTED_WELL,
} from "../segmentedSurface";

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
 *
 * Nor the LOOK, since 2026-09-20 (D-DT16). The well, the pill and the idle ink live in
 * `../segmentedSurface` and are shared with `AppSegmentedControl`, which had drawn the same recipe
 * by hand and had already drifted from it. This file owns the widget; that file owns the style.
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

/**
 * ── THE SLIDING PILL (D-DT9, D-DT10) ───────────────────────────────────────────────────────────
 *
 * Until now the strip coloured four backgrounds and swapped which one was lit. That cannot be
 * interrupted, carries no velocity, and gives no sense that the selection MOVED — it teleports.
 * One pill element travels instead, positioned by `transform` + `width` and integrated by a
 * critically-damped spring.
 *
 * ⚠ Nothing above this comment changed. The roving tabindex, the arrow keys, the follow-focus and
 * every ARIA attribute are the same code they were, and `AppTabs.test.ts` is the acceptance
 * criterion for that: it is expected to pass UNTOUCHED, because the widget's contract with a
 * keyboard and a screen reader is the entire reason this component exists and a visual upgrade has
 * no business editing it.
 *
 * ⚠ The pill's WIDTH is animated per frame, which is a deliberate exception to "animate transform
 * and opacity only". The compositor-friendly alternative is a 1px pill under `scaleX()`, and it is
 * wrong here: scaling by a factor of 4–8 smears the 8px corner radius into an ellipse and stretches
 * the 1px ring into a visible band at the left and right edges. The pill is `position: absolute`,
 * so its reflow is confined to one out-of-flow node for about 340ms, once per click.
 */
const strip = ref<HTMLElement>();
const pill = ref<HTMLElement>();
/**
 * The element is always in the DOM; it is TRANSPARENT until it has a real box.
 *
 * ⚠ Not `v-if`. A zero-width box still paints its 1px ring and its shadow, so an unmeasured pill
 * draws a hairline at the left edge of the strip — but making its existence depend on layout makes
 * the component's DOM depend on it too, and every offset in jsdom is 0. That would have meant the
 * markup under test was not the markup that ships. Opacity costs nothing and keeps them the same.
 */
const pillVisible = ref(false);

/**
 * Apple's two designer-facing parameters rather than mass/stiffness/damping (D-DT9).
 *
 * Damping 1.0 — critically damped, no overshoot — because a tab click is a discrete command that
 * did not follow a gesture; bounce is for motion a flick preceded. Response 0.34s sits in the
 * 0.3–0.4 band Apple ships for repositioning. For a critically damped spring those two give
 * stiffness ω² and damping 2ω with ω = 2π/response.
 */
const OMEGA = (2 * Math.PI) / 0.34;
const STIFFNESS = OMEGA * OMEGA;
const DAMPING = 2 * OMEGA;
/**
 * When to stop, in the units each quantity is actually in.
 *
 * ⚠ Distance is px and velocity is px per SECOND, so one threshold for both is the bug it looks
 * like: the first draft compared each to 0.4 and the pill sat 0.05px short of its tab, still
 * running, because 0.9 px/s failed a 0.4 test. 20 px/s is a third of a pixel in a 16ms frame — the
 * point past which the next frame cannot move anything the eye can see.
 */
const REST_DISTANCE = 0.4;
const REST_SPEED = 20;

let position = { x: 0, width: 0 };
let velocity = { x: 0, width: 0 };
let frame = 0;
let last = 0;

const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function measure(): { x: number; width: number } | null {
  const el = buttons.value[activeIndex.value];
  if (!el || props.orientation === "vertical") return null;
  return { x: el.offsetLeft, width: el.offsetWidth };
}

function paint(): void {
  if (!pill.value) return;
  pill.value.style.transform = `translateX(${position.x}px)`;
  pill.value.style.width = `${position.width}px`;
}

/**
 * ⚠ Integrates from the LIVE value, every frame (D-DT10).
 *
 * Click tab 1 then tab 3 mid-flight and the pill continues from where it is ON SCREEN, carrying the
 * velocity it already had. Re-targeting from the logical value is what produces the visible jump;
 * re-targeting with the velocity zeroed is the brick wall on a reversal. Both are what a reader
 * sees as "the animation restarted" rather than "the thing changed its mind".
 */
function step(now: number): void {
  const target = measure();
  if (!target) {
    frame = 0;
    return;
  }
  // Clamped: a backgrounded tab returns with a multi-second gap, and integrating that in one step
  // throws the pill across the strip before the first frame is drawn.
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  let resting = true;
  for (const axis of ["x", "width"] as const) {
    const offset = position[axis] - target[axis];
    velocity[axis] += (-STIFFNESS * offset - DAMPING * velocity[axis]) * dt;
    position[axis] += velocity[axis] * dt;
    if (
      Math.abs(position[axis] - target[axis]) > REST_DISTANCE ||
      Math.abs(velocity[axis]) > REST_SPEED
    ) {
      resting = false;
    }
  }
  if (resting) {
    position = { ...target };
    velocity = { x: 0, width: 0 };
    paint();
    frame = 0;
    return;
  }
  paint();
  frame = requestAnimationFrame(step);
}

/** `jump` places the pill without travelling: first paint, a resize, and reduced motion. */
function settle(jump = false): void {
  const target = measure();
  pillVisible.value = Boolean(target && target.width > 0);
  if (!target) return;
  if (jump || reducedMotion()) {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    position = { ...target };
    velocity = { x: 0, width: 0 };
    paint();
    return;
  }
  if (frame) return; // already in flight — it will read the new target on its next frame
  last = performance.now();
  frame = requestAnimationFrame(step);
}

watch(() => [props.modelValue, props.tabs.length, props.orientation], () => void nextTick(() => settle()));

let observer: ResizeObserver | undefined;
onMounted(() => {
  void nextTick(() => settle(true));
  // The strip's own width decides where every tab starts, so a container change moves the target
  // without any state changing. ⚠ Guarded: jsdom has no ResizeObserver, and this component is
  // mounted in tests that have nothing to do with the pill.
  if (typeof ResizeObserver === "function" && strip.value) {
    observer = new ResizeObserver(() => settle(true));
    observer.observe(strip.value);
  }
});
onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame);
  observer?.disconnect();
});
</script>

<template>
  <nav
    ref="strip"
    class="relative flex text-sm"
    :class="[
      orientation === 'vertical' ? 'flex-col gap-0.5' : `gap-1 p-1 ${SEGMENTED_WELL}`,
      scrollable ? 'overflow-x-auto' : '',
    ]"
    role="tablist"
    :aria-label="label"
    :aria-orientation="orientation === 'vertical' ? 'vertical' : undefined"
    @keydown="onKey"
  >
    <!--
      Scenery, not state: the selection is `aria-selected` on the tab, which is what a screen reader
      reads and what the tests assert. This element carries no role and no text, so a browser that
      never runs the script above simply shows an unpilled strip with its label in brand — degraded,
      not broken.
    -->
    <span
      v-if="orientation !== 'vertical'"
      ref="pill"
      class="pointer-events-none absolute top-1 bottom-1 left-0 rounded-control"
      :class="[SEGMENTED_PILL, pillVisible ? '' : 'opacity-0']"
      aria-hidden="true"
    />
    <button
      v-for="(tab, index) in tabs"
      :id="tabId(tab.value)"
      :key="tab.value"
      ref="buttons"
      type="button"
      role="tab"
      class="relative py-1.5"
      :class="[
        SEGMENTED_SEGMENT,
        scrollable ? 'shrink-0' : '',
        orientation === 'vertical' ? 'flex w-full items-center justify-between gap-2 text-left' : '',
        tab.value === modelValue
          ? orientation === 'vertical'
            ? 'bg-selected-surface text-ink'
            : SEGMENTED_NAVIGATION_INK
          : orientation === 'vertical'
            ? 'text-ink-secondary hover:bg-surface-subtle hover:text-ink'
            : SEGMENTED_IDLE,
      ]"
      :aria-selected="tab.value === modelValue"
      :aria-controls="panelId(tab.value)"
      :tabindex="index === activeIndex ? 0 : -1"
      @click="select(index)"
    >
      <!--
        The default face is the label and its muted count. A caller that has more to say about a
        tab than a word — the permissions rail draws each role's eleven section answers beside its
        name — supplies the `tab` slot and keeps the strip, the roles and the keyboard; the slot
        is the FACE only, never the button, so it cannot un-tab a tab.
      -->
      <slot name="tab" :tab="tab" :selected="tab.value === modelValue">
        {{ tab.label }}
        <span
          v-if="tab.badge !== undefined"
          class="ml-1.5"
          :class="[
            SEGMENTED_COUNT,
            tab.value === modelValue && orientation !== 'vertical'
              ? SEGMENTED_COUNT_SELECTED
              : SEGMENTED_COUNT_IDLE,
          ]"
          >{{ tab.badge }}</span
        >
      </slot>
    </button>
  </nav>
</template>
