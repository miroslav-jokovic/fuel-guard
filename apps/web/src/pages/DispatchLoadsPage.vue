<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import { PlusIcon } from "@fuelguard/ui/icons";
/**
 * Dispatch → Loads (Phase 3D, D49).
 *
 * The operator side of the approval gate. Before this page existed the only way to create or approve
 * a load was hand-editing a SQL seed script — which meant D45's "a load is not driver-visible until a
 * human approves and releases it" had no human in it.
 *
 * The default tab is **Needs approval**, and Approve stays disabled until every required checklist
 * item passes, with each failure named. That is the difference between a control and a rubber stamp.
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { type DispatchException, EXCEPTION_LABELS, HAZMAT_LOAD_STATUS_LABELS, type HazmatLoadStatus, LOAD_STATUS_LABELS, LOAD_STATUSES } from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useDriversQuery } from "@/composables/useDrivers";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/composables/useTrailers";
import KebabMenu from "@/components/KebabMenu.vue";
import SlideOver from "@/components/SlideOver.vue";
import TablePagination from "@/components/TablePagination.vue";
import FilterBar, { type FilterChip } from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { AppButton as BaseButton } from "@fuelguard/ui";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import {
  QUEUE_TABS,
  availableActions,
  checklistFor,
  statusLabel,
  tabFor,
  useExceptionsQuery,
  useResolveException,
  useBulkTransition,
  useCreateLoad,
  useLoadsQuery,
  type DispatchLoad,
  type QueueTab,
} from "@/features/dispatch/useDispatchLoads";
import DispatchLoadFormPage, { type LoadFormPayload } from "./DispatchLoadFormPage.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";

const PAGE_SIZE = 20;

const session = useSessionStore();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();

const { data: loads, isLoading, isError, error, refetch, isFetching } = useLoadsQuery();
const { data: drivers } = useDriversQuery();
const { data: vehicles } = useVehiclesQuery();
const { data: trailers } = useTrailersQuery();
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
  if (!session.canManage || !row.load_id) return;
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

const createLoad = useCreateLoad();
const bulk = useBulkTransition();

const search = ref("");
const tab = ref<QueueTab>("needs_approval");
const statusFilter = ref("");
const sourceFilter = ref("");
const hazmatFilter = ref("");
const page = ref(1);
const sort = ref<SortState>({ key: null, dir: "asc" });
const selected = ref<Set<string>>(new Set());
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;

const statusOptions = [
  { value: "", label: "All statuses" },
  ...LOAD_STATUSES.map((status) => ({ value: status, label: LOAD_STATUS_LABELS[status] })),
];
const sourceOptions = [
  { value: "", label: "All sources" },
  { value: "manual", label: "Manual" },
  { value: "tms", label: "TMS" },
];
const hazmatOptions = [
  { value: "", label: "All loads" },
  { value: "yes", label: "Hazmat only" },
  { value: "attention", label: "Hazmat — not cleared" },
  { value: "no", label: "Non-hazmat" },
];
/** H-C1: a hazmat load "needs attention" until its record is CLEARED — including never started. */
const hazmatNeedsAttention = (load: DispatchLoad): boolean =>
  load.hazmat && load.hazmat_status !== "cleared" && load.hazmat_status !== "cancelled" && load.hazmat_status !== "superseded";

const counts = computed(() => {
  const result: Record<QueueTab, number> = {
    needs_approval: 0,
    approved: 0,
    dispatched: 0,
    active: 0,
    delivered: 0,
    exceptions: 0,
  };
  for (const load of loads.value ?? []) {
    result[tabFor(load)] += 1;
  }
  // The exceptions count comes from the server feed, not from the loads list — three of its five
  // sources exist only as events and are not visible in a load row at all (D-L2).
  result.exceptions = (exceptions.value ?? []).length;
  return result;
});

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  return (loads.value ?? [])
    .filter((load) => tabFor(load) === tab.value)
    .filter((load) => !statusFilter.value || load.status === statusFilter.value)
    .filter((load) => !sourceFilter.value || load.source === sourceFilter.value)
    .filter((load) =>
      !hazmatFilter.value ||
        (hazmatFilter.value === "yes"
          ? load.hazmat
          : hazmatFilter.value === "attention"
            ? hazmatNeedsAttention(load)
            : !load.hazmat),
    )
    .filter((load) => {
      if (!term) return true;
      return [load.ref, load.driver_name, load.vehicle_unit, load.commodity, load.source, load.provider]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(term));
    });
});

function firstAppointment(load: DispatchLoad): string {
  const first = [...load.stops].sort((a, b) => a.seq - b.seq)[0];
  if (!first?.appointment_start) return "—";
  const date = new Date(first.appointment_start);
  return Number.isNaN(date.getTime())
    ? first.appointment_start
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sortValue(load: DispatchLoad, key: string): unknown {
  if (key === "source") return load.provider ?? load.source;
  if (key === "first_stop") return firstAppointment(load);
  if (key === "readiness") return checklistFor(load).canApprove ? "Ready" : checklistFor(load).blockers.length;
  if (key === "status") return statusLabel(load.status);
  return (load as unknown as Record<string, unknown>)[key];
}

const sorted = computed(() => sortRows(filtered.value, sort.value, sortValue));
const pageRows = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const emptyText = computed(() =>
  (loads.value ?? []).length === 0 ? "No loads yet — create one or wait for a TMS feed." : "No loads match these filters.",
);

/** Chip copy + tone for the linked record's state. "Not started" is the loudest: the load is marked
 *  hazmat and nothing can clear until the record exists. Tones stay within the token set. */
function hazmatChipLabel(status: string | null | undefined): string {
  if (!status) return "Not started";
  return HAZMAT_LOAD_STATUS_LABELS[status as HazmatLoadStatus] ?? status;
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
  { key: "ref", label: "Load #", sortable: true, width: "md", cellClass: "font-medium text-ink" },
  { key: "source", label: "Source", sortable: true, width: "md" },
  { key: "driver_name", label: "Driver", sortable: true, width: "lg", cellClass: "text-ink-secondary" },
  { key: "equipment", label: "Equipment", sortable: true, width: "md", cellClass: "text-ink-secondary" },
  { key: "first_stop", label: "First appointment", width: "lg", cellClass: "text-ink-secondary" },
  { key: "hazmat", label: "Hazmat", width: "md" },
  { key: "readiness", label: "Approval readiness", width: "xl" },
  { key: "status", label: "Status", sortable: true, width: "lg" },
];

const driverList = computed(() => (drivers.value ?? []).map((driver) => ({ id: driver.id, full_name: driver.full_name })));
const vehicleList = computed(() => (vehicles.value ?? []).map((vehicle) => ({ id: vehicle.id, unit_number: vehicle.unit_number })));
const trailerList = computed(() => (trailers.value ?? []).map((trailer) => ({ id: trailer.id, unit_number: trailer.unit_number })));

// The board only creates. Opening, editing and acting on ONE load is `DispatchLoadDetailPage` — a
// real page, because a drawer over this list cache could not deep-link and went stale with it (LD2).
const formOpen = computed(() => route.name === "load-new");
const saving = computed(() => createLoad.isPending.value);

const selectedLoads = computed(() => (loads.value ?? []).filter((load) => selected.value.has(load.id)));
const approvableIds = computed(() => selectedLoads.value.filter((load) => availableActions(load).approve).map((load) => load.id));
const releasableIds = computed(() => selectedLoads.value.filter((load) => availableActions(load).release).map((load) => load.id));

const filterChips = computed<FilterChip[]>(() => {
  const chips: FilterChip[] = [];
  if (statusFilter.value) chips.push({ key: "status", label: "Status", value: LOAD_STATUS_LABELS[statusFilter.value as keyof typeof LOAD_STATUS_LABELS] });
  if (sourceFilter.value) chips.push({ key: "source", label: "Source", value: sourceFilter.value === "tms" ? "TMS" : "Manual" });
  if (hazmatFilter.value)
    chips.push({
      key: "hazmat",
      label: "Load type",
      value: hazmatFilter.value === "yes" ? "Hazmat" : hazmatFilter.value === "attention" ? "Hazmat — not cleared" : "Non-hazmat",
    });
  return chips;
});
const moreCount = computed(() => (hazmatFilter.value ? 1 : 0));

watch([search, tab, statusFilter, sourceFilter, hazmatFilter], () => {
  page.value = 1;
  selected.value = new Set();
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
  statusFilter.value = "";
  sourceFilter.value = "";
  hazmatFilter.value = "";
}
function removeFilter(key: string) {
  if (key === "status") statusFilter.value = "";
  if (key === "source") sourceFilter.value = "";
  if (key === "hazmat") hazmatFilter.value = "";
}

function openNew() {
  if (session.canManage) void router.push({ name: "load-new" });
}
function openDetail(load: DispatchLoad) {
  void router.push({ name: "load-detail", params: { id: load.id } });
}
function closeOverlay() {
  void router.push({ name: "loads" });
}

async function onFormSubmit(payload: LoadFormPayload) {
  try {
    const created = await createLoad.mutateAsync(payload);
    toast.success(`Load ${payload.ref} created as a draft`);
    await router.push({ name: "load-detail", params: { id: created.id } });
  } catch (e) {
    toast.error("Could not save the load", e instanceof Error ? e.message : undefined);
  }
}



async function bulkDo(action: "approve" | "release", ids: string[]) {
  if (!session.canManage || !ids.length) return;
  try {
    const result = await bulk.mutateAsync({ ids, action });
    toast.success(`${result.succeeded} ${action === "approve" ? "approved" : "released"}${result.failed ? `, ${result.failed} could not be updated` : ""}`);
    selected.value = new Set();
  } catch (e) {
    toast.error("Bulk action failed", e instanceof Error ? e.message : undefined);
  }
}

onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 60_000);
});
onUnmounted(() => {
  if (clock) clearInterval(clock);
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Create, review, approve and release loads. Nothing reaches a driver's phone until dispatch has completed the approval gate.">
      <template #actions>
        <BaseButton v-if="session.canManage" variant="primary" @click="openNew">
          <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> New load
        </BaseButton>
      </template>
    </PageHeader>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <nav class="flex gap-1 rounded-surface bg-surface-muted p-1 text-sm" role="tablist" aria-label="Load queue">
        <BaseButton
          v-for="queue in QUEUE_TABS"
          :key="queue.value"
          type="button"
          role="tab"
          class="rounded-control px-3 py-1.5 font-medium transition"
          :class="tab === queue.value ? 'bg-surface text-ink' : 'text-ink-muted hover:text-ink-secondary'"
          :aria-selected="tab === queue.value"
          @click="tab = queue.value"
        >
          {{ queue.label }}
          <span class="ml-0.5 text-ink-tertiary">{{ counts[queue.value] }}</span>
        </BaseButton>
      </nav>
    </div>

    <FilterBar
      v-model:search="search"
      search-placeholder="Search load #, driver, unit, commodity…"
      :count="filtered.length"
      count-label="loads"
      :chips="filterChips"
      :more-count="moreCount"
      @remove="removeFilter"
      @clear-all="clearFilters"
    >
      <template #filters>
        <FilterSelect v-model="statusFilter" label="Status" :options="statusOptions" />
        <FilterSelect v-model="sourceFilter" label="Source" :options="sourceOptions" />
      </template>
      <template #more>
        <FilterSelect v-model="hazmatFilter" label="Load type" :options="hazmatOptions" block />
      </template>
    </FilterBar>

    <div
      v-if="session.canManage && selected.size > 0"
      class="flex flex-wrap items-center gap-2 rounded-surface bg-brand-50 px-4 py-2.5 ring-1 ring-brand-100"
    >
      <span class="text-sm font-medium text-brand-800">{{ selected.size }} selected</span>
      <BaseButton size="sm" :disabled="bulk.isPending.value || approvableIds.length === 0" @click="bulkDo('approve', approvableIds)">
        Approve<span v-if="approvableIds.length"> ({{ approvableIds.length }})</span>
      </BaseButton>
      <BaseButton size="sm" :disabled="bulk.isPending.value || releasableIds.length === 0" @click="bulkDo('release', releasableIds)">
        Send to driver<span v-if="releasableIds.length"> ({{ releasableIds.length }})</span>
      </BaseButton>
      <BaseButton variant="ghost" size="sm" @click="selected = new Set()">Clear</BaseButton>
    </div>

    <!-- Exceptions is its own feed, not a filter over the loads list: three of its five sources exist
         only as events and have no row on the board at all (D-L2). -->
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
      <template #cell-occurred_at="{ row }">{{ new Date(row.occurred_at).toLocaleString() }}</template>
      <template #actions="{ row }">
        <BaseButton
          v-if="session.canManage && row.load_id"
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
      :selectable="session.canManage"
      :selected="selected"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load the dispatch board') : null"
      :retrying="isFetching"
      :sort="sort"
      :empty-text="emptyText"
      @sort="onSort"
      @retry="refetch"
      @update:selected="selected = $event"
      @row-click="openDetail"
    >
      <template #cell-ref="{ row }">
        <BaseButton type="button" class="font-medium text-link hover:text-link-hover" @click.stop="openDetail(row)">
          {{ row.ref }}
        </BaseButton>
      </template>
      <template #cell-source="{ row }">
        <span :class="[BADGE_BASE, toneClass(row.source === 'tms' ? 'info' : 'neutral')]"><span class="capitalize">{{ row.provider ?? row.source }}</span></span>
      </template>
      <template #cell-driver_name="{ row }">
        <span :class="row.driver_name ? 'text-ink-secondary' : 'text-ink-tertiary'">{{ row.driver_name ?? "Unassigned" }}</span>
      </template>
      <template #cell-equipment="{ row }">{{ row.equipment ?? "—" }}</template>
      <template #cell-first_stop="{ row }"><span class="tabular-nums">{{ firstAppointment(row) }}</span></template>
      <!-- H-C1: the record's STATE, not just a boolean — and the cell is the entry point (row click opens
           the load, where the hazmat section lives). Non-hazmat loads show nothing: absence is the signal. -->
      <template #cell-hazmat="{ row }">
        <span v-if="row.hazmat" :class="[BADGE_BASE, toneClass(hazmatTone(row.hazmat_status))]">
          {{ hazmatChipLabel(row.hazmat_status) }}
        </span>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <!-- The checklist IS the product: a named list of what is missing, not a dead button. -->
      <template #cell-readiness="{ row }">
        <div v-if="checklistFor(row).canApprove" class="flex items-center gap-1.5">
          <span :class="[BADGE_BASE, toneClass('success')]">Ready</span>
          <span v-if="checklistFor(row).warnings.length" class="text-xs text-ink-muted">{{ checklistFor(row).warnings.length }} warning(s)</span>
        </div>
        <ul v-else class="space-y-0.5">
          <li v-for="blocker in checklistFor(row).blockers.slice(0, 2)" :key="blocker.id" class="text-xs text-danger-600">
            {{ blocker.detail ?? blocker.label }}
          </li>
          <li v-if="checklistFor(row).blockers.length > 2" class="text-xs text-ink-muted">+{{ checklistFor(row).blockers.length - 2 }} more</li>
        </ul>
      </template>
      <template #cell-status="{ row }">
        <span :class="[BADGE_BASE, toneClass(row.status === 'canceled' ? 'neutral' : 'brand')]">{{ statusLabel(row.status) }}</span>
      </template>
      <template #actions="{ row }">
        <KebabMenu>
          <BaseButton class="kebab-item" @click.stop="openDetail(row)">Open details</BaseButton>
        </KebabMenu>
      </template>
      <template #footer>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="filtered.length" :loading="isFetching" @update:page="page = $event" />
      </template>
    </DataTable>

    <SlideOver :open="formOpen" title="New load" @close="closeOverlay">
      <DispatchLoadFormPage
        v-if="formOpen"
        :load="null"
        :drivers="driverList"
        :vehicles="vehicleList"
        :trailers="trailerList"
        :saving="saving"
        @submit="onFormSubmit"
        @cancel="closeOverlay"
      />
    </SlideOver>

  </div>
</template>
