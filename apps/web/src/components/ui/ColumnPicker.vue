<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { AppIcon } from "@silvicom/ui";
import { TableCellsIcon } from "@silvicom/ui/icons";
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/vue";
import type { TableColumns } from "@/composables/useTableColumns";

/**
 * Which columns a table shows — the toolbar half of `useTableColumns` (R3b, D-ROS3).
 *
 * Goes in `FilterBar`'s existing `#actions` slot (design contract §5.5), beside the count. It is a
 * table-level control rather than a filter: it changes what you see OF a row, never which rows you
 * see, so it does not belong among the dimensions in `#filters` and never contributes a chip.
 *
 * The trigger deliberately borrows the "Filters" trigger's markup rather than inventing a second
 * toolbar button shape — one primitive per job, and these two sit side by side.
 *
 * The badge counts what is HIDDEN, because that is the state worth noticing: a reader who cannot
 * find a column needs to see that they turned some off. "9 of 11 shown" reads as information; a
 * count of 2 beside a column icon reads as "you have hidden two", which is the question being
 * answered.
 */
const props = defineProps<{ columns: TableColumns; label?: string }>();

const open = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const { floatingStyles } = useFloating(triggerRef, panelRef, {
  placement: "bottom-end",
  middleware: [offset(4), flip(), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
});

/**
 * Escape closes it from anywhere, including from a checkbox inside the panel.
 *
 * On the panel element itself this would be a `keydown` handler on a `div`, which
 * `vuejs-accessibility/no-static-element-interactions` refuses — correctly, since a div is not
 * focusable and a handler there only ever fires by bubbling. A document listener while open is the
 * form that actually works: the panel is teleported to `<body>`, so there is no common ancestor
 * between it and the trigger to listen on instead.
 *
 * ⚠ `FilterBar`'s "Filters" popover — the same shape, four files away — does NOT do this: its
 * Escape handler sits on the trigger, so pressing Escape with focus inside that panel does nothing.
 * Left alone here rather than fixed in passing, because it is one primitive's keyboard contract and
 * belongs to a step that owns popover behaviour, not to a column picker.
 */
const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") open.value = false;
};
watch(open, (isOpen) => {
  if (isOpen) document.addEventListener("keydown", onKey);
  else document.removeEventListener("keydown", onKey);
});
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="relative">
    <button
      ref="triggerRef"
      type="button"
      class="inline-flex items-center gap-x-1.5 rounded-control bg-surface px-2.5 py-1.5 text-sm font-medium text-ink-secondary ring-1 ring-inset ring-edge hover:bg-surface-subtle"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click.stop="open = !open"
    >
      <AppIcon :icon="TableCellsIcon" class="size-4 text-ink-tertiary" aria-hidden="true" />
      {{ props.label ?? "Columns" }}
      <span
        v-if="props.columns.hiddenCount.value"
        class="rounded-full bg-brand-50 px-1.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-600/20"
        >{{ props.columns.hiddenCount.value }} hidden</span
      >
    </button>
    <Teleport to="body">
      <template v-if="open">
        <button type="button" class="fixed inset-0 z-scrim" aria-label="Close the column list" @click.stop="open = false" />
        <div
          ref="panelRef"
          :style="floatingStyles"
          class="z-popover w-72 rounded-control bg-surface p-4 text-sm shadow-overlay ring-1 ring-edge-subtle"
          role="dialog"
          aria-label="Columns"
        >
          <div class="space-y-1">
            <label
              v-for="choice in props.columns.choices.value"
              :key="choice.column.key"
              class="flex items-center gap-2.5 rounded-control px-1.5 py-1.5 hover:bg-surface-subtle"
              :class="choice.locked ? 'cursor-default' : 'cursor-pointer'"
            >
              <input
                type="checkbox"
                class="size-4 shrink-0 rounded-control border-edge-control accent-brand-600"
                :checked="choice.shown"
                :disabled="choice.locked"
                @change="props.columns.toggle(choice.column.key)"
              />
              <span class="min-w-0 flex-1 truncate" :class="choice.locked ? 'text-ink-muted' : 'text-ink-secondary'">
                {{ choice.column.label }}
              </span>
              <!-- The identifier column is the row's name and the card view's heading; a table whose
                   rows cannot be told apart is not a shorter table, it is an unusable one. -->
              <span v-if="choice.locked" class="shrink-0 text-2xs uppercase tracking-wide text-ink-tertiary">
                Always
              </span>
            </label>
          </div>
          <button
            v-if="props.columns.hiddenCount.value"
            type="button"
            class="mt-3 w-full rounded-control px-2 py-1.5 text-sm font-medium text-link ring-1 ring-inset ring-edge hover:bg-surface-subtle"
            @click="props.columns.showAll()"
          >
            Show all columns
          </button>
        </div>
      </template>
    </Teleport>
  </div>
</template>
