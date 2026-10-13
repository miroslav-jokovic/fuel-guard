<script setup lang="ts">
import { computed, watch } from "vue";
import { useQueryState } from "@/composables/useQueryState";
import { SORT_DIRECTIONS, useUrlSort } from "@/composables/useUrlSort";
import {
  ROADSIDE_OOS_KINDS,
  ROADSIDE_PERIODS,
  hasOosOf,
  roadsidePeriodStart,
  todayInZone,
  type RoadsideInspectionDto,
  type RoadsideOosKind,
  type RoadsidePeriod,
} from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { useRoadsideInspectionsQuery } from "@/features/roadside/useRoadsideInspections";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { formatDate } from "@/lib/format";
import { sortRows } from "@/lib/sort";

/**
 * Roadside inspections — every inspection FMCSA records against our USDOT number, newest first
 * (INSPECTION-CHALLENGE-PLAN §6, the Inspections inbox's first slice; FLEET-MANAGER-HOME-PLAN Q-FM7 (a)).
 *
 * ── IT IS THE LIST BEHIND THE ROADSIDE CARD, SO ITS FILTERS ARE THE CARD'S ─────────────────────
 * The Operations tab's card says "Vehicle out of service 18" and links to `?period=90d&oos=vehicle`;
 * D-FM9 holds that the page then shows exactly those 18. The window is `roadsidePeriodStart` on the
 * org's calendar — the function the server cut the card's window with — and the OOS filter is
 * `hasOosOf`, the predicate the server counted with. Neither is restated here.
 *
 * ── WHAT IS NOT HERE YET ───────────────────────────────────────────────────────────────────────
 * The inbox's "has candidate" and "needs task" filters, the driver column and the SMS weight columns
 * belong to IC4–IC6 (cases, attribution, impact). No row opens: the inspection page is IC6's. The
 * driver filter waits on attribution (D-IC7), because a guessed driver is the thing that plan forbids.
 *
 * ── UNITS ARE SHOWN AS THE OFFICER WROTE THEM ──────────────────────────────────────────────────
 * A unit the projection could not tie to exactly one truck or trailer of ours says so, rather than
 * dropping out or borrowing a near match (D-IC7; about 229 of them, Q-IC8).
 */

const PAGE_SIZE = 25;

const PERIOD_LABEL: Record<RoadsidePeriod, string> = { "90d": "Last 90 days", "365d": "Last 365 days", all: "All (3 years)" };
const OOS_LABEL: Record<RoadsideOosKind, string> = { driver: "Driver", vehicle: "Vehicle", hazmat: "Hazmat" };
const periodOptions = ROADSIDE_PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }));
const oosOptions = ROADSIDE_OOS_KINDS.map((k) => ({ value: k, label: OOS_LABEL[k] }));

const qs = useQueryState();
const search = qs.param("search");
const period = qs.param("period", ROADSIDE_PERIODS, "all");
const oos = qs.param("oos", ROADSIDE_OOS_KINDS);
const activeFilterCount = computed(() => [search.value.trim(), period.value !== "all", oos.value].filter(Boolean).length);

const { zone } = useOrgTimezone();
const from = computed(() => roadsidePeriodStart(period.value as RoadsidePeriod, todayInZone(new Date(), zone.value)));
const inspections = useRoadsideInspectionsQuery(from);

const unitLabel = (u: NonNullable<RoadsideInspectionDto["units"]>[number]) =>
  u.companyNumber ?? (u.plate ? `${u.plate}${u.plateState ? ` (${u.plateState})` : ""}` : "—");
const oosText = (i: RoadsideInspectionDto) =>
  ROADSIDE_OOS_KINDS.filter((k) => hasOosOf(i, k)).map((k) => OOS_LABEL[k]).join(" · ");

type Row = RoadsideInspectionDto & { oosOrders: number };
const rows = computed<Row[]>(() => {
  const term = search.value.trim().toLowerCase();
  const kind = oos.value as RoadsideOosKind | "";
  const found = (inspections.data.value ?? [])
    .filter((i) => !kind || hasOosOf(i, kind))
    .filter(
      (i) =>
        !term ||
        [i.reportNumber, i.reportState, i.locationDesc, ...(i.units ?? []).flatMap((u) => [u.companyNumber, u.plate])].some((v) =>
          v?.toLowerCase().includes(term),
        ),
    )
    // How many kinds carry an order, for sorting only: the kinds overlap, so this is not a count of orders.
    .map((i) => ({ ...i, oosOrders: ROADSIDE_OOS_KINDS.filter((k) => hasOosOf(i, k)).length }));
  return sortRows(found, sort.value);
});

const page = qs.page();
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const COLUMNS: DataTableColumn[] = [
  { key: "inspectionDate", label: "Date", sortable: true, width: "sm" },
  { key: "reportNumber", label: "Report", cellClass: "font-medium text-ink", width: "md" },
  { key: "reportState", label: "State", sortable: true, cellClass: "text-ink-secondary", width: "xs" },
  { key: "level", label: "Level", sortable: true, numeric: true, width: "xs" },
  { key: "locationDesc", label: "Location" },
  { key: "units", label: "Units", width: "md" },
  { key: "violations", label: "Violations", sortable: true, numeric: true, width: "sm" },
  { key: "oosOrders", label: "Out of service", sortable: true, width: "md" },
];
const { sort, onSort } = useUrlSort(
  qs.param("sort", COLUMNS.filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);
watch([search, period, oos, () => sort.value.key, () => sort.value.dir], () => (page.value = 1));

const clearAll = () => qs.set({ search: undefined, period: undefined, oos: undefined });
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every roadside inspection on our FMCSA record, newest first. From FMCSA's public data, refreshed daily." />

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search report, state, location or unit…"
        :count="rows.length"
        count-label="roadside inspections"
        :active-count="activeFilterCount"
        @clear-all="clearAll"
      >
        <template #filters>
          <FilterSelect v-model="period" label="Period" :options="periodOptions" />
          <FilterSelect v-model="oos" label="Out of service" :options="oosOptions" />
        </template>
      </FilterBar>

      <DataTable
        embedded
        :columns="COLUMNS"
        :rows="pageRows"
        row-key="id"
        :loading="inspections.isLoading.value"
        :error="inspections.isError.value ? 'Could not load the roadside inspections' : null"
        :sort="sort"
        @sort="onSort"
        @retry="() => inspections.refetch()"
      >
        <template #cell-inspectionDate="{ value }">{{ value ? formatDate(value) : "—" }}</template>
        <template #cell-reportNumber="{ value }">{{ value ?? "—" }}</template>
        <template #cell-reportState="{ value }">{{ value ?? "—" }}</template>
        <template #cell-level="{ value }">{{ value ?? "—" }}</template>
        <template #cell-locationDesc="{ value }">
          <span v-if="value" class="line-clamp-2">{{ value }}</span>
          <span v-else class="text-ink-tertiary">—</span>
        </template>
        <template #cell-units="{ row }">
          <span v-if="!(row as Row).units?.length" class="text-ink-tertiary">—</span>
          <span v-for="(u, n) in (row as Row).units" v-else :key="n" class="mr-2 inline-block whitespace-nowrap" data-test="unit">
            {{ unitLabel(u) }}<span v-if="!u.matched" class="text-ink-tertiary"> · not matched</span>
          </span>
        </template>
        <template #cell-violations="{ value }">{{ value ?? "—" }}</template>
        <template #cell-oosOrders="{ row }">
          <span v-if="oosText(row as Row)" class="font-medium text-ink" data-test="oos">{{ oosText(row as Row) }}</span>
          <span v-else class="text-ink-tertiary">None</span>
        </template>
        <template #empty>
          <p v-if="activeFilterCount">No roadside inspection matches that.</p>
          <p v-else>No roadside inspections on our FMCSA record.</p>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
