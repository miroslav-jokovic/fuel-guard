<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from "vue";
import { useFloating, offset, flip, shift, autoUpdate, type Placement } from "@floating-ui/vue";

/**
 * A card that opens on hover or keyboard focus of its trigger and is painted ABOVE the page — the
 * positioning recipe every dropdown here already uses (`KebabMenu`, `FilterSelect`, `ColumnPicker`):
 * `<Teleport to="body">` plus `@floating-ui/vue` with offset / flip / shift and `autoUpdate`.
 *
 * ── WHY NOT `absolute` INSIDE THE CELL (2026-11-23) ─────────────────────────────────────────────────
 * `FileCell` drew its two cards as `invisible absolute … z-popover` children of the cell. Inside a
 * `DataTable` that cannot work, and no z-index fixes it: the table body is an `overflow-x-auto` /
 * `overflow-y-auto` scroller (DataTable.vue, the `overflow-x-auto` wrapper), so the card is CLIPPED at
 * the scroller's edge, and every row's pinned first cell is `sticky z-raised`, so each later row
 * paints OVER a card opened from the row above it. The owner saw it as "the preview goes under the
 * rows". A card in `body` is outside both, and `flip()` turns it upward on the last rows on screen.
 *
 * ── THE POINTER'S WAY IN ────────────────────────────────────────────────────────────────────────────
 * Once the card is not a DOM child of the trigger, leaving the trigger to reach the card's own buttons
 * (FileCell's Download) is a `pointerleave`. So a leave only SCHEDULES the close, and entering the card
 * cancels it — `CLOSE_DELAY_MS` is enough to cross the 4 px `offset`, short enough not to linger.
 *
 * ── KEYBOARD ────────────────────────────────────────────────────────────────────────────────────────
 * Focus on the trigger opens it and Escape closes it, as the old `group-focus-within` did. What
 * teleporting changes is Tab order: a control INSIDE the card is no longer next after the trigger.
 * That is acceptable only because such a control must be a shortcut — FileCell's Download is also in
 * the gallery the thumb opens on Enter (`DocumentPreview`'s Download). A card whose button is the
 * only way to an action does not belong in a hover card; give the action its own control.
 */
const props = withDefaults(
  defineProps<{
    placement?: Placement;
    /** Tailwind width of the card, e.g. "w-56". The surface recipe itself is fixed here. */
    width?: string;
  }>(),
  { placement: "bottom-start", width: "w-56" },
);

const CLOSE_DELAY_MS = 120;
const open = ref(false);
const id = useId();
const triggerRef = ref<HTMLElement | null>(null);
const cardRef = ref<HTMLElement | null>(null);
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const { floatingStyles } = useFloating(triggerRef, cardRef, {
  placement: computed(() => props.placement),
  middleware: [offset(4), flip(), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
});

function cancelClose(): void {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
}
function show(): void {
  cancelClose();
  open.value = true;
}
function scheduleClose(): void {
  cancelClose();
  closeTimer = setTimeout(() => (open.value = false), CLOSE_DELAY_MS);
}
/** Focus moving between the trigger and its own card is not leaving. */
function onFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null;
  if (next && (triggerRef.value?.contains(next) || cardRef.value?.contains(next))) return;
  scheduleClose();
}
function hide(): void {
  cancelClose();
  open.value = false;
}
onBeforeUnmount(cancelClose);
defineExpose({ open });
</script>

<template>
  <!-- The wrapper only listens; the control inside the trigger slot is what takes focus and clicks. -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <span
    ref="triggerRef"
    class="inline-flex"
    :aria-describedby="open ? id : undefined"
    @pointerenter="show"
    @pointerleave="scheduleClose"
    @focusin="show"
    @focusout="onFocusOut"
    @keydown.escape="hide"
  >
    <slot name="trigger" />
  </span>
  <Teleport to="body">
    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
    <div
      v-if="open"
      :id="id"
      ref="cardRef"
      role="tooltip"
      :style="floatingStyles"
      :class="width"
      class="z-popover whitespace-normal rounded-surface bg-surface p-3 text-xs shadow-overlay ring-1 ring-edge"
      data-test="hover-card"
      @pointerenter="cancelClose"
      @pointerleave="scheduleClose"
      @focusout="onFocusOut"
      @keydown.escape="hide"
    >
      <slot />
    </div>
  </Teleport>
</template>
