<script setup lang="ts">
import { computed, ref } from "vue";
import { AppIcon } from "@silvicom/ui";
import { CheckCircleIcon } from "@silvicom/ui/icons";
import { UNIT_NOTE_KIND_LABELS, UNIT_NOTE_MAX_SUBJECTS, formatDisplayDate, type DispatchBoardNoteMention, type DispatchBoardRow } from "@silvicom/shared";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { SURFACE_ICONS } from "@/lib/navIcons";
import { useNotesDrawer, type NotesTarget } from "@/components/notes/useNotesDrawer";
import { useResolveNoteMention } from "@/components/notes/useUnitNotes";
import { useToastStore } from "@/stores/toast";
import { boardNoteTargets } from "./boardNotes";

const notesIcon = SURFACE_ICONS.notes!;

/**
 * The row's open note mentions, in its Warnings cell (UNIT-NOTES-PLAN D-UN18, owner 2026-11-12: "when a
 * truck is mentioned in a note, for example @848, it will automatically display the mention in the
 * Warnings column"). One chip per note that names the truck, a seat or the trailer: "Note · Dana · 11/12".
 *
 * - **The chip** opens the row's notes drawer on that note — the row's units, plus the unit the note
 *   was WRITTEN on when that is another one ("Marcus swaps to @848" was written on Marcus), so the
 *   dispatcher always finds the note in the drawer that opens.
 * - **The Resolve icon** takes the chip off the board for everybody (owner, Q-UN6), signed and on the
 *   Audit page. The chip goes at once here and the board is asked again; the server reads the chips past
 *   its row cache, so the next answer agrees.
 *
 * Beside the due-date warnings, not one of them: a warning comes due; a note is somebody asking.
 * `@click.stop` on both: the row's own click opens the truck's drawer.
 */
const props = defineProps<{ row: DispatchBoardRow }>();
const drawer = useNotesDrawer();
const toast = useToastStore();
const resolve = useResolveNoteMention();
const gone = ref(new Set<string>());

const keyOf = (m: DispatchBoardNoteMention) => `${m.noteId}:${m.kind}:${m.subjectId}`;
const chips = computed(() => props.row.noteMentions.filter((m) => !gone.value.has(keyOf(m))));

function unitWords(m: DispatchBoardNoteMention): string {
  const named = boardNoteTargets(props.row).find((t) => t.kind === m.kind && t.id === m.subjectId);
  if (m.kind === "driver") return named?.label ?? "the driver";
  return `${UNIT_NOTE_KIND_LABELS[m.kind].toLowerCase()} ${named?.label ?? ""}`.trim();
}
const writtenOn = (m: DispatchBoardNoteMention) =>
  m.noteKind === "driver" ? (m.noteLabel ?? "a driver") : `${UNIT_NOTE_KIND_LABELS[m.noteKind].toLowerCase()} ${m.noteLabel ?? ""}`.trim();

function openNote(m: DispatchBoardNoteMention): void {
  const targets: NotesTarget[] = boardNoteTargets(props.row);
  if (!targets.some((t) => t.kind === m.noteKind && t.id === m.noteSubjectId)) {
    targets.push({ kind: m.noteKind, id: m.noteSubjectId, label: m.noteLabel ?? undefined });
  }
  drawer.open(targets.slice(0, UNIT_NOTE_MAX_SUBJECTS), m.noteId);
}

async function resolveChip(m: DispatchBoardNoteMention): Promise<void> {
  gone.value = new Set(gone.value).add(keyOf(m));
  try {
    await resolve.mutateAsync({ noteId: m.noteId, kind: m.kind, subjectId: m.subjectId });
  } catch (e) {
    const back = new Set(gone.value);
    back.delete(keyOf(m));
    gone.value = back;
    toast.error("Could not resolve the note", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div v-if="chips.length" class="flex flex-col items-start gap-0.5" data-board-note-chips>
    <span
      v-for="m in chips"
      :key="keyOf(m)"
      class="inline-flex items-center gap-0.5"
      :class="[BADGE_BASE, toneClass('brand')]"
      data-board-note-chip
    >
      <button
        type="button"
        class="inline-flex items-center gap-1 hover:underline"
        :title="`${m.authorName} mentioned ${unitWords(m)} in a note on ${writtenOn(m)}`"
        :aria-label="`Open ${m.authorName}'s note mentioning ${unitWords(m)}`"
        data-board-note-open
        @click.stop="openNote(m)"
      >
        <AppIcon :icon="notesIcon" class="size-3 shrink-0" aria-hidden="true" />
        Note · {{ m.authorName }} · {{ formatDisplayDate(m.at).slice(0, 5) }}
      </button>
      <!-- Not AppIconButton: its smallest is 32 px, which would make every board row with a chip taller.
           The chip's own height, with the title and the label saying what it does. -->
      <button
        type="button"
        class="-my-0.5 -mr-1 rounded p-0.5 text-brand-700 hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-brand-600"
        :title="'Resolve — take this note off the board'"
        :aria-label="`Resolve ${m.authorName}'s note on ${unitWords(m)}`"
        data-board-note-resolve
        @click.stop="resolveChip(m)"
      >
        <AppIcon :icon="CheckCircleIcon" class="size-3.5" aria-hidden="true" />
      </button>
    </span>
  </div>
</template>
