<script setup lang="ts">
import { ChevronUpIcon, ChevronDownIcon, ChevronUpDownIcon } from "@heroicons/vue/20/solid";
import type { SortDir } from "@/lib/sort";

withDefaults(defineProps<{ label: string; sortKey: string; active: string | null; dir: SortDir; thClass?: string }>(), {
  thClass: "px-6 py-3 font-medium",
});
const emit = defineEmits<{ sort: [key: string] }>();
</script>

<template>
  <th :class="thClass">
    <button type="button" class="group inline-flex items-center gap-1 hover:text-ink-secondary" @click="emit('sort', sortKey)">
      {{ label }}
      <ChevronUpIcon v-if="active === sortKey && dir === 'asc'" class="size-3.5 text-ink-muted" />
      <ChevronDownIcon v-else-if="active === sortKey && dir === 'desc'" class="size-3.5 text-ink-muted" />
      <ChevronUpDownIcon v-else class="size-3.5 text-ink-subtle group-hover:text-ink-subtle" />
    </button>
  </th>
</template>
