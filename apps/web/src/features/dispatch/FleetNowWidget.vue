<script setup lang="ts">
/**
 * Fleet right now — what every truck on the board is doing (FLEET-MANAGER-HOME-PLAN §4 card 1).
 *
 * A composition card: the three counts partition the board, so its door is the board itself rather
 * than one per row (D-FM9's reading for a part-to-whole card). Empty is the one part with a queue of
 * its own, and links to it; "No driver" is NOT here — it is the Seats card's figure, read from the
 * roster, and every figure on the tab appears once (D-FO1).
 *
 * Shares the board's query key, so this tab costs no request `/assignments` does not already make.
 */
import { computed } from "vue";
import { TruckIcon } from "@silvicom/ui/icons";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList, { type CountRow } from "@/components/ui/CountList.vue";
import { useDispatchBoardQuery } from "./useDispatchBoard";
import { boardDoor, fleetNow, queueLabel } from "./boardCounts";

const { data: board } = useDispatchBoardQuery();
const now = computed(() => (board.value ? fleetNow(board.value) : null));

const pct = (n: number | undefined) =>
  now.value && now.value.total > 0 && n != null ? `${Math.round((n / now.value.total) * 100)}% of the board` : undefined;

const rows = computed<CountRow[]>(() => [
  { key: "loaded", label: "Hauling a load", value: now.value?.loaded ?? null, caption: pct(now.value?.loaded) },
  { key: "empty", label: queueLabel("empty"), value: now.value?.empty ?? null, caption: pct(now.value?.empty), to: boardDoor("empty"), door: "Find a load" },
  { key: "in-shop", label: "In the shop", value: now.value?.inShop ?? null, caption: pct(now.value?.inShop) },
]);
</script>

<template>
  <ChartCard
    title="Fleet right now"
    subtitle="Every truck on the dispatch board, live"
    :icon="TruckIcon"
    tone="brand"
    :readout="now ? now.total.toLocaleString('en-US') : '—'"
    caption="trucks on the board"
    class="h-full"
  >
    <CountList :rows="rows" :more="{ to: boardDoor(), label: 'Dispatch board' }" />
  </ChartCard>
</template>
