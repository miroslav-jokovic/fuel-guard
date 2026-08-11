<script setup lang="ts">
import { computed, ref } from "vue";
import type { EfsLocation } from "@fuelguard/shared";
import { AppButton as BaseButton } from "@fuelguard/ui";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { AppSearchField as SearchInput } from "@fuelguard/ui";
import { useEfsLocationSearch } from "./useEfsCards";

/**
 * Find the truck stop an operator means, and hand back the 6-digit id EFS wants.
 *
 * Nobody knows a location id. They know "the Love's on I-57 at Effingham", and the override recipe
 * (p194) needs `442013`. This is the whole reason `searchLocation` was worth fighting the vendor's
 * request shape for.
 *
 * Collapses to a one-line summary once something is chosen: a live search table left open under a
 * confirmation invites a second, absent-minded selection.
 */

const props = defineProps<{ modelValue: EfsLocation | null; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: EfsLocation | null] }>();

const term = ref("");
// The composable holds the query back below two characters — an unbounded search against a
// rate-paced vendor is not something to discover in production.
const query = computed(() => ({ name: term.value }));
const search = useEfsLocationSearch(query);

const columns: DataTableColumn[] = [
  { key: "name", label: "Location" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "locId", label: "EFS id" },
];

const rows = computed(() => search.data.value?.locations ?? []);

function select(location: EfsLocation): void {
  emit("update:modelValue", location);
  term.value = "";
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="props.modelValue" class="flex items-center justify-between gap-3 rounded-control bg-surface-subtle px-3 py-2">
      <span class="text-sm text-ink">
        {{ props.modelValue.name ?? "Location" }}<template v-if="props.modelValue.city">, {{ props.modelValue.city }}</template>
        <template v-if="props.modelValue.state"> {{ props.modelValue.state }}</template>
        <span class="ml-2 text-ink-muted">#{{ props.modelValue.locId }}</span>
      </span>
      <BaseButton size="sm" variant="ghost" :disabled="props.disabled" @click="emit('update:modelValue', null)">
        Change
      </BaseButton>
    </div>

    <template v-else>
      <SearchInput v-model="term" placeholder="Search by name — for example, Loves" />
      <p v-if="term.length > 0 && term.length < 2" class="text-sm text-ink-muted">
        Type at least two characters.
      </p>
      <DataTable
        v-else-if="term.length >= 2"
        :columns="columns"
        :rows="rows"
        row-key="locId"
        dense
        :loading="search.isLoading.value"
        :error="search.isError.value ? (search.error.value?.message ?? 'Could not search locations') : null"
        empty-text="No locations match that search."
        @retry="search.refetch()"
      >
        <template #actions="{ row }">
          <BaseButton size="sm" variant="soft" :disabled="props.disabled" @click="select(row as EfsLocation)">
            Select
          </BaseButton>
        </template>
      </DataTable>
    </template>
  </div>
</template>
