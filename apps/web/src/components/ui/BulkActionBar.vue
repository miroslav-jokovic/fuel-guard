<script setup lang="ts">
import { AppButton as BaseButton } from "@silvicom/ui";

/**
 * The strip that appears between a list's FilterBar and its DataTable once rows are ticked:
 *
 *   [ 3 selected ] [ #note … ] ··························· [ #default actions … ] [ Clear ]
 *
 * ── WHY THIS IS A COMPONENT ─────────────────────────────────────────────────────────────────────
 * The 2026-10-12 UI audit found seven of these strips drawn by hand in six different ways: brand
 * or grey ground, with or without a ring and rounded corners (which, inside a `DataWorkspace`,
 * made a card inside the card), count and actions justified apart on some and run together on
 * others, and the actions in three button sizes — one a boxed button recoloured by hand. The reader
 * met the same idea, "you have rows ticked; here is what you can do to all of them", looking like
 * seven different controls. So the ground, the count sentence, the action alignment and the Clear
 * button live here, and a page supplies only what it can do.
 *
 * It renders nothing at zero, so a caller passes the count rather than wrapping it in a `v-if` —
 * the remaining `v-if` a caller may need is a permission (`session.can(…)`), never the count.
 * "Clear" empties the SELECTION (`clear`), not the filters; FilterBar's "Clear filters" is the
 * other one. Actions go in the default slot as `size="sm"` buttons, destructive last as
 * `variant="danger"`; `#note` is for a sentence about the selection itself ("That is the most
 * drivers one binder holds").
 */
defineProps<{
  /** How many rows are ticked. Zero renders nothing. */
  count: number;
}>();
const emit = defineEmits<{ clear: [] }>();
</script>

<template>
  <div
    v-if="count > 0"
    role="region"
    aria-label="Bulk actions"
    class="flex flex-wrap items-center gap-x-3 gap-y-2 bg-brand-50 px-4 py-2.5 sm:px-6"
  >
    <span class="text-sm font-medium whitespace-nowrap text-brand-800" aria-live="polite">
      {{ count.toLocaleString() }} selected
    </span>
    <span v-if="$slots.note" class="text-sm text-brand-800">
      <slot name="note" />
    </span>
    <div class="ml-auto flex flex-wrap items-center gap-2">
      <slot />
      <BaseButton variant="ghost" size="sm" @click="emit('clear')">Clear</BaseButton>
    </div>
  </div>
</template>
