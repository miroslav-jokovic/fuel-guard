<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppSearchField, AppSwitch } from "@silvicom/ui";
import { UNIT_NOTE_KIND_LABELS, type UnitNoteSearchHit, type UnitNoteSubject } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { useToastStore } from "@/stores/toast";
import NoteComposer from "./NoteComposer.vue";
import NotesList from "./NotesList.vue";
import { useNotesDrawer, type NotesTarget } from "./useNotesDrawer";
import { useNotesAccess, usePinUnitNote, useUnitNotePeople, useUnitNotesFeed, type UnitNoteFeedParams } from "./useUnitNotes";

/**
 * The notes drawer (D-UN12, §4.4) — the shared `SlideOver` at `lg`, mounted ONCE per page and opened
 * by the URL (`useNotesDrawer`), so a table of fifty rows has one drawer and the bell and a pasted
 * link open it too. Top to bottom: write, search, pinned, the list.
 *
 * Search (D-UN7): the words, an author, a day range (calendar days, `DateRangeFilter` without presets
 * — the product's date filter, MM/DD/YYYY), and "All units" to widen from this unit to every unit of
 * the carrier, each hit then naming its unit. The filters are the drawer's own and start clean for
 * each unit: a search for "tire" on truck 1042 is not a question about truck 1043.
 *
 * Nothing renders for somebody without the `notes` surface (D-UN14), so a pasted link is not a door.
 */
const access = useNotesAccess();
const drawer = useNotesDrawer();
const toast = useToastStore();
const pin = usePinUnitNote();

const q = ref("");
const author = ref("");
const from = ref<string | undefined>(undefined);
const to = ref<string | undefined>(undefined);
const wide = ref(false);
const subjectsKey = computed(() => drawer.state.value?.subjects.map((s) => `${s.kind}:${s.id}`).join(",") ?? "");
watch(subjectsKey, () => {
  q.value = "";
  author.value = "";
  from.value = undefined;
  to.value = undefined;
  wide.value = false;
});

const open = computed(() => access.value && drawer.state.value !== null);
const params = computed<UnitNoteFeedParams | null>(() =>
  open.value
    ? {
        subjects: wide.value ? [] : drawer.state.value!.subjects,
        q: q.value || undefined,
        author: author.value || undefined,
        from: from.value,
        to: to.value,
      }
    : null,
);
const feed = useUnitNotesFeed(params);
const people = useUnitNotePeople(open);
const names = computed(() => new Map((people.data.value ?? []).map((p) => [p.id, p.name])));
const authorOptions = computed(() => [{ value: "", label: "Anyone" }, ...(people.data.value ?? []).map((p) => ({ value: p.id, label: p.name }))]);

/** What a unit is called: the opener's name for it, else the one its notes carry, else its kind. */
const nameFromNotes = (s: UnitNoteSubject) => feed.notes.value.find((n) => n.kind === s.kind && n.subjectId === s.id)?.subjectLabel ?? null;
const targets = computed<NotesTarget[]>(() =>
  (drawer.state.value?.subjects ?? []).map((s) => ({ ...s, label: drawer.labelOf(s, nameFromNotes(s)) ?? undefined })),
);
const unitName = (t: NotesTarget) => (!t.label ? UNIT_NOTE_KIND_LABELS[t.kind] : t.kind === "driver" ? t.label : `${UNIT_NOTE_KIND_LABELS[t.kind]} ${t.label}`);
const title = computed(() => `Notes · ${targets.value.map(unitName).join(" · ")}`);

const filtered = computed(() => !!(q.value || author.value || from.value || to.value));
const emptyText = computed(() =>
  filtered.value ? "No notes match this search." : wide.value ? "No notes on any unit yet." : "No notes yet. Write the first one above.",
);

async function togglePin(note: UnitNoteSearchHit): Promise<void> {
  try {
    await pin.mutateAsync({ id: note.id, pinned: !note.pinned });
  } catch (e) {
    toast.error(note.pinned ? "Could not unpin the note" : "Could not pin the note", e instanceof Error ? e.message : undefined);
  }
}
const openUnit = (n: UnitNoteSearchHit) => drawer.open([{ kind: n.kind, id: n.subjectId, label: n.subjectLabel }], n.id);
</script>

<template>
  <SlideOver :open="open" :title="title" size="lg" @close="drawer.close()">
    <div v-if="open" class="space-y-5" data-notes-drawer>
      <NoteComposer :targets="targets" />

      <div class="space-y-2 border-t border-edge pt-4" role="search" aria-label="Search the notes">
        <AppSearchField v-model="q" label="Search the notes" placeholder="Search the notes…" />
        <div class="flex flex-wrap items-center gap-2">
          <FilterSelect v-if="people.isSuccess.value" v-model="author" label="Author" :options="authorOptions" />
          <DateRangeFilter v-model:from="from" v-model:to="to" :presets="false" label="Written" />
          <label class="ml-auto inline-flex items-center gap-2 text-sm text-ink-secondary">
            <AppSwitch v-model="wide" label="Search every unit" />
            All units
          </label>
        </div>
      </div>

      <NotesList
        :notes="feed.notes.value"
        :loading="feed.list.isLoading.value"
        :error="feed.list.isError.value ? feed.list.error.value : null"
        :retrying="feed.list.isFetching.value"
        :fuzzy="feed.fuzzy.value"
        :has-more="feed.list.hasNextPage.value"
        :loading-more="feed.list.isFetchingNextPage.value"
        :show-unit="wide || targets.length > 1"
        :highlight-id="drawer.state.value?.noteId ?? null"
        :pin-busy="pin.isPending.value"
        :empty-text="emptyText"
        :name-of="(id: string) => names.get(id)"
        @more="feed.list.fetchNextPage()"
        @retry="feed.list.refetch()"
        @pin="togglePin"
        @open-unit="openUnit"
      />
    </div>
  </SlideOver>
</template>
