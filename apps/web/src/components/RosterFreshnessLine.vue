<script setup lang="ts">
import { computed } from "vue";
import { rosterFreshnessState } from "@silvicom/shared";
import { useRosterFreshness } from "@/composables/useRosterFreshness";
import { formatDateTime } from "@/lib/format";

/**
 * When McLeod's roster was last READ, in the header of every page that lists it (E6; D-MR2's
 * "as of HH:MM", decided in 2026 and never built until 2026-09-22).
 *
 * ── WHY THESE PAGES NEED A LINE ────────────────────────────────────────────────────────────────
 * McLeod decides which trucks, trailers and drivers exist (D-FC0), and the sync runs on one office
 * machine on the carrier's network. When it stops — the machine asleep, off-site, or never started
 * — every list here stays exactly as it was, which looks identical to a roster where nothing
 * happened. Until this line, the only symptom was a wrong number weeks later: on 2026-09-22 the
 * roster had last been read eight days earlier and nothing on screen said so.
 *
 * Toned as `FeedFreshnessLine` tones the fuel feeds, for its reason: ordinary metadata while current,
 * the caution treatment only when the read is late or has never happened. A line that cannot be
 * fetched says nothing — the rows below are still McLeod's rows.
 */
const { data, dataUpdatedAt } = useRosterFreshness();

// `dataUpdatedAt` moves on every refetch even when the answer is unchanged, so a page left open
// crosses into "stale" on its own rather than waiting for a reload.
const state = computed(() =>
  data.value?.configured ? rosterFreshnessState(data.value.readAt, new Date(dataUpdatedAt.value || Date.now())) : null,
);
const tone = computed(() =>
  state.value === "fresh"
    ? "text-xs text-ink-tertiary"
    : "rounded-surface bg-caution-50 px-4 py-2.5 text-sm text-caution-800 ring-1 ring-caution-100",
);
</script>

<template>
  <p v-if="state" :class="tone" data-testid="roster-freshness">
    <template v-if="state === 'never'">McLeod has not been read yet, so this list may not match it.</template>
    <template v-else-if="state === 'stale'">
      McLeod was last read {{ formatDateTime(data!.readAt!) }}. This list may be out of date until the sync
      runs again.
    </template>
    <template v-else>From McLeod, as of {{ formatDateTime(data!.readAt!) }}.</template>
  </p>
</template>
