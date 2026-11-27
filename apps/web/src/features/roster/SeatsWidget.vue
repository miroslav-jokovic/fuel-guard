<script setup lang="ts">
/**
 * Trucks — how many trucks the fleet has, and where each one is (FLEET-MANAGER-HOME-PLAN §4 card 4,
 * D-FM11). The catalogue key stays `ops.seats` so saved layouts keep the card.
 *
 * Every count is asked of `@silvicom/shared`'s `fleetChecks` — the same predicate the Vehicles and
 * Drivers pages filter with when the door hands them `?check=` / `?seat=` — so the figure is the row
 * count behind it (D-FM7).
 *
 * ── THE DRIVERS LINE IS GATED PER ELEMENT ────────────────────────────────────────────────────────
 * The card is `equipment`; the drivers line reads the roster, so it renders only for a caller who may
 * view `roster` — `moneyGate`'s per-element pattern, for a section rather than for money. Asked through
 * `session.canView`, never a role.
 *
 * ── WHY A LEDGER (D-FM10 → D-FM11) ───────────────────────────────────────────────────────────────
 * "159 of 198" (2026-10-14) counted sold trucks; "179 of 196" (2026-11-26) counted the Unassigned pool
 * beside a board of 181; "177 of 181" (D-FM10) matched the board but not the Vehicles page's 204, which
 * itself hid the 6 trucks in the shop. Each was a ratio over a population the reader had to guess. The
 * owner asked for the fleet, precisely: so the readout is the fleet (210 on 2026-11-27), its caption is
 * the sum of the three groups that make it, and each group is a row with its door.
 */
import { TruckIcon } from "@silvicom/ui/icons";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList from "@/components/ui/CountList.vue";
import { fleetSum, useSeatsRows } from "./useSeatsRows";

const { fleet, rows } = useSeatsRows();
</script>

<template>
  <ChartCard
    title="Trucks"
    subtitle="The fleet McLeod has in service"
    :icon="TruckIcon"
    tone="info"
    :readout="fleet ? `${fleet.total} trucks` : '—'"
    :caption="fleet ? fleetSum(fleet) : undefined"
    class="h-full"
  >
    <CountList :rows="rows" />
  </ChartCard>
</template>
