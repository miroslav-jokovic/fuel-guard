<script setup lang="ts">
import { computed } from "vue";
import type { UnitNoteKind, UnitNoteSubjectSummary } from "@silvicom/shared";
import { noteAge, noteCount } from "./noteWords";
import { useNotesDrawer } from "./useNotesDrawer";

/**
 * The Notes column's cell (D-UN12): the count and the age of the newest note, or a quiet "Add" when the
 * unit has none. Either opens the unit's drawer through the URL (`useNotesDrawer`), so the page holds
 * one drawer and the row holds a link-shaped button, never a dialog of its own.
 *
 * The summary is handed in by the page (`useUnitNoteSummary`, one query per table) rather than read
 * here — see that function for why a cell must not observe it.
 */
const props = defineProps<{ kind: UnitNoteKind; id: string; label: string; summary?: UnitNoteSubjectSummary }>();
const drawer = useNotesDrawer();
const has = computed(() => (props.summary?.count ?? 0) > 0);
</script>

<template>
  <button
    type="button"
    class="inline-block min-h-8 whitespace-nowrap rounded text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    :class="has ? 'font-medium text-link hover:text-link-hover' : 'text-ink-tertiary hover:text-ink-secondary'"
    :aria-label="has ? `${noteCount(summary!.count)} on ${label}` : `Add a note on ${label}`"
    data-notes-cell
    @click="drawer.open([{ kind, id, label }])"
  >
    <template v-if="has">
      <!-- One line, so the space between the two stays a space: "3 2 d ago", never "32 d ago". -->
      <span class="tabular-nums">{{ summary!.count }}</span> <span class="text-xs font-normal text-ink-tertiary">{{ noteAge(summary!.lastAt) }}</span>
    </template>
    <template v-else>Add</template>
  </button>
</template>
