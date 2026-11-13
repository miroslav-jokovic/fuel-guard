<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppIcon, AppIconButton, useConfirmStore } from "@silvicom/ui";
import { PinIcon, UnpinIcon } from "@silvicom/ui/icons";
import {
  NOTES_MANAGE_ALL_PERMISSION,
  UNIT_NOTE_KIND_LABELS,
  formatDisplayDateTime,
  unitNoteBodyParts,
  unitNoteUnitText,
  type UnitNoteSearchHit,
} from "@silvicom/shared";
import KebabMenu from "@/components/KebabMenu.vue";
import MentionChip from "@/components/mentions/MentionChip.vue";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import NoteEditor from "./NoteEditor.vue";
import { useRemoveUnitNote } from "./useUnitNotes";

/**
 * One note: who, when (MM/DD/YYYY h:mm), the words, and the pin (D-UN6).
 *
 * Since v3 (UNIT-NOTES-PLAN §9, owner 2026-11-12) the row carries a menu with Edit and Remove for the
 * note's author, and for anybody holding "Edit and remove anyone's note" (`notes.manage_all`, D-UN19) —
 * asked of the session's named permissions, the same resolver the API's gate reads, so the menu is never
 * an offer the API refuses. Edit opens the words in place (`NoteEditor`, D-UN15); Remove asks first and
 * hides the note everywhere (D-UN16). An edited note says "Edited", with the time on hover.
 *
 * `showUnit` names the unit on the row — the drawer's "All units" search, a drawer holding several
 * units, and the Notes page (D-UN13); the name opens that unit's own drawer.
 *
 * A `<@id>` token is drawn as a name chip (UN7, D-UN8): chat's `MentionChip`, the reader's own name as
 * the stronger chip. A `<#kind:id>` token (D-UN17) is drawn as `@848` — the truck, trailer or driver the
 * note names, which also puts a chip on that unit's Dispatch Board row until it is resolved.
 */
const props = defineProps<{
  note: UnitNoteSearchHit;
  showUnit?: boolean;
  highlighted?: boolean;
  pinBusy?: boolean;
  nameOf?: (userId: string) => string | null | undefined;
}>();
const emit = defineEmits<{ pin: [note: UnitNoteSearchHit]; "open-unit": [note: UnitNoteSearchHit] }>();
const session = useSessionStore();
const toast = useToastStore();
const remove = useRemoveUnitNote();
const editing = ref(false);

const parts = computed(() => unitNoteBodyParts(props.note.body));
const unitLabel = (kind: string, id: string) => props.note.units.find((u) => u.kind === kind && u.id === id)?.label ?? null;
const mine = computed(() => !!props.note.authorId && props.note.authorId.toLowerCase() === (session.userId ?? "").toLowerCase());
const canChange = computed(() => mine.value || session.hasPermission(NOTES_MANAGE_ALL_PERMISSION));

async function removeNote(): Promise<void> {
  // Asked when Remove is pressed, not at setup: a row is drawn many times and asks the question rarely.
  const yes = await useConfirmStore().ask({
    title: "Remove this note?",
    message: mine.value
      ? "It leaves the drawer, the Notes page and the Dispatch Board for everyone. The Audit page keeps a record that it was removed."
      : `This is ${props.note.authorName}'s note. It leaves the drawer, the Notes page and the Dispatch Board for everyone. The Audit page keeps a record that you removed it.`,
    confirmLabel: "Remove",
    tone: "danger",
  });
  if (!yes) return;
  try {
    await remove.mutateAsync(props.note.id);
  } catch (e) {
    toast.error("Could not remove the note", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <li
    :id="`note-${note.id}`"
    class="rounded-surface p-3 transition-colors"
    :class="highlighted ? 'bg-brand-50' : 'bg-surface-muted'"
    :aria-current="highlighted ? 'true' : undefined"
    data-note
  >
    <div class="flex items-start justify-between gap-2">
      <p class="min-w-0 flex-1 pt-1 text-xs text-ink-muted">
        <span v-if="note.pinned" class="inline-flex items-center gap-0.5 font-medium text-ink" data-note-pinned><AppIcon :icon="PinIcon" class="size-3" aria-hidden="true" />Pinned</span><span v-if="note.pinned"> · </span>
        <button
          v-if="showUnit"
          type="button"
          class="font-medium text-link hover:text-link-hover"
          data-note-unit
          @click="emit('open-unit', note)"
        >{{ UNIT_NOTE_KIND_LABELS[note.kind] }} {{ note.subjectLabel }}</button><span v-if="showUnit"> · </span>
        <span class="text-ink-secondary">{{ note.authorName }}</span> · {{ formatDisplayDateTime(note.createdAt) }}<template v-if="note.editedAt"> · <span :title="`Edited ${formatDisplayDateTime(note.editedAt)}`" data-note-edited>Edited</span></template>
      </p>
      <div class="flex shrink-0 items-center gap-0.5">
        <!-- The sidebar's pin and chat's (SidebarNavItem, ChatMessageRow): the same two glyphs for the same act. -->
        <AppIconButton
          size="sm"
          variant="ghost"
          :icon="note.pinned ? UnpinIcon : PinIcon"
          :label="note.pinned ? 'Unpin' : 'Pin to top'"
          :pressed="note.pinned"
          :disabled="pinBusy"
          data-note-pin
          @click="emit('pin', note)"
        />
        <KebabMenu v-if="canChange && !editing" data-note-actions>
          <BaseButton class="kebab-item" data-note-edit @click="editing = true">Edit</BaseButton>
          <BaseButton class="kebab-item kebab-item-danger" :disabled="remove.isPending.value" data-note-remove @click="removeNote">Remove…</BaseButton>
        </KebabMenu>
      </div>
    </div>
    <NoteEditor v-if="editing" :note="note" @done="editing = false" />
    <p v-else class="mt-1 whitespace-pre-line break-words text-sm text-ink-secondary" data-note-body>
      <template v-for="(p, i) in parts" :key="i">
        <template v-if="'text' in p">{{ p.text }}</template>
        <MentionChip v-else-if="'mention' in p" :user-id="p.mention" :viewer-id="session.userId ?? ''" :name-of="nameOf ?? (() => null)" data-note-mention />
        <span
          v-else
          class="rounded bg-surface-subtle px-0.5 font-medium text-ink"
          :title="UNIT_NOTE_KIND_LABELS[p.unit.kind]"
          data-note-unit-mention
        >{{ unitNoteUnitText(p.unit, unitLabel(p.unit.kind, p.unit.id)) }}</span>
      </template>
    </p>
  </li>
</template>
