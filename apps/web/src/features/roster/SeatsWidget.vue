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
 * Population: RUNNING trucks (`isRunningTruck` — `active` and not being wound down) and drivers at
 * `active` and not archived. The door keeps working without a status parameter because `active` is
 * the Vehicles page's default and `no_driver` itself leaves wound-down trucks out.
 *
 * ── WHY RUNNING, NOT ACTIVE ──────────────────────────────────────────────────────────────────────
 * Until 2026-10-14 this read "159 of 198": 27 of the 198 were trucks McLeod is winding down (sold or
 * retiring, `winding_down`, D-DB11), all without a driver and none ever to get one. The truth was 159
 * of 171, and "Trucks without a driver" said 39 when 12 were waiting. They are counted on their own
 * line so the 27 stay visible and the readout's denominator stays the trucks somebody can drive.
 */
import { UserGroupIcon } from "@silvicom/ui/icons";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList from "@/components/ui/CountList.vue";
import { useSeatsRows } from "./useSeatsRows";

const { running, seatedCount, rows } = useSeatsRows();
</script>

<template>
  <ChartCard
    title="Seats"
    subtitle="Trucks and the drivers in them"
    :icon="UserGroupIcon"
    tone="info"
    :readout="seatedCount == null || !running ? '—' : `${seatedCount} of ${running.length}`"
    caption="running trucks have a driver"
    class="h-full"
  >
    <CountList :rows="rows" />
  </ChartCard>
</template>
