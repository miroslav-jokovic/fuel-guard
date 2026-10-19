<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  AppButton as BaseButton,
  AppCallout,
  useQueryState,
  SORT_DIRECTIONS,
  useUrlSort,
  DataWorkspace,
  FilterBar,
  DataTable,
  type DataTableColumn,
  TablePagination,
  sortRows,
  AppTabs,
  AppIcon,
} from "@silvicom/ui";
import { ArrowUpTrayIcon } from "@silvicom/ui/icons";
import {
  ROADSIDE_OOS_KINDS,
  ROADSIDE_PERIODS,
  hasOosOf,
  inspectionLevelLabel,
  roadsidePeriodStart,
  todayInZone,
  type RoadsideInspectionDto,
  type RoadsideInspectionWorkDto,
  type RoadsideOosKind,
  type RoadsidePeriod,
} from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { useRoadsideInspectionsQuery, useRoadsideSummaryQuery, useRoadsideWorkQuery } from "@/features/roadside/useRoadsideInspections";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import BulkReportUploadDrawer from "@/features/roadside/BulkReportUploadDrawer.vue";
import { useSessionStore } from "@/stores/session";
import { roadsideFeedSentence } from "@/features/roadside/feedFreshness";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { formatDate } from "@/lib/format";

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
 * belong to IC4–IC6 (cases, attribution, impact). A row opens `RoadsideInspectionPage` — the report's
 * units, violations and court results; its cases and evidence come with IC6. The driver filter waits
 * on attribution (D-IC7), because a guessed driver is the thing that plan forbids.
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
/**
 * "Needs action" first (Q-IC17, owner 2026-10-19): the inspections with a step open on `roadsideNextSteps`,
 * the most urgent first. "All" is the record; the Roadside card's figures link to it (`view=all`), because
 * each is the length of the whole list it opens (D-FM7).
 */
const VIEWS = ["needs", "all"] as const;
const view = qs.param("view", VIEWS, "needs");
const search = qs.param("search");
const period = qs.param("period", ROADSIDE_PERIODS, "all");
const oos = qs.param("oos", ROADSIDE_OOS_KINDS);
const activeFilterCount = computed(() => [search.value.trim(), period.value !== "all", oos.value].filter(Boolean).length);

const { zone } = useOrgTimezone();
const from = computed(() => roadsidePeriodStart(period.value as RoadsidePeriod, todayInZone(new Date(), zone.value)));
const inspections = useRoadsideInspectionsQuery(from);
// How current FMCSA's record is (IC1c) — the card's own read, so the two never disagree about it.
const { data: summary } = useRoadsideSummaryQuery();
const work = useRoadsideWorkQuery(from);
// Filing needs the safety section's manage level, which the API checks; the button only follows it.
const session = useSessionStore();
const canFile = computed(() => session.can("safety"));
const uploading = ref(false);
// The upload's choices: the whole record, read only once the drawer is opened (until then the same key as the
// list, so no second read). "Waiting for its report" is known for the period shown; the rest list after it.
const allFrom = computed(() => (uploading.value ? null : from.value));
const allInspections = useRoadsideInspectionsQuery(allFrom);
const workOf = computed(() => new Map((work.data.value ?? []).map((w) => [w.id, w])));
const freshness = computed(() => (summary.value ? roadsideFeedSentence(summary.value.feed, zone.value) : null));

const unitLabel = (u: NonNullable<RoadsideInspectionDto["units"]>[number]) =>
  u.companyNumber ?? (u.plate ? `${u.plate}${u.plateState ? ` (${u.plateState})` : ""}` : "—");
const oosText = (i: RoadsideInspectionDto) =>
  ROADSIDE_OOS_KINDS.filter((k) => hasOosOf(i, k)).map((k) => OOS_LABEL[k]).join(" · ");

type Row = RoadsideInspectionDto & {
  oosOrders: number;
  work: RoadsideInspectionWorkDto | null;
  /** For sorting: the CSA points today, and how urgent the next step is (overdue first, then soonest due). */
  points: number | null;
  urgency: number;
};
/** Overdue days count down from the most overdue; an undated open step after every dated one; nothing open last. */
const urgencyOf = (w: RoadsideInspectionWorkDto | null) =>
  !w?.next ? Number.MAX_SAFE_INTEGER : !w.next.clock ? Number.MAX_SAFE_INTEGER - 1 : w.next.clock.overdue ? -w.next.clock.days : w.next.clock.days;
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
    .map((i) => {
      const w = workOf.value.get(i.id) ?? null;
      return { ...i, oosOrders: ROADSIDE_OOS_KINDS.filter((k) => hasOosOf(i, k)).length, work: w, points: w?.points ?? null, urgency: urgencyOf(w) };
    });
  const shown = view.value === "needs" ? found.filter((r) => (r.work?.open.total ?? 0) > 0) : found;
  // Needs action reads most urgent first until the reader sorts by a column themselves.
  if (view.value === "needs" && !sort.value.key) return [...shown].sort((a, b) => a.urgency - b.urgency || (b.inspectionDate ?? "").localeCompare(a.inspectionDate ?? ""));
  return sortRows(shown, sort.value);
});

const page = qs.page();
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const COLUMNS: DataTableColumn[] = [
  { key: "inspectionDate", label: "Date", sortable: true, width: "sm" },
  { key: "reportNumber", label: "Report", cellClass: "font-medium text-ink", width: "md" },
  { key: "reportState", label: "State", sortable: true, cellClass: "text-ink-secondary", width: "xs" },
  { key: "level", label: "Level", sortable: true, width: "md" },
  { key: "locationDesc", label: "Location" },
  { key: "units", label: "Units", width: "md" },
  { key: "next", label: "Next step", width: "xl" },
  { key: "driver", label: "Driver", width: "md" },
  { key: "violations", label: "Violations", sortable: true, numeric: true, width: "sm" },
  { key: "points", label: "CSA points", sortable: true, numeric: true, width: "sm" },
  { key: "oosOrders", label: "Out of service", sortable: true, width: "md" },
];
const needsCount = computed(() => (work.data.value ?? []).filter((w) => w.open.total > 0).length);
const tabs = computed(() => [
  { value: "needs", label: "Needs action", badge: work.data.value ? needsCount.value || undefined : undefined },
  { value: "all", label: "All" },
]);
const OWNER = { safety: "Safety", maintenance: "Maintenance" } as const;
const DRIVER_BY = { samsara: "from Samsara", report: "by the report", person: "confirmed" } as const;
/** "Due 10/21/2026 · 2 days left" or "3 days overdue", for the Next step cell. */
function dueLine(w: RoadsideInspectionWorkDto): { text: string; tone: string } | null {
  const c = w.next?.clock;
  if (!c || !w.next?.dueOn) return null;
  if (c.overdue) return { text: `${c.days} ${c.days === 1 ? "day" : "days"} overdue`, tone: "text-danger-700 font-medium" };
  return { text: `Due ${formatDate(w.next.dueOn)} · ${c.days === 0 ? "today" : `${c.days} ${c.days === 1 ? "day" : "days"} left`}`, tone: c.days <= 3 ? "text-warning-700" : "text-ink-muted" };
}
const { sort, onSort } = useUrlSort(
  qs.param("sort", COLUMNS.filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);
watch([view, search, period, oos, () => sort.value.key, () => sort.value.dir], () => (page.value = 1));

const clearAll = () => qs.set({ search: undefined, period: undefined, oos: undefined });

// A real page rather than a drawer, so it can be linked and Back keeps this list's filters (§5.7).
const router = useRouter();
const openInspection = (row: Row) => void router.push({ name: "roadside-inspection", params: { id: row.id } });
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every roadside inspection on our FMCSA record. From FMCSA's public data, refreshed when FMCSA publishes.">
      <template v-if="canFile" #actions>
        <BaseButton variant="primary" data-test="bulk-open" @click="uploading = true">
          <AppIcon :icon="ArrowUpTrayIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Upload officer's reports
        </BaseButton>
      </template>
    </PageHeader>
    <!-- The whole record, not the period shown: a report may be for an inspection outside the filter. -->
    <BulkReportUploadDrawer :open="uploading" :inspections="allInspections.data.value ?? []" :work="workOf" @close="uploading = false" />
    <AppCallout v-if="freshness?.late" tone="caution" data-test="feed">{{ freshness.text }}</AppCallout>
    <p v-else-if="freshness" class="-mt-3 text-xs text-ink-tertiary" data-test="feed">{{ freshness.text }}</p>

    <AppTabs v-model="view" :tabs="tabs" label="Roadside inspections" />

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
        :loading="inspections.isLoading.value || (view === 'needs' && work.isLoading.value)"
        :error="
          inspections.isError.value
            ? 'Could not load the roadside inspections.'
            : view === 'needs' && work.isError.value
              ? 'Could not work out what is left on the roadside inspections.'
              : null
        "
        :sort="sort"
        @sort="onSort"
        :row-class="() => 'cursor-pointer'"
        @retry="() => (inspections.isError.value ? inspections.refetch() : work.refetch())"
        @row-click="openInspection"
      >
        <template #cell-inspectionDate="{ value }">{{ value ? formatDate(value) : "—" }}</template>
        <template #cell-reportNumber="{ row }">
          <BaseButton variant="link" :to="{ name: 'roadside-inspection', params: { id: (row as Row).id } }" class="font-medium" @click.stop>
            {{ (row as Row).reportNumber ?? "Open" }}
          </BaseButton>
        </template>
        <template #cell-reportState="{ value }">{{ value ?? "—" }}</template>
        <template #cell-level="{ value }">{{ inspectionLevelLabel(value as number | null) ?? "—" }}</template>
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
        <template #cell-next="{ row }">
          <template v-if="(row as Row).work?.next">
            <p class="font-medium text-ink" data-test="next-step">
              {{ (row as Row).work!.next!.title }}
              <span :class="['ml-1', BADGE_BASE, toneClass('neutral')]">{{ OWNER[(row as Row).work!.next!.owner] }}</span>
            </p>
            <p v-if="dueLine((row as Row).work!)" :class="['text-xs', dueLine((row as Row).work!)!.tone]">{{ dueLine((row as Row).work!)!.text }}</p>
            <p v-if="(row as Row).work!.open.total > 1" class="text-xs text-ink-muted">and {{ (row as Row).work!.open.total - 1 }} more</p>
          </template>
          <span v-else-if="(row as Row).work" class="text-ink-tertiary" data-test="next-step">Nothing left</span>
          <span v-else class="text-ink-tertiary">—</span>
        </template>
        <template #cell-driver="{ row }">
          <template v-if="(row as Row).work?.driver">
            <span class="text-ink" data-test="driver">{{ (row as Row).work!.driver!.name }}</span>
            <p class="text-xs text-ink-muted">{{ DRIVER_BY[(row as Row).work!.driver!.by] }}</p>
          </template>
          <span v-else class="text-ink-tertiary">—</span>
        </template>
        <template #cell-points="{ row }">
          <span :class="(row as Row).points ? 'font-medium tabular-nums text-ink' : 'text-ink-tertiary'" data-test="points">{{ (row as Row).points ?? "—" }}</span>
        </template>
        <template #cell-violations="{ value }">{{ value ?? "—" }}</template>
        <template #cell-oosOrders="{ row }">
          <span v-if="oosText(row as Row)" class="font-medium text-ink" data-test="oos">{{ oosText(row as Row) }}</span>
          <span v-else class="text-ink-tertiary">None</span>
        </template>
        <template #empty>
          <p v-if="view === 'needs' && !activeFilterCount">Nothing needs action. Every recent inspection's steps are done.</p>
          <p v-else-if="activeFilterCount">No roadside inspection matches that.</p>
          <p v-else>No roadside inspections on our FMCSA record.</p>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
