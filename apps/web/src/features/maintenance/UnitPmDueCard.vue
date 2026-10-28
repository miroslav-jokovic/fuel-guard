<script setup lang="ts">
import { computed } from "vue";
import { AppBadge, AppCard as BaseCard, DataTable, type DataTableColumn } from "@silvicom/ui";
import type { PmIntervalStatusDto, PmScheduleDto, UnitShopFileDto } from "@silvicom/shared";
import { formatDate } from "@/lib/format";

/**
 * Due — every service FleetPal schedules on this unit, against the latest meter (FleetPal F11;
 * MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.3). The verdicts are the server's (`pmStatus`, the one
 * rule the dispatch board's chips use); this card only words them.
 *
 * A schedule nobody can judge — never done, or a mileage interval on a trailer with no meter — says
 * "Can't tell", never "OK": F11's done-when is that a truck with no schedule shows nothing rather than
 * zero, and this is the same rule one level down.
 */
const props = defineProps<{ pm: UnitShopFileDto["pm"]; fleetpalMeter: UnitShopFileDto["fleetpal"]["lastMeter"] }>();

const COLUMNS: DataTableColumn[] = [
  { key: "name", label: "Service", card: "title", cellClass: "font-medium text-ink" },
  { key: "lastDone", label: "Last done", card: "none", width: "md" },
  { key: "due", label: "Due", card: "sentence" },
  { key: "verdict", label: "Status", card: "meta", width: "sm" },
];
const rows = computed(() => props.pm.schedules as unknown as Record<string, unknown>[]);

const miles = (n: number) => `${n.toLocaleString("en-US")} mi`;
/** "12/05/2026" or "in 1,133 mi" / "1,133 mi ago" — one phrase per interval, the worst first. */
function dueText(s: PmScheduleDto): string {
  const RANK = { overdue: 0, due: 1, ok: 2 };
  const ordered = [...s.intervals].sort((a, b) => RANK[a.verdict] - RANK[b.verdict]);
  const words = ordered.map((i: PmIntervalStatusDto) =>
    i.dueOn ? formatDate(i.dueOn) : i.milesLeft !== null ? (i.milesLeft < 0 ? `${miles(-i.milesLeft)} ago` : `in ${miles(i.milesLeft)}`) : null,
  );
  const said = words.filter((w): w is string => w !== null);
  return said.length ? said.join(" or ") : "Can't tell";
}
const tone = (v: PmScheduleDto["verdict"]) => (v === "overdue" ? "danger" : v === "due" ? "caution" : v === "ok" ? "success" : "neutral");
const label = (v: PmScheduleDto["verdict"]) => (v === "overdue" ? "Overdue" : v === "due" ? "Due soon" : v === "ok" ? "OK" : "Can't tell");
</script>

<template>
  <BaseCard id="section-due" class="scroll-mt-6" padding="none" data-test="unit-pm-due">
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-edge-subtle px-5 py-3">
      <h2 class="text-sm font-semibold text-ink">Due</h2>
      <p class="text-xs text-ink-muted">
        <template v-if="pm.odometerMiles !== null">Odometer {{ miles(pm.odometerMiles) }} (Samsara)</template>
        <template v-else>No odometer reading, so mileage services can't be judged</template>
        <template v-if="fleetpalMeter"> · FleetPal read {{ miles(fleetpalMeter.miles) }} on {{ formatDate(fleetpalMeter.measuredAt) }}</template>
      </p>
    </div>
    <!-- ui-adoption: never-paged — one unit's service schedules in FleetPal — a handful, all of which matter at once. -->
    <DataTable embedded :columns="COLUMNS" :rows="rows" row-key="fleetpalId" empty-text="FleetPal has no service schedule for this unit.">
      <template #cell-name="{ row }">{{ (row as unknown as PmScheduleDto).name ?? "Service" }}</template>
      <template #cell-lastDone="{ value }">{{ value ? formatDate(value) : "Never" }}</template>
      <template #cell-due="{ row }">{{ dueText(row as unknown as PmScheduleDto) }}</template>
      <template #cell-verdict="{ value }">
        <AppBadge :tone="tone(value)">{{ label(value) }}</AppBadge>
      </template>
      <template #empty><p>FleetPal has no service schedule for this unit.</p></template>
    </DataTable>
  </BaseCard>
</template>
