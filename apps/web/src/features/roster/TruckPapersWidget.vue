<script setup lang="ts">
/**
 * Truck paperwork — is every truck legal to run? (FLEET-MANAGER-HOME-PLAN §4 card 6).
 *
 * The annual DOT inspection and the registration, each as overdue / due soon / not on file, asked of
 * `matchesVehicleCheck` — the predicate the Vehicles page filters with behind each door (D-FM7). "Not
 * on file" is a line of its own because an unknown date is not a current one: 51 of 244 trucks had
 * neither on 2026-10-12, and folding them into "fine" would make the card read better the less we
 * know.
 *
 * "Today" is the carrier's calendar day (`todayInZone` over the org zone), because both columns are
 * calendar dates and a viewer in another zone must see the same trucks overdue.
 */
import { computed } from "vue";
import { DocumentTextIcon } from "@silvicom/ui/icons";
import { matchesVehicleCheck, todayInZone, VEHICLE_CHECK_LABELS, type VehicleCheck } from "@silvicom/shared";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList, { type CountRow } from "@/components/ui/CountList.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useOrgTimezone } from "@/composables/useOrgTimezone";

const { zone } = useOrgTimezone();
const { data: vehicles } = useVehiclesQuery();

const count = (check: VehicleCheck) => {
  if (!vehicles.value) return null;
  const today = todayInZone(new Date(), zone.value);
  return vehicles.value.filter((v) => v.status === "active" && matchesVehicleCheck(v, check, today)).length;
};
/** One caption per kind of answer — the label already says which paper. */
const CAPTION: Record<string, string> = { overdue: "past the date on file", due: "lapses soon", missing: "no date recorded" };
const row = (check: VehicleCheck, alarm = false): CountRow => ({
  key: check,
  label: VEHICLE_CHECK_LABELS[check],
  value: count(check),
  caption: CAPTION[check.slice(check.indexOf("_") + 1)],
  to: `/vehicles?check=${check}`,
  door: "Trucks",
  alarm,
});

const rows = computed<CountRow[]>(() => [
  row("inspection_overdue", true),
  row("inspection_due"),
  row("inspection_missing"),
  row("registration_overdue", true),
  row("registration_due"),
  row("registration_missing"),
]);
</script>

<template>
  <ChartCard title="Truck paperwork" subtitle="Active trucks — annual inspection and registration" :icon="DocumentTextIcon" tone="warning" class="h-full">
    <CountList :rows="rows" />
  </ChartCard>
</template>
