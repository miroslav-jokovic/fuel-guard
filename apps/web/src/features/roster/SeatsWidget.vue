<script setup lang="ts">
/**
 * Seats — is every truck earning? (FLEET-MANAGER-HOME-PLAN §4 card 4).
 *
 * 39 active trucks had no `assigned_driver_id` on 2026-10-12 and no screen said so; this card is the
 * first. Every count is asked of `@silvicom/shared`'s `fleetChecks` — the same predicate the Vehicles
 * and Drivers pages filter with when the door hands them `?check=` / `?seat=` — so the figure is the
 * row count behind it (D-FM7).
 *
 * ── THE DRIVERS LINE IS GATED PER ELEMENT ────────────────────────────────────────────────────────
 * The card is `equipment`; the drivers line reads the roster, so it renders only for a caller who may
 * view `roster` — `moneyGate`'s per-element pattern, for a section rather than for money. Asked through
 * `session.canView`, never a role.
 *
 * Population: the trucks on the dispatch board (`isOnDispatchBoard`) — the same trucks, and so the same
 * total, as Fleet right now's "Trucks on the board" — and drivers at `active` and not archived.
 *
 * ── WHY THE BOARD'S TRUCKS (D-FM10, 2026-11-26) ──────────────────────────────────────────────────
 * Until 2026-10-14 this read "159 of 198": 27 of the 198 were trucks McLeod is winding down. The fix
 * counted RUNNING trucks, and on 2026-11-26 the card read "179 of 196" beside a board of 181 — two
 * truck totals a strip apart, and 14 of its 17 "trucks without a driver" were parked in the Unassigned
 * pool (McLeod fleet '1'), which the board leaves out by the owner's ruling (Q-DB2) and nobody is
 * meant to seat. The owner read it as contradicting numbers, which it was. The card now counts the
 * board's 181 (177 with a driver, 4 without), and every other truck in service is one "Off the
 * board" line (29), its caption saying why — so the two cards share one total and nothing vanishes.
 */
import { UserGroupIcon } from "@silvicom/ui/icons";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList from "@/components/ui/CountList.vue";
import { useSeatsRows } from "./useSeatsRows";

const { onBoard, seatedCount, rows } = useSeatsRows();
</script>

<template>
  <ChartCard
    title="Seats"
    subtitle="Trucks and the drivers in them"
    :icon="UserGroupIcon"
    tone="info"
    :readout="seatedCount == null || !onBoard ? '—' : `${seatedCount} of ${onBoard.length}`"
    caption="trucks on the board have a driver"
    class="h-full"
  >
    <CountList :rows="rows" />
  </ChartCard>
</template>
