<script setup lang="ts">
import { computed, watch } from "vue";
import {
  AppButton as BaseButton,
  AppTabs,
  DataTable,
  DataWorkspace,
  FilterBar,
  TablePagination,
  type DataTableColumn,
  useQueryState,
} from "@silvicom/ui";
import { byRepairUrgency, repairClock, repairSettled, repairUnitName, todayInZone, type RepairEngineOutcome, type RoadsideRepairDueDto } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import SlideOver from "@/components/SlideOver.vue";
import RepairUnitDecision from "@/features/roadside/RepairUnitDecision.vue";
import { useRoadsideRepairsDueQuery } from "@/features/roadside/useRoadsideInspections";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useOpens } from "@/composables/useOpens";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * Roadside repairs due — the Shop's side of the 396.9(d) repair record (INSPECTION-CHALLENGE-PLAN IC11 B2b,
 * Q-IC16 (a); standardized IC16, owner 2026-10-19).
 *
 * A technician names the FleetPal work order that repaired an inspection's vehicle violations, but holds
 * maintenance and not safety, so the inspection page (where safety certifies) is closed to them. This page is
 * their door: every violated unit of the last year.
 *
 * ── THE STANDARD LIST, AS EVERY QUEUE IN THE PRODUCT ───────────────────────────────────────────
 * Until IC16 it was a stack of unit cards, each with its work orders spread out. It is now the queue shape of
 * the design contract (§5.1, `AssignmentsPage`): Open and Recorded as tabs, a `DataWorkspace` with search, a
 * paged `DataTable` — open ones nearest to today first (`byRepairUrgency`) — and the decision in a drawer
 * (§5.7) on `RepairUnitDecision`, the inspection page's own component, so there is one way to name a repair.
 *
 * Every state is in the URL (D-US2): the tab, the search, the page, the open unit (`unit=`) and the inspection
 * the `roadside_repair_due` alert names (`inspection=`), which narrows the list to its units and opens the
 * first that is still open.
 *
 * Non-nav, parented on the Shop home: I4 fixes the maintenance group at six rows (`surfaceCatalogue.ts`).
 */

const PAGE_SIZE = 25;

const qs = useQueryState();
const tab = qs.param("tab", ["open", "recorded"], "open");
const search = qs.param("search");
const focus = qs.param("inspection");
const openUnit = qs.param("unit");
const activeFilterCount = computed(() => [search.value.trim(), focus.value].filter(Boolean).length);

const { zone } = useOrgTimezone();
const today = computed(() => todayInZone(new Date(), zone.value));
const due = useRoadsideRepairsDueQuery();

const inFocus = (r: RoadsideRepairDueDto) => !focus.value || r.inspection.id === focus.value;
const open = computed(() => (due.data.value ?? []).filter((r) => !repairSettled(r) && inFocus(r)).sort(byRepairUrgency(today.value)));
const recorded = computed(() =>
  (due.data.value ?? [])
    .filter((r) => repairSettled(r) && inFocus(r))
    .sort((a, b) => (b.decision?.decidedAt ?? b.dueOn).localeCompare(a.decision?.decidedAt ?? a.dueOn)),
);
const rows = computed(() => {
  const term = search.value.trim().toLowerCase();
  const list = tab.value === "recorded" ? recorded.value : open.value;
  if (!term) return list;
  return list.filter((r) =>
    [repairUnitName(r), r.inspection.reportNumber, r.inspection.reportState, r.inspection.locationDesc, ...r.violations.map((v) => v.code)].some((v) =>
      v?.toLowerCase().includes(term),
    ),
  );
});
const tabs = computed(() => [
  { value: "open", label: "Open", badge: due.data.value ? open.value.length || undefined : undefined },
  { value: "recorded", label: "Recorded", badge: due.data.value ? recorded.value.length || undefined : undefined },
]);

const page = qs.page();
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
watch([tab, search, focus], () => (page.value = 1));

const COLUMNS: DataTableColumn[] = [
  { key: "unit", label: "Unit", cellClass: "font-medium text-ink", width: "sm" },
  { key: "inspection", label: "Inspection", width: "lg" },
  { key: "violations", label: "Violations", width: "xl" },
  { key: "proposal", label: "In FleetPal", width: "lg" },
  { key: "due", label: "Due", width: "md" },
];

/** What FleetPal shows for the unit, in a few words — the drawer holds the work orders themselves. */
const PROPOSAL_SHORT: Record<RepairEngineOutcome, string> = {
  repaired_at_scene: "Repaired at the scene",
  one_candidate: "1 work order",
  several_candidates: "Several work orders",
  no_candidate: "No work order yet",
  no_fleetpal_unit: "Unit not in FleetPal",
  unit_not_ours: "Not our unit",
};
const proposalText = (r: RoadsideRepairDueDto) => {
  if (r.decision) return r.decision.workOrder ? `Work order ${r.decision.workOrder.reference ?? r.decision.workOrder.workOrderId}` : "Repaired outside FleetPal";
  const n = r.proposal.candidates.length;
  return r.proposal.outcome === "several_candidates" ? `${n} work orders` : PROPOSAL_SHORT[r.proposal.outcome];
};
/** The clock badge: settled, or days left / overdue on the carrier's calendar. */
function dueBadge(r: RoadsideRepairDueDto): { text: string; tone: string } {
  if (repairSettled(r)) return { text: "Recorded", tone: "success" };
  const c = repairClock(r.dueOn, today.value);
  if (c.overdue) return { text: `${c.days} ${c.days === 1 ? "day" : "days"} overdue`, tone: "danger" };
  return { text: c.days === 0 ? "Due today" : `${c.days} ${c.days === 1 ? "day" : "days"} left`, tone: c.days <= 3 ? "warning" : "neutral" };
}

const opens = useOpens();
const inspectionLink = (r: RoadsideRepairDueDto) => {
  const to = { name: "roadside-inspection", params: { id: r.inspection.id } };
  return opens(to) ? to : null;
};

/** The drawer's unit, from the URL; it follows the record, so a decision made in it shows at once. */
const selected = computed(() => (due.data.value ?? []).find((r) => r.unitId === openUnit.value) ?? null);
const openRow = (r: RoadsideRepairDueDto) => (openUnit.value = r.unitId);
const closeDrawer = () => (openUnit.value = "");

/**
 * Arriving from the bell (`?inspection=`): the tab that holds its units, and the first open one in the drawer.
 * Once only, when the record lands — a later refetch must not reopen what the reader closed.
 */
let arrived = false;
watch(
  () => due.data.value,
  (list) => {
    if (arrived || !list || !focus.value) return;
    arrived = true;
    const mine = list.filter((r) => r.inspection.id === focus.value);
    if (mine.length && mine.every(repairSettled)) tab.value = "recorded";
    const first = mine.find((r) => !repairSettled(r)) ?? mine[0];
    if (first && !openUnit.value) openUnit.value = first.unitId;
  },
  { immediate: true },
);
const clearAll = () => qs.set({ search: undefined, inspection: undefined });
</script>

<template>
  <div class="space-y-6">
    <!-- The fifteen days are 49 CFR 396.9(d). The citation lived in this sentence until 2026-10-27;
         it moved here under the house rule that visible copy carries no § references outside hazmat
         (D-AVI15, applied by MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.4). -->
    <PageHeader
      description="Every truck or trailer with a vehicle violation on a roadside inspection of the last year. Name the FleetPal work order that repaired it, or say where it was repaired — the report must be certified within 15 days of the inspection."
    />

    <AppTabs v-model="tab" :tabs="tabs" label="Roadside repairs" />

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search unit, report, state or violation code…"
        :count="rows.length"
        count-label="roadside repairs"
        :active-count="activeFilterCount"
        @clear-all="clearAll"
      />

      <DataTable
        embedded
        :columns="COLUMNS"
        :rows="pageRows"
        row-key="unitId"
        :nowrap="false"
        :loading="due.isLoading.value"
        :error="due.isError.value ? 'Could not load the roadside repairs.' : null"
        :row-class="() => 'cursor-pointer'"
        @row-click="(row) => openRow(row as RoadsideRepairDueDto)"
        @retry="() => due.refetch()"
      >
        <template #cell-unit="{ row }">
          <BaseButton variant="link" class="font-medium" data-test="repair-row-open" @click.stop="openRow(row as RoadsideRepairDueDto)">
            {{ repairUnitName(row as RoadsideRepairDueDto) }}
          </BaseButton>
        </template>
        <template #cell-inspection="{ row }">
          <p class="text-ink">{{ (row as RoadsideRepairDueDto).inspection.reportNumber ?? "Roadside inspection" }}</p>
          <p class="text-xs text-ink-muted">
            {{ formatDate((row as RoadsideRepairDueDto).inspection.inspectionDate) }}<template v-if="(row as RoadsideRepairDueDto).inspection.reportState"> · {{ (row as RoadsideRepairDueDto).inspection.reportState }}</template>
          </p>
        </template>
        <template #cell-violations="{ row }">
          <span v-if="(row as RoadsideRepairDueDto).violations.length" class="line-clamp-2">
            <span class="font-mono text-xs">{{ (row as RoadsideRepairDueDto).violations[0]!.code }}</span>
            {{ (row as RoadsideRepairDueDto).violations[0]!.description }}
          </span>
          <span v-else class="text-ink-tertiary">—</span>
          <p v-if="(row as RoadsideRepairDueDto).violations.length > 1" class="text-xs text-ink-muted">and {{ (row as RoadsideRepairDueDto).violations.length - 1 }} more</p>
        </template>
        <template #cell-proposal="{ row }">
          <span data-test="repair-proposal-short">{{ proposalText(row as RoadsideRepairDueDto) }}</span>
        </template>
        <template #cell-due="{ row }">
          <span :class="[BADGE_BASE, toneClass(dueBadge(row as RoadsideRepairDueDto).tone), 'whitespace-nowrap']" data-test="repair-due-badge">{{ dueBadge(row as RoadsideRepairDueDto).text }}</span>
          <p class="mt-0.5 text-xs text-ink-muted">{{ formatDate((row as RoadsideRepairDueDto).dueOn) }}</p>
        </template>
        <template #empty>
          <p v-if="activeFilterCount">No roadside repair matches that.</p>
          <p v-else-if="tab === 'open'">Every roadside repair of the last year is recorded.</p>
          <p v-else>No roadside repair has been recorded yet.</p>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>

    <SlideOver
      :open="selected !== null"
      :title="selected ? repairUnitName(selected) : 'Roadside repair'"
      :description="selected ? `${selected.inspection.reportNumber ?? 'Roadside inspection'} · inspected ${formatDate(selected.inspection.inspectionDate)}` : undefined"
      size="lg"
      @close="closeDrawer"
    >
      <RepairUnitDecision v-if="selected" :inspection-id="selected.inspection.id" :repair="selected" :today="today">
        <template #context>
          <p v-if="inspectionLink(selected)" class="mt-1 text-sm" data-test="repair-where">
            <BaseButton variant="link" :to="inspectionLink(selected)!">Open the inspection</BaseButton>
          </p>
        </template>
      </RepairUnitDecision>
    </SlideOver>
  </div>
</template>
