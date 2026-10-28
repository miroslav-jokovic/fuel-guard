<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { DataTable, type DataTableColumn } from "@silvicom/ui";
import { byRepairUrgency, repairClock, repairSettled, repairUnitName, todayInZone, type RoadsideRepairDueDto } from "@silvicom/shared";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useOpens } from "@/composables/useOpens";
import { formatDate } from "@/lib/format";
import { useRoadsideRepairsDueQuery } from "./useRoadsideInspections";

/**
 * "Roadside repairs due" on the Shop home (INSPECTION-CHALLENGE-PLAN IC11 B2b, Q-IC16 (a), owner 2026-10-19):
 * the open repairs nearest to today, beside the backlog FleetPal holds — a 396.9(d) deadline is the shop's
 * work like a work order is. The rows are the page's own (`RoadsideRepairsPage`, same query, same order),
 * cut to the first few; a row opens the page at its inspection, where the work order is named.
 *
 * Shown only when the page opens for this reader (SP5's `useOpens`): a section whose every row bounces is
 * worse than none.
 */

/**
 * D-MX2 (2026-10-27): on the worklist home a group with nothing in it is not drawn. The section keeps
 * its empty sentence for any other caller; the home passes `hideWhenEmpty`.
 */
const props = defineProps<{ hideWhenEmpty?: boolean }>();
const PREVIEW_ROWS = 5;

const opens = useOpens();
const pageOpen = computed(() => opens("/shop/roadside-repairs"));
const due = useRoadsideRepairsDueQuery(pageOpen);
const { zone } = useOrgTimezone();
const today = computed(() => todayInZone(new Date(), zone.value));

const open = computed(() => (due.data.value ?? []).filter((r) => !repairSettled(r)).sort(byRepairUrgency(today.value)));
const preview = computed(() => open.value.slice(0, PREVIEW_ROWS));
const drawn = computed(
  () => pageOpen.value && !(props.hideWhenEmpty && !due.isLoading.value && !due.isError.value && open.value.length === 0),
);

const COLUMNS: DataTableColumn[] = [
  { key: "unit", label: "Unit", card: "title", cellClass: "font-medium text-ink", width: "sm" },
  { key: "inspected", label: "Inspected", card: "sentence", width: "md" },
  { key: "due", label: "Due", card: "meta", width: "md" },
];

function dueText(r: RoadsideRepairDueDto): { text: string; tone: string } {
  const c = repairClock(r.dueOn, today.value);
  if (c.overdue) return { text: `${c.days} ${c.days === 1 ? "day" : "days"} overdue`, tone: "font-medium text-danger-700" };
  return { text: `${formatDate(r.dueOn)} · ${c.days === 0 ? "today" : `${c.days} ${c.days === 1 ? "day" : "days"} left`}`, tone: c.days <= 3 ? "font-medium text-warning-700" : "text-ink" };
}

const router = useRouter();
const openRow = (r: RoadsideRepairDueDto) => router.push({ path: "/shop/roadside-repairs", query: { inspection: r.inspection.id } });
</script>

<template>
  <section v-if="drawn" class="space-y-3" data-test="roadside-repairs-due">
    <div class="flex items-center justify-between gap-4">
      <h2 class="text-sm font-semibold text-ink">Roadside repairs due</h2>
      <RouterLink to="/shop/roadside-repairs" class="text-sm font-medium text-link hover:text-link-hover" data-test="roadside-repairs-all">
        {{ open.length > PREVIEW_ROWS ? `All ${open.length} open` : "All roadside repairs" }}
      </RouterLink>
    </div>
    <DataTable
      :columns="COLUMNS"
      :rows="preview"
      row-key="unitId"
      :loading="due.isLoading.value"
      :error="due.isError.value ? 'Could not load the roadside repairs.' : null"
      :row-class="() => 'cursor-pointer'"
      @row-click="(row) => openRow(row as RoadsideRepairDueDto)"
      @retry="() => due.refetch()"
    >
      <template #cell-unit="{ row }">{{ repairUnitName(row as RoadsideRepairDueDto) }}</template>
      <template #cell-inspected="{ row }">
        {{ formatDate((row as RoadsideRepairDueDto).inspection.inspectionDate) }}
        <span v-if="(row as RoadsideRepairDueDto).inspection.reportState" class="text-ink-muted"> · {{ (row as RoadsideRepairDueDto).inspection.reportState }}</span>
      </template>
      <template #cell-due="{ row }">
        <span :class="dueText(row as RoadsideRepairDueDto).tone" data-test="roadside-repair-due">{{ dueText(row as RoadsideRepairDueDto).text }}</span>
      </template>
      <template #empty>
        <p>No roadside repair waits on the shop. Each one of the last year has its repair recorded.</p>
      </template>
    </DataTable>
  </section>
</template>
