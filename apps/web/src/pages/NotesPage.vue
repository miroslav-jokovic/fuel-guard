<script setup lang="ts">
import { computed } from "vue";
import { DataWorkspace, FilterBar, useQueryState } from "@silvicom/ui";
import { isUnitNoteKind, UNIT_NOTE_KINDS, UNIT_NOTE_KIND_LABELS, type UnitNoteSearchHit } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import NotesList from "@/components/notes/NotesList.vue";
import NotesDrawer from "@/components/notes/NotesDrawer.vue";
import { useNotesDrawer } from "@/components/notes/useNotesDrawer";
import { usePinUnitNote, useUnitNotePeople, useUnitNotesFeed, type UnitNoteFeedParams } from "@/components/notes/useUnitNotes";
import { useToastStore } from "@/stores/toast";

/**
 * The Notes page — the wall (UNIT-NOTES-PLAN D-UN13): every note the carrier's office has written on a
 * truck, a trailer or a driver, newest first, each naming its unit. It exists because notes are
 * office-wide (D-UN4) while the fleet tables are not: billing holds none of the four tables (M5), and
 * this is where billing and safety read what dispatch wrote.
 *
 * The same search as the drawer (D-UN7) with no unit chosen — the same `GET /api/notes` without
 * `subjects` — and the same 10 s refresh (D-UN10). Filters live in the URL (D-US2), so a link to
 * "Ana's notes on trailers this week" is a link. A row's unit opens that unit's drawer in place; there
 * is no composer here, because a note is always about one unit (D-UN1) and the drawer is where one is
 * chosen.
 *
 * Reached only through the `notes` surface (the route guard and the sidebar ask the catalogue line);
 * dark until UN9 (D-UN14).
 */
const qs = useQueryState();
const q = qs.param("q");
const kind = qs.param("kind", UNIT_NOTE_KINDS);
const author = qs.param("author");
const from = computed({ get: () => qs.one("from"), set: (v) => qs.set({ from: v }) });
const to = computed({ get: () => qs.one("to"), set: (v) => qs.set({ to: v }) });

const params = computed<UnitNoteFeedParams>(() => ({
  subjects: [],
  q: q.value || undefined,
  kind: isUnitNoteKind(kind.value) ? kind.value : undefined,
  author: author.value || undefined,
  from: from.value,
  to: to.value,
}));
const feed = useUnitNotesFeed(params);
const people = useUnitNotePeople(computed(() => true));
const names = computed(() => new Map((people.data.value ?? []).map((p) => [p.id, p.name])));

const kindOptions = [{ value: "", label: "All units" }, ...UNIT_NOTE_KINDS.map((k) => ({ value: k, label: `${UNIT_NOTE_KIND_LABELS[k]}s` }))];
const authorOptions = computed(() => [{ value: "", label: "Anyone" }, ...(people.data.value ?? []).map((p) => ({ value: p.id, label: p.name }))]);
const activeCount = computed(() => [q.value, kind.value, author.value, from.value || to.value].filter(Boolean).length);
const clear = () => qs.set({ q: undefined, kind: undefined, author: undefined, from: undefined, to: undefined });

const drawer = useNotesDrawer();
const openUnit = (n: UnitNoteSearchHit) => drawer.open([{ kind: n.kind, id: n.subjectId, label: n.subjectLabel }], n.id);
const toast = useToastStore();
const pin = usePinUnitNote();
async function togglePin(n: UnitNoteSearchHit): Promise<void> {
  try {
    await pin.mutateAsync({ id: n.id, pinned: !n.pinned });
  } catch (e) {
    toast.error(n.pinned ? "Could not unpin the note" : "Could not pin the note", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every note the office has written on a truck, trailer or driver, newest first." />

    <DataWorkspace>
      <FilterBar
        v-model:search="q"
        embedded
        search-placeholder="Search the notes…"
        :active-count="activeCount"
        @clear-all="clear"
      >
        <template #filters>
          <FilterSelect v-model="kind" label="Unit" :options="kindOptions" />
          <FilterSelect v-if="people.isSuccess.value" v-model="author" label="Author" :options="authorOptions" />
          <DateRangeFilter v-model:from="from" v-model:to="to" :presets="false" label="Written" />
        </template>
      </FilterBar>

      <div class="border-t border-edge p-4" data-notes-wall>
        <NotesList
          :notes="feed.notes.value"
          :loading="feed.list.isLoading.value"
          :error="feed.list.isError.value ? feed.list.error.value : null"
          :retrying="feed.list.isFetching.value"
          :fuzzy="feed.fuzzy.value"
          :has-more="feed.list.hasNextPage.value"
          :loading-more="feed.list.isFetchingNextPage.value"
          show-unit
          :pinned-first="false"
          :pin-busy="pin.isPending.value"
          :empty-text="activeCount ? 'No notes match these filters.' : 'No notes yet. A note written on a truck, trailer or driver appears here.'"
          :name-of="(id: string) => names.get(id)"
          @more="feed.list.fetchNextPage()"
          @retry="feed.list.refetch()"
          @pin="togglePin"
          @open-unit="openUnit"
        />
      </div>
    </DataWorkspace>

    <NotesDrawer />
  </div>
</template>
