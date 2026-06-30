<script setup lang="ts">
import { useRoute } from "vue-router";
const route = useRoute();
</script>

<template>
  <div
    class="flex min-h-64 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white"
  >
    <div class="text-center">
      <h2 class="text-lg font-semibold text-gray-900">
        {{ (route.meta.title as string) ?? "Coming soon" }}
      </h2>
      <p class="mt-1 text-sm text-gray-500">This module is scaffolded and built in a later phase.</p>
    </div>
  </div>
</template>
