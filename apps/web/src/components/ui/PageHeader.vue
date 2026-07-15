<script setup lang="ts">
/**
 * Standard first row of a page: muted description on the left (the page
 * title itself lives in the AppShell top bar), action buttons on the right.
 * Stacks vertically below the sm breakpoint.
 */
withDefaults(defineProps<{ description?: string }>(), { description: undefined });
</script>

<template>
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <p class="text-sm text-ink-muted">
      <slot>{{ description }}</slot>
    </p>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
