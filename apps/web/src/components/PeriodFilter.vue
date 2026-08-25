<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { AppButton as BaseButton, AppDateField, AppIcon } from "@fuelguard/ui";
import { CalendarIcon, XMarkIcon } from "@fuelguard/ui/icons";
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/vue";
import { describeWindow, windowDays, type SpendPreset } from "@fuelguard/shared";

/**
 * The reporting window: named periods first, exact dates second.
 *
 * ── WHY THIS REPLACED THE BARE CALENDAR ──────────────────────────────────────────────────────────
 * The page used `DateRangeFilter`, whose only gesture is a two-click range on a calendar: the first
 * click is deliberately inert (`partialRange: false`, or auto-apply would close the menu on a
 * half-picked range) and NOTHING on screen acknowledges it. A reader clicks a date, sees the window
 * unchanged, and concludes the control is broken. Reported as exactly that — "it is preset to a
 * certain date and we can't change it" — and the two-click gesture was still the only way in even
 * after the state bug behind the first report was fixed.
 *
 * So the calendar stops being the only path. Named periods are one click and cannot be half-done, and
 * the two date fields are directly typeable, which is also the only route that works for somebody on a
 * keyboard or a screen reader. Nothing here can leave the window half-set: every control commits both
 * ends together through `setWindow`.
 *
 * ── WHY IT LIVES IN components/ ──────────────────────────────────────────────────────────────────
 * Beside `FilterBar`, `FilterSelect` and `DateRangeFilter`, which are the same kind of thing: reusable
 * toolbar composites that own a trigger and a teleported panel. `lint:ui-adoption` counts raw `<button>`
 * in `pages/` and `features/` because markup hand-rolled there is markup the design system has lost
 * control of — a control with a scrim and a custom trigger is a composite, and composites belong here
 * where its siblings already are. Nothing about it is specific to fuel spend: it takes its periods as
 * data.
 *
 * ── WHY THE FIELDS ARE LOCAL UNTIL THEY ARE VALID ────────────────────────────────────────────────
 * A `<input type="date">` emits on every keystroke, so a half-typed year is a real emit — binding it
 * straight to the window would rewrite the URL to 0002-08-05 while somebody types 2026. The draft is
 * held here and committed only once both ends parse.
 */
const props = defineProps<{
  from: string;
  to: string;
  presets: readonly SpendPreset[];
  /** The preset the current window matches, or null when it was built by hand. */
  activePreset: SpendPreset | null;
  /** Set when a link carried a window that had to be corrected. */
  notice?: string | null;
}>();
const emit = defineEmits<{
  /** Both ends, always together — a window is one fact and must never be written as two. */
  apply: [from: string, to: string];
  preset: [key: string];
  clear: [];
}>();

const open = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const { floatingStyles } = useFloating(triggerRef, panelRef, {
  placement: "bottom-start",
  middleware: [offset(4), flip(), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
});

const draftFrom = ref(props.from);
const draftTo = ref(props.to);
// Re-sync whenever the window changes underneath (a preset, a link, another tab's control).
watch(
  () => [props.from, props.to] as const,
  ([f, t]) => {
    draftFrom.value = f;
    draftTo.value = t;
  },
);

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const draftValid = computed(() => YMD.test(draftFrom.value) && YMD.test(draftTo.value));
/** Reversed is not invalid — `normalizeWindow` swaps it — but saying so beats silently reordering. */
const draftReversed = computed(() => draftValid.value && draftFrom.value > draftTo.value);

const label = computed(() => props.activePreset?.label ?? describeWindow({ from: props.from, to: props.to }));
const dayCount = computed(() => windowDays(props.from, props.to));

/**
 * Escape closes the panel, and focus moves into it when it opens.
 *
 * The listener is on the DOCUMENT rather than on the panel. A `role="dialog"` div is not an interactive
 * element, so a `@keydown` bound to it is unreachable for anyone who has not happened to focus that
 * exact node — which is what `vuejs-accessibility/no-static-element-interactions` objects to, and it is
 * right. Listening at the document means Escape works from wherever focus actually is: the trigger, a
 * preset button, or half-way through typing a date.
 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") open.value = false;
}
watch(open, async (isOpen) => {
  if (!isOpen) {
    document.removeEventListener("keydown", onKeydown);
    return;
  }
  document.addEventListener("keydown", onKeydown);
  await nextTick();
  panelRef.value?.focus();
});
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));

function commit(): void {
  if (!draftValid.value) return;
  emit("apply", draftFrom.value, draftTo.value);
  open.value = false;
}
function choose(key: string): void {
  emit("preset", key);
  open.value = false;
}
</script>

<template>
  <div class="inline-flex items-center gap-1">
    <button
      ref="triggerRef"
      type="button"
      class="inline-flex h-8 items-center gap-1.5 rounded-control bg-brand-50/60 px-2.5 text-sm font-medium text-brand-800 ring-1 ring-inset ring-edge transition-colors hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :aria-label="`Reporting period: ${label}, ${dayCount} days. Change it`"
      @click.stop="open = !open"
      @keydown.escape="open = false"
    >
      <AppIcon :icon="CalendarIcon" class="size-4 shrink-0 text-brand-600" aria-hidden="true" />
      {{ label }}
      <span class="text-2xs text-ink-tertiary">{{ dayCount }}d</span>
    </button>

    <Teleport to="body">
      <template v-if="open">
        <button type="button" class="fixed inset-0 z-scrim" aria-label="Close period picker" @click.stop="open = false" />
        <div
          ref="panelRef"
          :style="floatingStyles"
          class="z-popover w-80 rounded-control bg-surface p-4 text-sm shadow-overlay ring-1 ring-edge-subtle"
          role="dialog"
          aria-label="Reporting period"
          tabindex="-1"
        >
          <!-- Named periods first: one click, and a click cannot leave the window half-set. -->
          <p class="text-xs font-semibold text-ink">Period</p>
          <div class="mt-2 grid grid-cols-2 gap-1.5">
            <BaseButton
              v-for="p in presets"
              :key="p.key"
              size="sm"
              :variant="activePreset?.key === p.key ? 'primary' : 'secondary'"
              @click="choose(p.key)"
            >
              {{ p.label }}
            </BaseButton>
          </div>

          <!-- Exact dates second: typeable, and the only route that works on a keyboard. -->
          <p class="mt-4 text-xs font-semibold text-ink">Exact dates</p>
          <div class="mt-2 flex items-center gap-2">
            <AppDateField v-model="draftFrom" :invalid="!draftValid" aria-label="Start date" />
            <span class="text-ink-tertiary">→</span>
            <AppDateField v-model="draftTo" :invalid="!draftValid" aria-label="End date" />
          </div>
          <p v-if="draftReversed" class="mt-1.5 text-xs text-ink-muted">
            The start is after the end. Applying will swap them.
          </p>
          <p v-else-if="!draftValid" class="mt-1.5 text-xs text-danger-700">Both dates are needed.</p>

          <div class="mt-3 flex items-center justify-between gap-2">
            <BaseButton variant="ghost" size="sm" @click="emit('clear'); open = false">Reset</BaseButton>
            <BaseButton size="sm" :disabled="!draftValid" @click="commit">Apply</BaseButton>
          </div>

          <p v-if="notice" class="mt-3 rounded-surface bg-caution-50 px-2.5 py-2 text-xs text-caution-800 ring-1 ring-caution-100">
            {{ notice }}
          </p>
        </div>
      </template>
    </Teleport>

    <button
      v-if="activePreset?.key !== 'd90'"
      type="button"
      class="inline-flex size-8 items-center justify-center rounded-control text-brand-700 ring-1 ring-inset ring-edge hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      aria-label="Reset period to the last 90 days"
      @click="emit('clear')"
    >
      <AppIcon :icon="XMarkIcon" class="size-4" aria-hidden="true" />
    </button>
  </div>
</template>
