<script setup lang="ts">
import PageHeader from "@/components/ui/PageHeader.vue";
import LiveMapPanel from "@/features/livemap/LiveMapPanel.vue";
import { LIVE_MAP_POLL_MS } from "@/features/livemap/useLiveMapBoard";

/**
 * `/live-map` — the dispatcher's board (LIVE-MAP-PLAN.md LM8).
 *
 * The page is the shell; `LiveMapPanel` is the surface, because LM-T embeds the same component as
 * the Dashboard's Dispatch tab (D-DW5). Keeping the page thin is what makes that a second call
 * rather than a second copy.
 *
 * ── THE FRESHNESS SENTENCE IS DERIVED, NOT TYPED ─────────────────────────────────────────────────
 * D-LM9b stacks three intervals — the vendor's ping, the collector tier and this poll — and the
 * browser only owns the last one. It is read from `LIVE_MAP_POLL_MS` so that the day somebody
 * retunes the poll, the sentence on the page changes with it instead of quietly becoming false.
 */
const pollSeconds = Math.round(LIVE_MAP_POLL_MS / 1000);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Where every truck is right now, and what it is doing.">
      <template #freshness>Positions refresh every {{ pollSeconds }} seconds while this tab is open.</template>
    </PageHeader>
    <LiveMapPanel />
  </div>
</template>
