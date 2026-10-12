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
 * Population: trucks at `active` (the Vehicles page's default status, so the door needs no status
 * parameter) and drivers at `active` and not archived.
 */
import { computed } from "vue";
import { UserGroupIcon } from "@silvicom/ui/icons";
import { matchesVehicleCheck, seatedDriverIds, todayInZone } from "@silvicom/shared";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList, { type CountRow } from "@/components/ui/CountList.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useSessionStore } from "@/stores/session";

const session = useSessionStore();
const { zone } = useOrgTimezone();
const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();

const active = computed(() => (vehicles.value ? vehicles.value.filter((v) => v.status === "active") : null));
const noDriver = computed(() => {
  const today = todayInZone(new Date(), zone.value);
  return active.value ? active.value.filter((v) => matchesVehicleCheck(v, "no_driver", today)).length : null;
});
const unseated = computed(() => {
  if (!vehicles.value || !drivers.value) return null;
  const seated = seatedDriverIds(vehicles.value);
  return drivers.value.filter((d) => d.status === "active" && !d.archived_at && !seated.has(d.id)).length;
});
const ordered = computed(() => (vehicles.value ? vehicles.value.filter((v) => v.status === "ordered").length : null));

const rows = computed<CountRow[]>(() => [
  { key: "no-driver", label: "Trucks without a driver", value: noDriver.value, caption: "active trucks nobody is assigned to", to: "/vehicles?check=no_driver", door: "Vehicles", alarm: true },
  ...(session.canView("roster")
    ? [{ key: "no-truck", label: "Drivers without a truck", value: unseated.value, caption: "active drivers holding no truck", to: "/drivers?status=active&seat=none", door: "Drivers" }]
    : []),
  { key: "ordered", label: "Trucks on order", value: ordered.value, caption: "not in service yet", to: "/vehicles?status=ordered", door: "Vehicles" },
]);

const seatedCount = computed(() => (active.value && noDriver.value != null ? active.value.length - noDriver.value : null));
</script>

<template>
  <ChartCard
    title="Seats"
    subtitle="Trucks and the drivers in them"
    :icon="UserGroupIcon"
    tone="info"
    :readout="seatedCount == null || !active ? '—' : `${seatedCount} of ${active.length}`"
    caption="active trucks have a driver"
    class="h-full"
  >
    <CountList :rows="rows" />
  </ChartCard>
</template>
