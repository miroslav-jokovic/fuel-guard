<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { PlaceSuggestion } from "@silvicom/shared";
import { AppCombobox as ComboSelect } from "@silvicom/ui";
import { usePlaceSuggestQuery } from "./useOpenings";

/**
 * The opening's yard or town, searched (Q-AD44 (a)): the shared server-filtered combobox over recruiting's
 * place search, emitting the picked place so the drawer can take its point. The debounce is this lookup's,
 * as in `ProductPicker.vue`: it is a property of the geocoder's cost, not of comboboxes.
 */
defineProps<{ id?: string }>();
const emit = defineEmits<{ select: [place: PlaceSuggestion] }>();

const query = ref("");
const debounced = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;
watch(query, (value) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => (debounced.value = value), 300);
});
onBeforeUnmount(() => timer && clearTimeout(timer));

const search = usePlaceSuggestQuery(debounced);
const places = computed(() => search.data.value ?? []);
const options = computed(() => places.value.map((p, i) => ({ value: String(i), label: p.label })));
const emptyText = computed(() =>
  search.isError.value ? "The search failed. Try again." : debounced.value.trim().length < 3 ? "Type at least three letters." : "No place found.",
);

function choose(index: string): void {
  const place = places.value[Number(index)];
  if (place) emit("select", place);
}
</script>

<template>
  <ComboSelect
    :id="id"
    model-value=""
    :options="options"
    :loading="search.isFetching.value"
    :empty-text="emptyText"
    placeholder="Search for a yard, town or address…"
    server-filtered
    data-test="place-search"
    @update:query="query = $event"
    @update:model-value="choose"
  />
</template>
