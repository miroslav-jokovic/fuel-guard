<script setup lang="ts">
import { ref } from "vue";
import { useAppUpdate } from "@/composables/useAppUpdate";

/**
 * New-deploy notice — a floating glass pill (top-center, overlay: never shifts the layout). Frosted
 * dark surface with a pulsing dot. "Later" hides it for this tab; any reload/navigation to the new
 * build resolves it for real.
 */
const { updateAvailable, refresh } = useAppUpdate();
const dismissed = ref(false);
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="-translate-y-3 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-200 ease-in"
    leave-to-class="-translate-y-3 opacity-0"
  >
    <div
      v-if="updateAvailable && !dismissed"
      class="fixed inset-x-0 top-4 z-50 flex justify-center px-4"
      role="status"
    >
      <div
        class="pointer-events-auto flex items-center gap-3 rounded-full border border-sidebar-edge bg-surface-inverse/80 py-2 pr-2 pl-4 text-sm text-ink-inverse shadow-xl shadow-black/20 backdrop-blur-md"
      >
        <span class="relative flex size-2">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-400 opacity-60" />
          <span class="relative inline-flex size-2 rounded-full bg-success-400" />
        </span>
        <span class="text-ink-inverse/90">A new version is ready</span>
        <button
          type="button"
          class="rounded-full px-2.5 py-1 text-xs font-medium text-ink-inverse/60 transition hover:text-ink-inverse focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          @click="dismissed = true"
        >
          Later
        </button>
        <button
          type="button"
          class="rounded-full bg-ink-inverse px-3.5 py-1.5 text-xs font-semibold text-ink transition hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-edge-control"
          @click="refresh"
        >
          Refresh
        </button>
      </div>
    </div>
  </Transition>
</template>
