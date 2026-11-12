<script setup lang="ts">
import { computed, nextTick, watch } from "vue";
import { AppButton as BaseButton, QueryState } from "@silvicom/ui";
import { orderUnitNotes, type UnitNoteSearchHit } from "@silvicom/shared";
import NoteRow from "./NoteRow.vue";

/**
 * The notes, as the drawer and the Notes page both show them (§4.4): the pinned note(s) above, then
 * newest first, "Show older notes" for the next page, and the search's "No exact match. Close
 * matches:" when the word pass found nothing (D-UN7).
 *
 * The order is the contract's `orderUnitNotes` — the same one an optimistic list and the API agree on
 * — so this file decides nothing about order. `pinnedFirst` is off on the wall, where "pinned" is a
 * fact about one unit and lifting every unit's pin above the newest would bury what just happened.
 */
const props = withDefaults(
  defineProps<{
    notes: UnitNoteSearchHit[];
    loading: boolean;
    error: unknown;
    retrying?: boolean;
    fuzzy?: boolean;
    hasMore?: boolean;
    loadingMore?: boolean;
    showUnit?: boolean;
    pinnedFirst?: boolean;
    highlightId?: string | null;
    pinBusy?: boolean;
    emptyText: string;
    nameOf?: (userId: string) => string | null | undefined;
  }>(),
  { retrying: false, fuzzy: false, hasMore: false, loadingMore: false, showUnit: false, pinnedFirst: true, highlightId: null, pinBusy: false, nameOf: undefined },
);
const emit = defineEmits<{ more: []; retry: []; pin: [note: UnitNoteSearchHit]; "open-unit": [note: UnitNoteSearchHit] }>();

const ordered = computed(() => (props.pinnedFirst ? orderUnitNotes(props.notes) : props.notes));
const pinned = computed(() => (props.pinnedFirst ? ordered.value.filter((n) => n.pinned) : []));
const rest = computed(() => (props.pinnedFirst ? ordered.value.filter((n) => !n.pinned) : ordered.value));

/** A mention's bell entry and a pasted `&note=` name a note: bring it into view once it is on the list. */
watch(
  () => [props.highlightId, props.notes.some((n) => n.id === props.highlightId)] as const,
  async ([id, present]) => {
    if (!id || !present) return;
    await nextTick();
    document.getElementById(`note-${id}`)?.scrollIntoView?.({ block: "center" });
  },
  { immediate: true },
);
</script>

<template>
  <QueryState
    :loading="loading"
    :error="error"
    :retrying="retrying"
    loading-text="Loading the notes…"
    error-text="Could not load the notes."
    compact
    @retry="emit('retry')"
  >
    <p v-if="notes.length === 0" class="text-sm text-ink-muted" data-notes-empty>{{ emptyText }}</p>
    <template v-else>
      <p v-if="fuzzy" class="mb-2 text-sm text-ink-muted" data-notes-fuzzy>No exact match. Close matches:</p>
      <section v-if="pinned.length" aria-label="Pinned" class="mb-3">
        <ul class="space-y-2">
          <NoteRow
            v-for="n in pinned"
            :key="n.id"
            :note="n"
            :show-unit="showUnit"
            :highlighted="n.id === highlightId"
            :pin-busy="pinBusy"
            :name-of="nameOf"
            @pin="emit('pin', $event)"
            @open-unit="emit('open-unit', $event)"
          />
        </ul>
      </section>
      <ul class="space-y-2" aria-label="Notes">
        <NoteRow
          v-for="n in rest"
          :key="n.id"
          :note="n"
          :show-unit="showUnit"
          :highlighted="n.id === highlightId"
          :pin-busy="pinBusy"
          :name-of="nameOf"
          @pin="emit('pin', $event)"
          @open-unit="emit('open-unit', $event)"
        />
      </ul>
      <div v-if="hasMore" class="mt-3">
        <BaseButton size="sm" :disabled="loadingMore" data-notes-more @click="emit('more')">
          {{ loadingMore ? "Loading…" : "Show older notes" }}
        </BaseButton>
      </div>
    </template>
  </QueryState>
</template>
