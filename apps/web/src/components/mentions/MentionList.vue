<script setup lang="ts">
import { AppAvatar } from "@silvicom/ui";
import type { MentionCandidate } from "./mentionNames";

/**
 * The `@` list's popup (`useMentionTypeahead`), drawn above its field. The field keeps the focus and
 * owns the keys (it is the combobox; this is its listbox), so the list only shows and takes a pointer.
 * Promoted out of `ChatComposer.vue` at UN4 (UNIT-NOTES-PLAN M10).
 */
defineProps<{ id: string; options: readonly MentionCandidate[]; active: number; addLabel: string | null }>();
const emit = defineEmits<{ pick: [candidate: MentionCandidate]; /** The pointer moved onto an option; the field keeps the keyboard, so this is not a focus. */
  point: [index: number] }>();
</script>

<template>
  <ul
    :id="id"
    role="listbox"
    aria-label="People to mention"
    class="absolute bottom-full left-0 mb-1 w-72 max-w-full overflow-hidden rounded-surface bg-surface py-1 shadow-overlay ring-1 ring-edge-subtle"
  >
    <!-- mousedown, not click: a click lands after the field's blur has closed the list. -->
    <li
      v-for="(c, i) in options"
      :id="`${id}-${i}`"
      :key="c.user_id"
      role="option"
      :aria-selected="i === active"
      class="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm"
      :class="i === active ? 'bg-surface-subtle text-ink' : 'text-ink-secondary'"
      @mousedown.prevent="emit('pick', c)"
      @mousemove="emit('point', i)"
    >
      <AppAvatar :label="c.name" :identity="c.user_id" size="xs" />
      <span class="min-w-0 flex-1 truncate">{{ c.name }}</span>
      <span v-if="!c.member && addLabel" class="shrink-0 text-2xs text-ink-tertiary">{{ addLabel }}</span>
    </li>
  </ul>
</template>
