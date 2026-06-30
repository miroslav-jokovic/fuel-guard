<script setup lang="ts">
// Shimmer placeholder rows shown while a table's data loads.
withDefaults(defineProps<{ rows?: number; cols?: number }>(), { rows: 6, cols: 5 });
</script>

<template>
  <div class="px-6 py-4">
    <div v-for="r in rows" :key="r" class="flex items-center gap-4 py-3" :class="{ 'border-t border-gray-100': r > 1 }">
      <div
        v-for="c in cols"
        :key="c"
        class="h-3 animate-pulse rounded bg-gray-200"
        :class="c === 1 ? 'w-24' : c === cols ? 'w-12' : 'flex-1'"
      />
    </div>
  </div>
</template>
