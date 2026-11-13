<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { AppButton as BaseButton, AppTextarea } from "@silvicom/ui";
import { UNIT_NOTE_MAX_LENGTH, unitNoteEditSchema, type UnitNoteSearchHit } from "@silvicom/shared";
import { useToastStore } from "@/stores/toast";
import MentionList from "@/components/mentions/MentionList.vue";
import { useEditUnitNote, useUnitNotePeople } from "./useUnitNotes";
import { useNoteTypeahead } from "./useNoteTypeahead";

/**
 * A note's words, changed in place (UNIT-NOTES-PLAN D-UN15): the author's own note, or anybody's for a
 * holder of `notes.manage_all` — `NoteRow` decides who sees the button, the API and 0596 decide who may.
 * The box is the composer's (`useNoteTypeahead`): `@` names people and units, and the saved names come
 * back as `@Ana Ruiz` / `@848`, each still standing for its token, so an edit to the rest of the sentence
 * keeps every mention. The contract's schema decides "ready", as the composer's does.
 *
 * ⌘/Ctrl+Enter saves; Esc cancels (while the `@` list is open, Esc closes the list first). The old words
 * are kept by the database (0596's `unit_note_versions`) and the row says "Edited" — no time limit
 * (owner, Q-UN9).
 */
const props = defineProps<{ note: UnitNoteSearchHit }>();
const emit = defineEmits<{ done: [] }>();
const toast = useToastStore();
const edit = useEditUnitNote();
const draft = ref("");
const field = ref<{ $el: HTMLTextAreaElement } | null>(null);
const typeahead = useNoteTypeahead(field, draft, `note-edit-${props.note.id}`);
const { outgoing, active, listId, options, listOpen, addLabel } = typeahead;

// The people list names the tokens; if it lands after the box opened untouched, read the words again.
const people = useUnitNotePeople(ref(true));
let touched = false;
onMounted(() => {
  typeahead.loadBody(props.note.body, props.note.units);
  field.value?.$el.focus();
});
watch(
  () => people.data.value,
  () => {
    if (!touched) typeahead.loadBody(props.note.body, props.note.units);
  },
);

const parsed = computed(() => unitNoteEditSchema.safeParse({ body: outgoing.value }));
const ready = computed(() => parsed.value.success && outgoing.value.trim() !== props.note.body.trim());

async function save(): Promise<void> {
  if (!parsed.value.success || edit.isPending.value) return;
  if (!ready.value) {
    emit("done");
    return;
  }
  try {
    await edit.mutateAsync({ id: props.note.id, body: parsed.value.data.body });
    emit("done");
  } catch (e) {
    toast.error("Could not save the note", e instanceof Error ? e.message : undefined);
  }
}
function onKey(e: KeyboardEvent): void {
  if (typeahead.onListKey(e)) return;
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    void save();
  } else if (e.key === "Escape") {
    // The editor's own Esc: the drawer around it must not close with it.
    e.preventDefault();
    e.stopPropagation();
    emit("done");
  }
}
function onInput(): void {
  touched = true;
  typeahead.readCaret();
}
</script>

<template>
  <form class="mt-1 space-y-2" data-note-editor @submit.prevent="save">
    <div class="relative">
      <AppTextarea
        ref="field"
        v-model="draft"
        :rows="3"
        :maxlength="UNIT_NOTE_MAX_LENGTH"
        aria-label="Edit the note"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="listOpen"
        :aria-controls="listOpen ? listId : undefined"
        :aria-activedescendant="listOpen ? `${listId}-${active}` : undefined"
        @keydown="onKey"
        @input="onInput"
        @click="typeahead.readCaret"
        @blur="typeahead.close"
      />
      <MentionList
        v-if="listOpen"
        :id="listId"
        below
        :options="options"
        :active="active"
        :add-label="addLabel"
        @pick="typeahead.pick"
        @point="active = $event"
      />
    </div>
    <div class="flex justify-end gap-2">
      <BaseButton type="button" size="sm" data-note-edit-cancel @click="emit('done')">Cancel</BaseButton>
      <BaseButton type="submit" variant="primary" size="sm" :disabled="!parsed.success || edit.isPending.value" data-note-edit-save>
        {{ edit.isPending.value ? "Saving…" : "Save" }}
      </BaseButton>
    </div>
  </form>
</template>
