<script setup lang="ts">
import { useRoute } from "vue-router";
const route = useRoute();
</script>

<template>
  <div
    class="flex min-h-64 items-center justify-center rounded-lg border-2 border-dashed border-edge-strong bg-surface"
  >
    <div class="text-center">
      <h2 class="text-lg font-semibold text-ink">
        {{ (route.meta.title as string) ?? "Coming soon" }}
      </h2>
      <p class="mt-1 text-sm text-ink-muted">This module is scaffolded and built in a later phase.</p>
    </div>
  </div>
</template>
