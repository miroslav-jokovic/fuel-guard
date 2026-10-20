<script setup lang="ts">
/**
 * Truck paperwork — is every truck legal to run? (FLEET-MANAGER-HOME-PLAN §4 card 6).
 *
 * The annual DOT inspection and the registration, each as overdue / due soon / date only / no paper
 * and no date, asked of `matchesVehicleCheck` over each truck's FILE (UNIT-FILES-PLAN D-UF3, UF4) —
 * the predicate the Vehicles page filters with behind each door (D-FM7), so a count and the list it
 * opens are one answer. The paper's own date decides; McLeod's typed date stands in only where no
 * paper is filed, and those trucks are counted again on a "date only" line of their own, because a
 * date nobody can show the scan for is what an auditor writes up. A fleet with no papers filed counts
 * exactly what it counted before UF4: every date is then McLeod's.
 *
 * "No paper, no date" is a line of its own because an unknown date is not a current one: 51 of 244
 * trucks had neither on 2026-10-12, and folding them into "fine" would make the card read better the
 * less we know.
 *
 * "Today" is the API's: it judges each file on the carrier's calendar day (`todayInZone` over the org
 * zone), because a viewer in another zone must see the same trucks overdue.
 *
 * Both reads must be in before a count is shown — a truck whose file has not arrived answers no to
 * every paper check, and a zero printed then would be a claim, so the row reads "—" (CountList).
 */
import { computed } from "vue";
import { DocumentTextIcon } from "@silvicom/ui/icons";
import { matchesVehicleCheck, VEHICLE_CHECK_LABELS, type VehicleCheck } from "@silvicom/shared";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList, { type CountRow } from "@/components/ui/CountList.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useUnitFilesQuery } from "@/composables/useCompliance";

const { data: vehicles } = useVehiclesQuery();
const unitFilesQ = useUnitFilesQuery("tractor");
const fileById = computed(() =>
  unitFilesQ.data.value ? new Map(unitFilesQ.data.value.units.map((u) => [u.subject_id, u])) : null,
);

const count = (check: VehicleCheck) => {
  const files = fileById.value;
  if (!vehicles.value || !files) return null;
  return vehicles.value.filter((v) => v.status === "active" && matchesVehicleCheck(v, check, files.get(v.id))).length;
};
/** One caption per kind of answer — the label already says which paper. */
const CAPTION: Record<string, string> = {
  overdue: "past its date",
  due: "lapses soon",
  date_only: "McLeod's date, no paper filed",
  missing: "nothing on file",
};
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
  row("inspection_date_only"),
  row("inspection_missing"),
  row("registration_overdue", true),
  row("registration_due"),
  row("registration_date_only"),
  row("registration_missing"),
]);
</script>

<template>
  <ChartCard title="Truck paperwork" subtitle="Active trucks — annual inspection and registration" :icon="DocumentTextIcon" tone="warning" class="h-full">
    <CountList :rows="rows" />
  </ChartCard>
</template>
