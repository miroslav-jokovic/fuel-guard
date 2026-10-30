<script setup lang="ts">
import { onMounted } from "vue";
import { useScannerRelayStore } from "@/stores/scannerRelay";

/**
 * The strip that says THIS device has the office scanner (SCANNER-RELAY-PLAN.md SR4, D-SR3).
 *
 * In normal flow at the top, the environment banner's shape rather than a floating pill: the shop
 * layout's action bar owns the bottom of a tablet's screen and the assistant owns its bottom-right
 * corner, and a strip in flow covers neither. It is there for the whole time the device holds a
 * scanner, on every page, because "my scans went to the wrong screen" was the incident (10/30) and
 * the only honest guard is always being able to see where they go — and to stop.
 *
 * Mounted once, in `App.vue`, which is also where the tab resumes a scanner it held before a reload.
 */
const relay = useScannerRelayStore();
onMounted(() => relay.resume());
</script>

<template>
  <div
    v-if="relay.held"
    class="flex items-center justify-center gap-x-3 bg-info-50 px-4 py-1.5 text-xs text-info-800 ring-1 ring-info-200 ring-inset"
    role="status"
    data-testid="scanner-relay-bar"
  >
    <span class="relative flex size-2 shrink-0" aria-hidden="true">
      <span class="relative inline-flex size-2 rounded-full" :class="relay.reconnecting ? 'bg-warning-500' : 'bg-success-500'" />
    </span>
    <span class="min-w-0 truncate">
      <template v-if="relay.reconnecting">Reconnecting to {{ relay.held.name }}…</template>
      <template v-else>
        Scans from <span class="font-semibold">{{ relay.held.name }}</span> come to this screen
        <span v-if="relay.lastRead" class="font-mono text-info-700"> · last {{ relay.lastRead.code }}</span>
      </template>
    </span>
    <button
      type="button"
      class="shrink-0 rounded-control px-2 py-0.5 font-semibold text-info-800 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      @click="relay.release()"
    >
      Stop
    </button>
  </div>
</template>
