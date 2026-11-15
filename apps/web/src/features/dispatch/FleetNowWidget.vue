<script setup lang="ts">
/**
 * Fleet right now — what every truck on the board is doing (FLEET-MANAGER-HOME-PLAN §4 card 1).
 *
 * ── A STRIP ACROSS THE TAB, NOT ONE CARD AMONG TEN (SMALL-SCREENS-PLAN.md D-SM12, C2, 2026-11-15) ──
 * Until C2 this was a card of the same width and weight as Hiring or Truck paperwork, and the owner's
 * audit read the tab as ten equal boxes with no order. The board's four figures are the state of the
 * fleet — the thing a fleet manager reads before anything else — so they lead the tab as four tiles
 * across its full width (catalogued `span: 12`), the shared `StatCard`, two-up on a phone.
 *
 * The three parts still partition the board, and "No driver" is still NOT here — it is the Seats
 * card's figure, read from the roster, and every state figure on the tab appears once (D-FO1).
 *
 * ── EVERY TILE WITH A LIST IS ITS DOOR (D-FM9) ───────────────────────────────────────────────────
 * The total opens the board; Empty opens its queue, in the door's own words. Hauling and In the shop
 * have no queue of their own and stay figures. A tile is a link only when the page opens for the
 * reader (`useOpens`, SP5) — the figure stays either way, as `DoorLink` does it on the cards.
 *
 * Shares the board's query key, so this tab costs no request `/assignments` does not already make.
 */
import { computed } from "vue";
import { StatCard } from "@silvicom/ui";
import { useOpens } from "@/composables/useOpens";
import { boardDoor } from "./boardCounts";
import { useFleetNowRows } from "./useFleetNowRows";

const { now, rows } = useFleetNowRows();
const opens = useOpens();
const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

interface Tile { key: string; label: string; value: number | null; sub?: string; to?: string }

const tiles = computed<Tile[]>(() => {
  const door = (to: string | undefined) => (to && opens(to) ? to : undefined);
  const withDoor = (caption: string | undefined, to: string | undefined, words: string | undefined) =>
    to && words ? [caption, words].filter(Boolean).join(" · ") : caption;
  const board = door(boardDoor());
  return [
    { key: "total", label: "Trucks on the board", value: now.value?.total ?? null, sub: withDoor("live from dispatch", board, "Dispatch board"), to: board },
    ...rows.value.map((r) => {
      const to = door(r.to);
      return { key: r.key, label: r.label, value: r.value, sub: withDoor(r.caption, to, r.door), to };
    }),
  ];
});
</script>

<template>
  <!-- `@container`: the strip reads its OWN width, like every grid on this tab (D-SM9) — four across
       needs 48rem of strip, not of window. -->
  <section class="@container" aria-label="Fleet right now">
    <div class="grid grid-cols-2 gap-3 @3xl:grid-cols-4 @3xl:gap-6">
      <StatCard
        v-for="t in tiles"
        :key="t.key"
        :label="t.label"
        :value="fmt(t.value)"
        :sub="t.sub"
        :to="t.to"
        :muted="t.value === 0"
        :data-test="`count-${t.key}`"
      />
    </div>
  </section>
</template>
