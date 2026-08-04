<script setup lang="ts">
import { useAppUpdate } from "@/composables/useAppUpdate";

/** Slim top-of-app banner shown when a newer build has been deployed behind this tab. */
const { updateAvailable, refresh } = useAppUpdate();
</script>

<template>
  <div
    v-if="updateAvailable"
    class="sticky top-0 z-50 flex items-center justify-center gap-3 bg-brand-600 px-4 py-2 text-sm text-white shadow"
    role="status"
  >
    <span>A new version of FuelGuard is available.</span>
    <button
      type="button"
      class="rounded-md bg-white/15 px-3 py-1 text-sm font-semibold text-white hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      @click="refresh"
    >
      Refresh now
    </button>
  </div>
</template>
