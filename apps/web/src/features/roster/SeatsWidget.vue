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
import { computed } from "vue";
import { UserGroupIcon } from "@silvicom/ui/icons";
import { isRunningTruck, matchesVehicleCheck, seatedDriverIds } from "@silvicom/shared";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList, { type CountRow } from "@/components/ui/CountList.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { useSessionStore } from "@/stores/session";

const session = useSessionStore();
const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();

const running = computed(() => (vehicles.value ? vehicles.value.filter(isRunningTruck) : null));
// The seat checks ask nothing of a truck's file, so none is passed (`matchesVehicleCheck`).
const noDriver = computed(() =>
  running.value ? running.value.filter((v) => matchesVehicleCheck(v, "no_driver", undefined)).length : null,
);
const unseated = computed(() => {
  if (!vehicles.value || !drivers.value) return null;
  const seated = seatedDriverIds(vehicles.value);
  return drivers.value.filter((d) => d.status === "active" && !d.archived_at && !seated.has(d.id)).length;
});
const ordered = computed(() => (vehicles.value ? vehicles.value.filter((v) => v.status === "ordered").length : null));
const windingDown = computed(() =>
  vehicles.value ? vehicles.value.filter((v) => v.status === "active" && matchesVehicleCheck(v, "winding_down", undefined)).length : null,
);

const rows = computed<CountRow[]>(() => [
  { key: "no-driver", label: "Trucks without a driver", value: noDriver.value, caption: "running trucks nobody is assigned to", to: "/vehicles?check=no_driver", door: "Vehicles", alarm: true },
  ...(session.canView("roster")
    ? [{ key: "no-truck", label: "Drivers without a truck", value: unseated.value, caption: "active drivers holding no truck", to: "/drivers?status=active&seat=none", door: "Drivers" }]
    : []),
  { key: "winding-down", label: "Trucks being wound down", value: windingDown.value, caption: "sold or retiring in McLeod — not counted above", to: "/vehicles?check=winding_down", door: "Vehicles" },
  { key: "ordered", label: "Trucks on order", value: ordered.value, caption: "not in service yet", to: "/vehicles?status=ordered", door: "Vehicles" },
]);

const seatedCount = computed(() => (running.value && noDriver.value != null ? running.value.length - noDriver.value : null));
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
