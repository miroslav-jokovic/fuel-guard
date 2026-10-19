<script setup lang="ts">
/**
 * What a Drug & Alcohol list MEANS and what to do about it, one caption above its workspace. Outside
 * the card, because the house list (contract §5.2b) opens on its toolbar: which list is showing is
 * the Show filter's own label, and the count is the toolbar's.
 */
defineProps<{ text: string }>();
</script>

<template>
  <p class="text-sm text-ink-muted">{{ text }}</p>
</template>
