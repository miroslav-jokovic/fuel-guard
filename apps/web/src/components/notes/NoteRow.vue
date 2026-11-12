<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { chatBodyText, formatDisplayDateTime, UNIT_NOTE_KIND_LABELS, type UnitNoteSearchHit } from "@silvicom/shared";

/**
 * One note: who, when (MM/DD/YYYY h:mm), the words, and the pin (D-UN6). Permanent and signed (D-UN3),
 * so the row has nothing to edit and nothing to remove — a wrong note is answered by a new one.
 *
 * `showUnit` names the unit on the row — the drawer's "All units" search, a drawer holding several
 * units, and the Notes page (D-UN13); the name opens that unit's own drawer.
 *
 * A `<@id>` token reads as "@name" through chat's one parser (`chatBodyText`, D-UN8). The name CHIP
 * is UN7's (track E), and lands here when E takes this file over.
 */
const props = defineProps<{
  note: UnitNoteSearchHit;
  showUnit?: boolean;
  highlighted?: boolean;
  pinBusy?: boolean;
  nameOf?: (userId: string) => string | null | undefined;
}>();
const emit = defineEmits<{ pin: [note: UnitNoteSearchHit]; "open-unit": [note: UnitNoteSearchHit] }>();
const body = computed(() => chatBodyText(props.note.body, props.nameOf ?? (() => null)));
</script>

<template>
  <li
    :id="`note-${note.id}`"
    class="rounded-surface p-3 transition-colors"
    :class="highlighted ? 'bg-brand-50' : 'bg-surface-muted'"
    :aria-current="highlighted ? 'true' : undefined"
    data-note
  >
    <div class="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
      <p class="min-w-0 text-xs text-ink-muted">
        <span v-if="note.pinned" class="font-medium text-ink">Pinned · </span>
        <button
          v-if="showUnit"
          type="button"
          class="font-medium text-link hover:text-link-hover"
          data-note-unit
          @click="emit('open-unit', note)"
        >{{ UNIT_NOTE_KIND_LABELS[note.kind] }} {{ note.subjectLabel }}</button><span v-if="showUnit"> · </span>
        <span class="text-ink-secondary">{{ note.authorName }}</span> · {{ formatDisplayDateTime(note.createdAt) }}
      </p>
      <BaseButton size="sm" variant="ghost" :disabled="pinBusy" data-note-pin @click="emit('pin', note)">
        {{ note.pinned ? "Unpin" : "Pin to top" }}
      </BaseButton>
    </div>
    <p class="mt-1 whitespace-pre-line break-words text-sm text-ink-secondary">{{ body }}</p>
  </li>
</template>
