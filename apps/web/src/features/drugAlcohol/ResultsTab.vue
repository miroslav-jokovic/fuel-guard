<script setup lang="ts">
import { computed, ref } from "vue";
import type { MedstopResultRow } from "@silvicom/shared";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import ResultsTable from "@/features/drugAlcohol/ResultsTable.vue";

/**
 * Results (MEDSTOP-PLAN.md §7A.3) — testing records, so mounted only for a reader the API sent them
 * to. One list; "Found on the first read" (D-MS5's history) is a choice of WHICH list, not a second
 * table under the first — the owner's review found two stacked tables confusing.
 */
const props = defineProps<{ recent: MedstopResultRow[]; history: MedstopResultRow[] }>();
const show = ref("recent");
const options = computed(() => [
  { value: "recent", label: `Needs review (${props.recent.length})` },
  { value: "history", label: `Found on the first read (${props.history.length})` },
]);
const isHistory = computed(() => show.value === "history");
</script>

<template>
  <div class="space-y-3">
    <FilterSelect v-if="history.length > 0" v-model="show" label="Show" :options="options" />
    <ResultsTable
      v-if="!isHistory"
      title="Results to review"
      why="Positive, refused, dilute or unrecognised results from Med-Stop in the last year. A positive or refusal keeps the driver off dispatch until a return-to-duty record dated on or after the test is on file."
      :rows="recent"
      empty-text="No results need review."
    />
    <ResultsTable
      v-else
      title="Found on the first read from Med-Stop"
      why="Positives and refusals from before Silvicom 360 was watching. Nothing was done with them automatically: check each person is either gone or has a return-to-duty record on file."
      :rows="history"
      empty-text="None."
    />
  </div>
</template>
