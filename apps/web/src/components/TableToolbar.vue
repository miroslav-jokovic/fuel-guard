<script setup lang="ts">
import SearchInput from "@/components/SearchInput.vue";

// Standard filter/search toolbar for table pages (matches the Alerts/Transactions pattern). Renders a card
// with a title + row count + active-filter count + a "Clear filters" button, a search box, and a slot for
// page-specific filter controls (selects, vehicle picker, date range).
withDefaults(
  defineProps<{
    modelValue: string;
    title: string;
    count?: number | null;
    subtitle?: string | null;
    searchPlaceholder?: string;
    activeFilterCount?: number;
  }>(),
  { count: null, subtitle: null, searchPlaceholder: "Search…", activeFilterCount: 0 },
);
defineEmits<{ "update:modelValue": [value: string]; clear: [] }>();
</script>

<template>
  <div class="rounded-lg bg-surface p-4 shadow-sm ring-1 ring-edge">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 class="text-sm font-semibold text-ink">
        {{ title }}
        <span v-if="count != null" class="ml-1 font-normal text-ink-subtle">· {{ count.toLocaleString() }}</span>
        <span v-if="subtitle" class="ml-1 font-normal text-ink-subtle">· {{ subtitle }}</span>
        <span v-if="activeFilterCount" class="ml-1 font-normal text-brand-600">· {{ activeFilterCount }} filter{{ activeFilterCount > 1 ? "s" : "" }}</span>
      </h2>
      <button
        v-if="activeFilterCount"
        class="text-sm font-medium text-ink-muted hover:text-ink-secondary"
        @click="$emit('clear')"
      >
        Clear filters
      </button>
    </div>
    <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <div class="sm:col-span-2 lg:col-span-1">
        <SearchInput :model-value="modelValue" :placeholder="searchPlaceholder" @update:model-value="$emit('update:modelValue', $event)" />
      </div>
      <slot />
    </div>
  </div>
</template>
