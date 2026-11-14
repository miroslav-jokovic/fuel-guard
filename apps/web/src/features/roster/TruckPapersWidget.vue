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
import { matchesVehicleCheck, type VehicleCheck } from "@silvicom/shared";
import { PAPERS, PAPER_STATES, paperCheck, paperStateLabel } from "./truckPapersGrid";
import ChartCard from "@/components/ui/ChartCard.vue";
import DoorLink from "@/components/ui/DoorLink.vue";
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
// One grid, four states by two papers — see `truckPapersGrid.ts` for why, and for where the row
// names come from. Every figure is still its own door (D-FM9), to the same filtered list as before.
const grid = computed(() =>
  PAPER_STATES.map((state) => ({
    state,
    label: paperStateLabel(PAPERS[0], state),
    cells: PAPERS.map((paper) => {
      const check = paperCheck(paper, state);
      return { check, paper: paper.label, value: count(check), to: `/vehicles?check=${check}`, alarm: state === "overdue" };
    }),
  })),
);
const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US"));
</script>

<template>
  <ChartCard title="Truck paperwork" subtitle="Active trucks — annual inspection and registration" :icon="DocumentTextIcon" tone="warning" class="h-full">
    <table class="w-full text-sm">
      <thead>
        <tr class="text-2xs uppercase tracking-wide text-ink-muted">
          <th scope="col" class="pb-2 text-left font-medium"><span class="sr-only">State</span></th>
          <th v-for="paper in PAPERS" :key="paper.key" scope="col" class="w-24 pb-2 pl-3 text-right align-bottom font-medium">{{ paper.label }}</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-edge-subtle">
        <tr v-for="r in grid" :key="r.state">
          <th scope="row" class="py-2 text-left font-normal text-ink-secondary">{{ r.label }}</th>
          <td v-for="c in r.cells" :key="c.check" class="py-2 pl-3 text-right whitespace-nowrap">
            <span
              class="tabular-nums"
              :class="c.value === 0 ? 'font-medium text-ink-tertiary' : c.alarm && (c.value ?? 0) > 0 ? 'text-base font-bold text-danger-text' : 'text-base font-bold text-ink'"
              :data-test="`count-${c.check}`"
            >{{ fmt(c.value) }}</span>
            <DoorLink :to="c.to"><span class="sr-only">Trucks: {{ c.paper }}, {{ r.label.toLowerCase() }}</span></DoorLink>
          </td>
        </tr>
      </tbody>
    </table>
  </ChartCard>
</template>
