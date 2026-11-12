<script setup lang="ts">
import { computed } from "vue";
import { AppButton } from "@silvicom/ui";
import type { UnitNoteSubjectSummary } from "@silvicom/shared";
import { noteAge, noteCount } from "@/components/notes/noteWords";
import { useNotesDrawer, type NotesTarget } from "@/components/notes/useNotesDrawer";
import { boardNoteUnitsWords } from "./boardNotes";

/**
 * The Dispatch Board's Notes cell (UNIT-NOTES-PLAN D-UN12): the count of every note on the row's units
 * and the age of the newest, or a quiet "Add". A click opens ONE drawer holding them all — the truck,
 * both seats, the trailer — through the URL (`?notes=vehicle:…,driver:…,trailer:…`), where the
 * drawer names each unit with a chip and its composer asks which unit a new note is about.
 *
 * It is `components/notes/NotesCell.vue`'s look and words for a row of several units: that cell opens
 * one unit, and the board's is the only table whose row is more than one.
 *
 * `@click.stop`: the row's own click opens the truck's drawer (`DispatchBoardTable`), and a click on
 * the notes must not open both.
 */
const props = defineProps<{ targets: NotesTarget[]; summary?: UnitNoteSubjectSummary }>();
const drawer = useNotesDrawer();
const units = computed(() => boardNoteUnitsWords(props.targets));
</script>

<template>
  <!-- AppButton's link (the board's own unit link is one): the quiet "Add" is a tertiary span inside it,
       whose own colour wins over the link's inherited one without an override class. -->
  <AppButton
    variant="link"
    class="min-h-8 whitespace-nowrap text-sm"
    :class="summary ? 'font-medium' : ''"
    :aria-label="summary ? `${noteCount(summary.count)} on ${units}` : `Add a note on ${units}`"
    data-board-notes-cell
    @click.stop="drawer.open(targets)"
  >
    <template v-if="summary">
      <!-- One line, so the space between the two stays a space: "3 2 d ago", never "32 d ago". -->
      <span class="tabular-nums">{{ summary.count }}</span> <span class="text-xs font-normal text-ink-tertiary">{{ noteAge(summary.lastAt) }}</span>
    </template>
    <span v-else class="font-normal text-ink-tertiary">Add</span>
  </AppButton>
</template>
