<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppButton as BaseButton, AppSelect, AppTextarea } from "@silvicom/ui";
import {
  UNIT_NOTE_AUDIENCE_LINE,
  UNIT_NOTE_KIND_LABELS,
  UNIT_NOTE_MAX_LENGTH,
  unitNoteCreateSchema,
  type UnitNote,
} from "@silvicom/shared";
import { useToastStore } from "@/stores/toast";
import { useAddUnitNote } from "./useUnitNotes";
import type { NotesTarget } from "./useNotesDrawer";

/**
 * Write a note (D-UN3): text only, 1 to 4,000 characters after trimming — the contract's
 * `unitNoteCreateSchema` decides "ready", the same schema the API parses with, so the button and the
 * server cannot disagree about what is a note. Everybody who can open the drawer can write (D-UN4).
 *
 * The line under the box is the owner's own words (Q-UN3, `UNIT_NOTE_AUDIENCE_LINE`). With several
 * units in one drawer (the Dispatch Board's, D-UN12) the writer picks which unit the note is about;
 * a note is always about exactly one (D-UN1).
 *
 * ⌘/Ctrl+Enter sends, as chat's composer does; Enter alone is a new line, because notes are
 * sentences and a stray Enter must not file half of one permanently.
 */
const props = defineProps<{ targets: NotesTarget[] }>();
const emit = defineEmits<{ added: [note: UnitNote] }>();
const toast = useToastStore();
const add = useAddUnitNote();

const draft = ref("");
const keyOf = (t: NotesTarget) => `${t.kind}:${t.id}`;
const about = ref<string>("");
watch(
  () => props.targets.map(keyOf).join(","),
  () => {
    if (!props.targets.some((t) => keyOf(t) === about.value)) about.value = props.targets[0] ? keyOf(props.targets[0]) : "";
  },
  { immediate: true },
);
const target = computed(() => props.targets.find((t) => keyOf(t) === about.value) ?? null);
const unitOptions = computed(() =>
  props.targets.map((t) => ({ value: keyOf(t), label: `${UNIT_NOTE_KIND_LABELS[t.kind]} ${t.label ?? ""}`.trim() })),
);

const parsed = computed(() =>
  target.value ? unitNoteCreateSchema.safeParse({ kind: target.value.kind, subjectId: target.value.id, body: draft.value }) : null,
);
const ready = computed(() => parsed.value?.success === true);
const length = computed(() => draft.value.trim().length);
const nearLimit = computed(() => length.value > UNIT_NOTE_MAX_LENGTH - 200);

async function submit(): Promise<void> {
  if (!parsed.value?.success || add.isPending.value) return;
  try {
    const note = await add.mutateAsync(parsed.value.data);
    draft.value = "";
    emit("added", note);
  } catch (e) {
    toast.error("Could not add the note", e instanceof Error ? e.message : undefined);
  }
}
function onKey(e: KeyboardEvent): void {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    void submit();
  }
}
</script>

<template>
  <form class="space-y-2" data-note-composer @submit.prevent="submit">
    <AppSelect
      v-if="targets.length > 1"
      :model-value="about"
      :options="unitOptions"
      @update:model-value="about = String($event ?? '')"
      :placeholder="''"
      aria-label="The note is about"
    />
    <AppTextarea
      v-model="draft"
      :rows="3"
      :maxlength="UNIT_NOTE_MAX_LENGTH"
      aria-label="Write a note"
      placeholder="Write a note for the office"
      @keydown="onKey"
    />
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs text-ink-muted">
        {{ UNIT_NOTE_AUDIENCE_LINE }}
        <span v-if="nearLimit" class="ml-1 tabular-nums" data-note-length>{{ length }}/{{ UNIT_NOTE_MAX_LENGTH }}</span>
      </p>
      <BaseButton type="submit" variant="primary" size="sm" :disabled="!ready || add.isPending.value">
        {{ add.isPending.value ? "Adding…" : "Add note" }}
      </BaseButton>
    </div>
  </form>
</template>
