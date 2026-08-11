<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <section class="space-y-3">
    <div>
      <h2 class="text-xs font-semibold uppercase tracking-wider text-ink-tertiary">{{ title }}</h2>
      <p v-if="description" class="mt-1 text-sm text-ink-tertiary">{{ description }}</p>
    </div>
    <slot />
  </section>
</template>
