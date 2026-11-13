<script setup lang="ts">
import { computed } from "vue";
import { AppIcon, AppIconButton } from "@silvicom/ui";
import { PinIcon, UnpinIcon } from "@silvicom/ui/icons";
import { chatBodyParts, formatDisplayDateTime, UNIT_NOTE_KIND_LABELS, type UnitNoteSearchHit } from "@silvicom/shared";
import MentionChip from "@/components/mentions/MentionChip.vue";
import { useSessionStore } from "@/stores/session";

/**
 * One note: who, when (MM/DD/YYYY h:mm), the words, and the pin (D-UN6). Permanent and signed (D-UN3),
 * so the row has nothing to edit and nothing to remove — a wrong note is answered by a new one.
 *
 * `showUnit` names the unit on the row — the drawer's "All units" search, a drawer holding several
 * units, and the Notes page (D-UN13); the name opens that unit's own drawer.
 *
 * A `<@id>` token is drawn as a name chip (UN7, D-UN8): chat's one parser (`chatBodyParts`) cuts the
 * body, and chat's own `MentionChip` draws each token, the reader's own name as the stronger chip — the
 * line a person opening the drawer from the bell is looking for. Names are the drawer's
 * `/api/notes/people` list (`nameOf`); somebody no longer in the office reads "@someone".
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
const parts = computed(() => chatBodyParts(props.note.body));
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
        <span class="text-ink-secondary">{{ note.authorName }}</span> · {{ formatDisplayDateTime(note.createdAt) }}
      </p>
      <!-- The sidebar's pin and chat's (SidebarNavItem, ChatMessageRow): the same two glyphs for the same act. -->
      <AppIconButton
        class="shrink-0"
        size="sm"
        variant="ghost"
        :icon="note.pinned ? UnpinIcon : PinIcon"
        :label="note.pinned ? 'Unpin' : 'Pin to top'"
        :pressed="note.pinned"
        :disabled="pinBusy"
        data-note-pin
        @click="emit('pin', note)"
      />
    </div>
    <p class="mt-1 whitespace-pre-line break-words text-sm text-ink-secondary" data-note-body>
      <template v-for="(p, i) in parts" :key="i">
        <template v-if="'text' in p">{{ p.text }}</template>
        <MentionChip v-else :user-id="p.mention" :viewer-id="session.userId ?? ''" :name-of="nameOf ?? (() => null)" data-note-mention />
      </template>
    </p>
  </li>
</template>
