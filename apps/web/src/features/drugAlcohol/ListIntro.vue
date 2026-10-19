<script setup lang="ts">
/**
 * The first row of a Drug & Alcohol tab's workspace: what the list MEANS and what to do about it.
 * The count is the toolbar's (FilterBar `:count`), so it is not repeated beside the title.
 */
defineProps<{ title: string; why: string }>();
</script>

<template>
  <div class="px-6 pt-5 pb-3">
    <h2 class="text-sm font-semibold text-ink">{{ title }}</h2>
    <p class="mt-1 text-xs text-ink-muted">{{ why }}</p>
  </div>
</template>
