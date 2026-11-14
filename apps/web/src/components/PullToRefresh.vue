<script setup lang="ts">
import { computed } from "vue";
import { PULL_THRESHOLD_PX, usePullToRefresh } from "@/lib/pullToRefresh";

/**
 * The pull-down indicator of the installed app (CHAT-WEB-PUSH-PLAN.md D-WP17; `lib/pullToRefresh.ts` has
 * the rules for when a pull may start). `UpdateBanner`'s pill, so the two things that reload the app look
 * like one family. It follows the finger, says when letting go will refresh, and renders nothing otherwise.
 */
const { distance, refreshing } = usePullToRefresh();
const ready = computed(() => distance.value >= PULL_THRESHOLD_PX);
</script>

<template>
  <div
    v-if="distance > 0 || refreshing"
    class="pointer-events-none fixed inset-x-0 top-0 z-dialog flex justify-center px-4"
    :style="{ transform: `translateY(${refreshing ? PULL_THRESHOLD_PX / 2 : distance / 2}px)` }"
    role="status"
    data-testid="pull-to-refresh"
  >
    <div class="flex items-center gap-2 rounded-full border border-ink-inverse/10 bg-surface-inverse/80 px-4 py-2 text-xs text-ink-inverse shadow-overlay backdrop-blur-md">
      <span class="relative flex size-2" aria-hidden="true">
        <span v-if="refreshing || ready" class="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-400 opacity-60 motion-reduce:animate-none" />
        <span class="relative inline-flex size-2 rounded-full" :class="refreshing || ready ? 'bg-success-400' : 'bg-ink-inverse/40'" />
      </span>
      <span>{{ refreshing ? "Refreshing…" : ready ? "Release to refresh" : "Pull to refresh" }}</span>
    </div>
  </div>
</template>
