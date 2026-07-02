<script setup lang="ts">
import { ChevronUpIcon, ChevronDownIcon, ChevronUpDownIcon } from "@heroicons/vue/20/solid";
import type { SortDir } from "@/lib/sort";

withDefaults(defineProps<{ label: string; sortKey: string; active: string | null; dir: SortDir; thClass?: string }>(), {
  thClass: "px-4 py-3 font-medium",
});
const emit = defineEmits<{ sort: [key: string] }>();
</script>

<template>
  <th :class="thClass">
    <button type="button" class="group inline-flex items-center gap-1 hover:text-gray-700" @click="emit('sort', sortKey)">
      {{ label }}
      <ChevronUpIcon v-if="active === sortKey && dir === 'asc'" class="size-3.5 text-gray-500" />
      <ChevronDownIcon v-else-if="active === sortKey && dir === 'desc'" class="size-3.5 text-gray-500" />
      <ChevronUpDownIcon v-else class="size-3.5 text-gray-300 group-hover:text-gray-400" />
    </button>
  </th>
</template>
