<script setup lang="ts">
/**
 * Dispatch → Loads — McLeod's loads, read-only but for Dispatch (LOADS-MIRROR-PLAN.md LR6, LR7).
 *
 * LR6 took out the approval chain (New load, Approval readiness, bulk Approve / Send to driver, the
 * Needs approval default tab). LR7 rebuilt what was left on the owner's 2026-09-23 column list, each
 * column read from core (`loads` / `load_stops`), never from the raw McLeod tables:
 *
 *   Load # (dispatcher beneath) · Status · Driver (truck / trailer beneath) · Pickup ·
 *   Delivery (+ extra stops) · Type · Dispatch
 *
 * The order is not the list's. Walked at 1440 px, ten separate columns needed ~92 rem against the
 * ~69 the table gets beside the sidebar, and Status — the one column a dispatcher reads first — was
 * the one scrolled out of view. So Status comes second; "Truck / Trailer / Driver" is one cell, as
 * the owner's list wrote it; the extra-stops count rides under Delivery ("+1 more stop"); and the
 * dispatcher sits under the load number, with the Dispatcher filter beside it. Measured after the
 * first pass the row menu still ended 42 px past a 1440 px screen, and the menu is where Dispatch is.
 *
 * ⚠ Two columns on that list are NOT here, on purpose. **PU #** needs SELECT on McLeod's
 * `reference_number` (Q-LMR5, granted on the analytics copy first) and `loads.pickup_number` is null
 * on every row until then — a column of dashes is not a column. **BOL on hover** needs `blnum` in
 * core, and today it lives only in raw `mcleod_dispatch_movements`; reading it from here would be
 * exactly the raw access D-SEP1 forbids. Both are recorded in the plan's §8 entry for LR7.
 *
 * Status words come from `loadBoardState` (`@silvicom/shared`), McLeod's own code in the tooltip.
 * Every time is on the CARRIER's clock (`useOrgTimezone`), never the viewer's.
 */
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  type DispatchException,
  EXCEPTION_LABELS,
  HAZMAT_LOAD_STATUS_LABELS,
  type HazmatLoadStatus,
  boardStops,
  isDispatchable,
  loadBoardState,
  loadTypeOf,
} from "@silvicom/shared";
import { AppTabs } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import KebabMenu from "@/components/KebabMenu.vue";
import TablePagination from "@/components/TablePagination.vue";
import FilterBar, { type FilterChip } from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import {
  QUEUE_TABS,
  inQueue,
  useExceptionsQuery,
  useResolveException,
  useLoadsQuery,
  type DispatchLoad,
  type DispatchStop,
  type QueueTab,
} from "@/features/dispatch/useDispatchLoads";
import DispatchLoadDrawer from "@/features/dispatch/DispatchLoadDrawer.vue";
import { dispatchHeadline } from "@/features/dispatch/useLoadDispatch";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 20;

const session = useSessionStore();
const toast = useToastStore();
const router = useRouter();
const { zone } = useOrgTimezone();

const { data: loads, isLoading, isError, error, refetch, isFetching } = useLoadsQuery();
const { data: exceptions, isLoading: exceptionsLoading, isError: exceptionsFailed, refetch: refetchExceptions, isFetching: exceptionsFetching } = useExceptionsQuery();
const resolveException = useResolveException();

const EXCEPTION_COLUMNS: DataTableColumn[] = [
  { key: "kind", label: "What happened", width: "lg" },
  { key: "summary", label: "Detail", width: "3xl" },
  { key: "driver_name", label: "Driver", width: "lg" },
  { key: "occurred_at", label: "When", width: "lg" },
];

const ACTION_LABELS: Record<string, string> = {
  review_diff: "Review & clear",
  adopt_equipment: "Adopt equipment",
  acknowledge: "Acknowledge",
  reassign: "Reassign",
};

async function clearException(row: DispatchException) {
  if (!session.can("dispatch") || !row.load_id) return;
  try {
    await resolveException.mutateAsync({
      loadId: row.load_id,
      body: { event_id: row.id.includes(":") ? null : row.id, kind: row.kind, action: row.action },
    });
    toast.success("Exception cleared");
  } catch (e) {
    toast.error("Could not clear that exception", e instanceof Error ? e.message : undefined);
  }
}

const dispatching = ref<DispatchLoad | null>(null); // LR-D3: the load whose Dispatch drawer is open

const search = ref("");
const tab = ref<QueueTab>(QUEUE_TABS[0]!.value);
const dispatcherFilter = ref("");
const typeFilter = ref("");
const page = ref(1);
const sort = ref<SortState>({ key: null, dir: "asc" });

/** A time on the carrier's clock. The board is read against McLeod's screen, which is the office's. */
const at = (iso: string | null | undefined): string => formatDateTime(iso, "—", zone.value);

/**
 * "McLeod as of" (plan §5, "Beyond this plan"): until the connector runs on a timer the mirror is only
 * as fresh as its last sync, and the page must say so rather than imply "live". The newest
 * `external_synced_at` the feed wrote is that moment — derived from the rows, not stored beside them.
 */
const syncedAt = computed(() => {
  let newest: string | null = null;
  for (const l of loads.value ?? []) if (l.external_synced_at && (!newest || l.external_synced_at > newest)) newest = l.external_synced_at;
  return newest;
});
const headerText = computed(() =>
  syncedAt.value
    ? `Loads from McLeod as of ${at(syncedAt.value)}. A load reaches a driver only when you dispatch it.`
    : "Loads come from McLeod. A load reaches a driver only when you dispatch it.",
);

const dispatcherOptions = computed(() => {
  const names = [...new Set((loads.value ?? []).map((l) => l.dispatcher_name).filter((n): n is string => Boolean(n)))].sort();
  return [{ value: "", label: "All dispatchers" }, ...names.map((n) => ({ value: n, label: n }))];
});
const typeOptions = [
  { value: "", label: "All types" },
  { value: "Regular", label: "Regular" },
  { value: "Reefer", label: "Reefer" },
  { value: "hazmat", label: "Hazmat" },
  { value: "attention", label: "Hazmat — not cleared" },
];
/** H-C1: a hazmat load "needs attention" until its record is CLEARED — including never started. */
const hazmatNeedsAttention = (load: DispatchLoad): boolean =>
  load.hazmat && load.hazmat_status !== "cleared" && load.hazmat_status !== "cancelled" && load.hazmat_status !== "superseded";

function matchesType(load: DispatchLoad): boolean {
  const t = loadTypeOf(load);
  if (!typeFilter.value) return true;
  if (typeFilter.value === "hazmat") return t.hazmat;
  if (typeFilter.value === "attention") return hazmatNeedsAttention(load);
  return t.base === typeFilter.value;
}

const counts = computed(() => {
  const result = Object.fromEntries(QUEUE_TABS.map((q) => [q.value, 0])) as Record<QueueTab, number>;
  for (const load of loads.value ?? []) {
    for (const q of QUEUE_TABS) if (q.value !== "exceptions" && inQueue(load, q.value)) result[q.value] += 1;
  }
  // The exceptions count comes from the server feed, not from the loads list — most of its sources
  // exist only as events and are not visible in a load row at all (D-L2).
  result.exceptions = (exceptions.value ?? []).length;
  return result;
});
const tabItems = computed(() => QUEUE_TABS.map((q) => ({ value: q.value, label: q.label, badge: counts.value[q.value] })));

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  const queue = tab.value;
  if (queue === "exceptions") return [];
  return (loads.value ?? [])
    .filter((load) => inQueue(load, queue))
    .filter((load) => !dispatcherFilter.value || load.dispatcher_name === dispatcherFilter.value)
    .filter(matchesType)
    .filter((load) => {
      if (!term) return true;
      const { pickup, delivery } = boardStops(load.stops);
      return [load.ref, load.driver_name, load.vehicle_unit, load.trailer_unit, load.dispatcher_name, load.commodity, placeOf(pickup), placeOf(delivery)]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(term));
    });
});

/** A stop as the board names it: McLeod's real location name first, then city and state. */
function placeOf(stop: DispatchStop | null): string {
  if (!stop) return "";
  return stop.location_name || stop.name || "";
}
function cityOf(stop: DispatchStop | null): string {
  return stop ? [stop.city, stop.state].filter(Boolean).join(", ") : "";
}

function sortValue(load: DispatchLoad, key: string): unknown {
  const { pickup, delivery } = boardStops(load.stops);
  if (key === "pickup") return pickup?.appointment_start ?? null;
  if (key === "delivery") return delivery?.appointment_start ?? null;
  if (key === "status") return loadBoardState(load).label;
  return (load as unknown as Record<string, unknown>)[key];
}

const sorted = computed(() => sortRows(filtered.value, sort.value, sortValue));
const pageRows = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const emptyText = computed(() =>
  (loads.value ?? []).length === 0 ? "No loads yet. They arrive from McLeod on its next sync." : "No loads match these filters.",
);

/** Chip copy + tone for the linked hazmat record's state. "Not started" is the loudest (H-C1). */
function hazmatChipLabel(status: string | null | undefined): string {
  if (!status) return "Hazmat · not started";
  return `Hazmat · ${HAZMAT_LOAD_STATUS_LABELS[status as HazmatLoadStatus] ?? status}`;
}
function hazmatTone(status: string | null | undefined): string {
  if (!status) return "warning";
  if (status === "cleared") return "success";
  if (status === "needs_review") return "warning";
  if (status === "rejected") return "danger";
  if (status === "submitted" || status === "extracting") return "brand";
  return "neutral"; // draft / cancelled / superseded
}

const columns: DataTableColumn[] = [
  { key: "ref", label: "Load #", sortable: true, width: "sm", cellClass: "font-medium text-ink" },
  { key: "status", label: "Status", sortable: true, width: "md" },
  { key: "driver_name", label: "Driver", sortable: true, width: "md" },
  { key: "pickup", label: "Pickup", sortable: true, width: "lg" },
  { key: "delivery", label: "Delivery", sortable: true, width: "lg" },
  { key: "type", label: "Type", width: "sm" },
  // D-LMR7: whether the office sent it is its own fact, beside McLeod's status — never folded into it.
  { key: "dispatch", label: "Dispatch", width: "md" },
];

const filterChips = computed<FilterChip[]>(() => {
  const chips: FilterChip[] = [];
  if (dispatcherFilter.value) chips.push({ key: "dispatcher", label: "Dispatcher", value: dispatcherFilter.value });
  if (typeFilter.value) chips.push({ key: "type", label: "Type", value: typeOptions.find((o) => o.value === typeFilter.value)?.label ?? typeFilter.value });
  return chips;
});

watch([search, tab, dispatcherFilter, typeFilter], () => {
  page.value = 1;
});
watch(filtered, (rows) => {
  const maxPage = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (page.value > maxPage) page.value = maxPage;
});

function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
}
function clearFilters() {
  search.value = "";
  dispatcherFilter.value = "";
  typeFilter.value = "";
}
function removeFilter(key: string) {
  if (key === "dispatcher") dispatcherFilter.value = "";
  if (key === "type") typeFilter.value = "";
}

// Opening ONE load is `DispatchLoadDetailPage` — a real page, because a drawer over this list cache
// could not deep-link and went stale with it (LD2).
function openDetail(load: DispatchLoad) {
  void router.push({ name: "load-detail", params: { id: load.id } });
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader :description="headerText" />

    <!-- The shared strip, scrollable: five queues do not fit a 390 px phone, and the strip scrolling
         inside itself is what keeps the PAGE from scrolling sideways (the LR-D3 walk measured 683 px). -->
    <AppTabs v-model="tab" :tabs="tabItems" label="Load queue" scrollable />

    <FilterBar
      v-if="tab !== 'exceptions'"
      v-model:search="search"
      search-placeholder="Search load #, driver, unit, place…"
      :count="filtered.length"
      count-label="loads"
      :chips="filterChips"
      @remove="removeFilter"
      @clear-all="clearFilters"
    >
      <template #filters>
        <FilterSelect v-model="dispatcherFilter" label="Dispatcher" :options="dispatcherOptions" />
        <FilterSelect v-model="typeFilter" label="Type" :options="typeOptions" />
      </template>
    </FilterBar>

    <!-- Exceptions is its own feed, not a filter over the loads list: most of its sources exist only
         as events and have no row on the board at all (D-L2). -->
    <DataTable
      v-if="tab === 'exceptions'"
      :columns="EXCEPTION_COLUMNS"
      :rows="exceptions ?? []"
      row-key="id"
      :loading="exceptionsLoading"
      :error="exceptionsFailed ? 'Could not load exceptions' : null"
      :retrying="exceptionsFetching"
      empty-text="Nothing needs attention right now."
      @retry="refetchExceptions"
    >
      <template #cell-kind="{ row }">
        <span :class="[BADGE_BASE, toneClass(row.kind === 'declined' ? 'danger' : 'warning')]">
          {{ EXCEPTION_LABELS[row.kind as keyof typeof EXCEPTION_LABELS] }}
        </span>
      </template>
      <template #cell-summary="{ row }">
        <RouterLink
          v-if="row.load_id"
          :to="`/loads/${row.load_id}`"
          class="font-medium text-link hover:text-link-hover"
        >
          {{ row.summary }}
        </RouterLink>
        <span v-else class="text-ink-secondary">{{ row.summary }}</span>
      </template>
      <template #cell-driver_name="{ row }">{{ row.driver_name ?? "—" }}</template>
      <template #cell-occurred_at="{ row }">{{ at(row.occurred_at) }}</template>
      <template #actions="{ row }">
        <BaseButton
          v-if="session.can('dispatch') && row.load_id"
          variant="ghost"
          size="sm"
          :disabled="resolveException.isPending.value"
          @click.stop="clearException(row)"
        >
          {{ ACTION_LABELS[row.action] ?? "Acknowledge" }}
        </BaseButton>
      </template>
    </DataTable>

    <DataTable
      v-else
      :columns="columns"
      :rows="pageRows"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load the dispatch board') : null"
      :retrying="isFetching"
      :sort="sort"
      :empty-text="emptyText"
      @sort="onSort"
      @retry="refetch"
      @row-click="openDetail"
    >
      <template #cell-ref="{ row }">
        <BaseButton type="button" class="font-medium text-link hover:text-link-hover" @click.stop="openDetail(row)">
          {{ row.ref }}
        </BaseButton>
        <p class="mt-1 truncate text-xs text-ink-muted" title="Dispatcher in McLeod">{{ row.dispatcher_name ?? "No dispatcher" }}</p>
      </template>
      <template #cell-driver_name="{ row }">
        <p :class="row.driver_name ? 'text-ink' : 'text-ink-tertiary'">{{ row.driver_name ?? "No driver" }}</p>
        <p class="text-xs tabular-nums text-ink-muted" title="Truck / trailer">{{ row.vehicle_unit ?? "No truck" }} / {{ row.trailer_unit ?? "no trailer" }}</p>
      </template>
      <template v-for="end in ['pickup', 'delivery'] as const" :key="end" #[`cell-${end}`]="{ row }">
        <template v-for="stop in [boardStops(row.stops)[end]]" :key="stop?.seq ?? 'none'">
          <div v-if="stop" class="min-w-0">
            <p class="truncate text-ink" :title="placeOf(stop)">{{ placeOf(stop) || "Unnamed stop" }}</p>
            <p class="truncate text-xs text-ink-muted">{{ cityOf(stop) }}</p>
            <!-- McLeod's actual when it has one; the appointment otherwise. Both on the carrier's clock. -->
            <p v-if="stop.actual_arrival_at" class="text-xs tabular-nums text-ink-secondary">Arrived {{ at(stop.actual_arrival_at) }}</p>
            <p v-else class="text-xs tabular-nums text-ink-muted">{{ stop.appointment_start ? at(stop.appointment_start) : "No appointment" }}</p>
            <p v-if="end === 'delivery' && boardStops(row.stops).extra" class="text-xs text-ink-secondary" :title="`${row.stops.length} stops in all`">
              +{{ boardStops(row.stops).extra }} more {{ boardStops(row.stops).extra === 1 ? "stop" : "stops" }}
            </p>
          </div>
          <span v-else class="text-ink-tertiary">—</span>
        </template>
      </template>
      <template #cell-type="{ row }">
        <div class="flex flex-wrap gap-1">
          <span :class="[BADGE_BASE, toneClass(loadTypeOf(row).base === 'Reefer' ? 'info' : 'neutral')]">{{ loadTypeOf(row).base }}</span>
          <!-- H-C1: the hazmat RECORD's state, not just the flag — "not started" is the loud one. -->
          <span v-if="row.hazmat" :class="[BADGE_BASE, toneClass(hazmatTone(row.hazmat_status))]">{{ hazmatChipLabel(row.hazmat_status) }}</span>
        </div>
      </template>
      <template #cell-status="{ row }">
        <span :class="[BADGE_BASE, toneClass(loadBoardState(row).tone)]" :title="loadBoardState(row).mcleodWords ?? undefined">{{ loadBoardState(row).label }}</span>
      </template>
      <template #cell-dispatch="{ row }">
        <span :class="row.last_dispatch ? 'text-ink-secondary' : 'text-ink-tertiary'">{{ dispatchHeadline(row.last_dispatch) }}</span>
      </template>
      <template #actions="{ row }">
        <KebabMenu>
          <BaseButton v-if="session.can('dispatch') && isDispatchable(row)" class="kebab-item" @click="dispatching = row">Dispatch…</BaseButton>
          <BaseButton class="kebab-item" @click="openDetail(row)">Open details</BaseButton>
        </KebabMenu>
      </template>
      <template #footer>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="filtered.length" :loading="isFetching" @update:page="page = $event" />
      </template>
    </DataTable>

    <DispatchLoadDrawer :load="dispatching" @close="dispatching = null" />
  </div>
</template>
