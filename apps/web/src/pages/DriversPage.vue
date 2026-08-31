<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import { PlusIcon } from "@silvicom/ui/icons";
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { Driver, DriverInput } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { useDriversQuery, useCreateDriver, useUpdateDriver, useArchiveDriver } from "@/composables/useDrivers";
import SlideOver from "@/components/SlideOver.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import ArchiveDriverModal from "@/components/ArchiveDriverModal.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppSelect } from "@silvicom/ui";
import DriverForm from "@/features/roster/DriverForm.vue";
import { useToastStore } from "@/stores/toast";
import { sortRows } from "@/lib/sort";
import { useDriverReconcile } from "@/features/roster/useDriverReconcile";
import DriverAccessModal from "@/features/roster/DriverAccessModal.vue";
import DriverRosterTable from "@/features/roster/DriverRosterTable.vue";
import { DRIVER_ROSTER_COLUMNS } from "@/features/roster/driverRosterColumns";
import ColumnPicker from "@/components/ui/ColumnPicker.vue";
import SavedViewMenu from "@/components/ui/SavedViewMenu.vue";
import DocumentsModal from "@/components/DocumentsModal.vue";
import { useDocumentsQuery } from "@/composables/useCompliance";
import { useSavedViews } from "@/composables/useSavedViews";
import { useTableColumns } from "@/composables/useTableColumns";
import {
  SAVED_VIEW_TABLES,
  builtInViewsFor,
  matchesDqFilters,
  dqStateFilterOptions,
  dqDueFilterOptions,
} from "@silvicom/shared";
import { useComplianceOverviewQuery } from "@/composables/useCompliance";
import {
  useRosterFilters,
  ROSTER_PAGE_SIZE,
  VIEW_OPTIONS,
} from "@/features/roster/useRosterFilters";

const session = useSessionStore();
const { data: drivers, isLoading, isError, error, refetch, isFetching } = useDriversQuery();
const createDriver = useCreateDriver();
const updateDriver = useUpdateDriver();

const toast = useToastStore();
const drawerOpen = ref(false);
const editing = ref<Driver | null>(null);

// ── Company-issued app logins (DRIVER-CREDENTIALS-PLAN.md): status badge + lifecycle modal ────────
const accessDriver = ref<Driver | null>(null);
const accessOpen = ref(false);
function openAccess(d: Driver) {
  accessDriver.value = d;
  accessOpen.value = true;
}
// Keep the modal's driver fresh after mutations (the query refetches; the ref would go stale).
watch(drivers, (list) => {
  if (accessDriver.value) accessDriver.value = list?.find((d) => d.id === accessDriver.value!.id) ?? accessDriver.value;
});
const saving = computed(() => createDriver.isPending.value || updateDriver.isPending.value);

// ── Reconcile duplicate / name-only drivers with Samsara ──────────────────────────────────────────
const reconcile = useDriverReconcile();
const reconcileOpen = ref(false);
const linkTarget = ref<Record<string, string>>({}); // sourceId -> chosen canonical driver id
async function openReconcile() {
  reconcileOpen.value = true;
  linkTarget.value = {};
  await reconcile.preview();
}
// Samsara drivers to pick from when manually linking (those already carrying a Samsara id).
const samsaraCandidates = computed(() =>
  (drivers.value ?? [])
    .filter((d) => d.samsara_driver_id)
    .sort((a, b) => a.full_name.localeCompare(b.full_name)),
);
// Unmatched drivers the auto-plan did NOT cover (need a manual link).
const stillUnmatched = computed(() => {
  const autoIds = new Set((reconcile.report.value?.pairs ?? []).map((p) => p.sourceId));
  return (drivers.value ?? []).filter((d) => !d.samsara_driver_id && !autoIds.has(d.id));
});
async function applyReconcile() {
  const n = await reconcile.apply();
  if (reconcile.error.value) toast.error("Reconcile failed", reconcile.error.value);
  else toast.success(`Merged ${n} duplicate driver${n === 1 ? "" : "s"}`);
}
async function linkDriver(sourceId: string) {
  const canonicalId = linkTarget.value[sourceId];
  if (!canonicalId) return;
  const ok = await reconcile.linkOne(sourceId, canonicalId);
  if (ok) {
    toast.success("Driver linked & merged");
    await reconcile.preview();
  } else toast.error("Link failed", reconcile.error.value ?? undefined);
}

/**
 * The id this table is known by, in the one place it is spelled (`SAVED_VIEW_TABLES`).
 *
 * Both readers below take it from here: the column picker stores a preference under it, and a saved
 * view is a row keyed on it. Spelled twice, they would agree until somebody renamed one — and the
 * symptom would be a reader's saved views quietly emptying rather than an error.
 *
 * It is the TABLE's id, not the route's: the roster is one table wherever it is shown, and a
 * preference keyed on a URL would reset the day the page moves.
 */
const ROSTER_TABLE = SAVED_VIEW_TABLES[0];
const ROSTER_BUILT_IN_VIEWS = builtInViewsFor(ROSTER_TABLE);
const DQ_STATE_OPTIONS = dqStateFilterOptions();
const DQ_DUE_OPTIONS = dqDueFilterOptions();

/** Which columns this reader keeps (R3b). */
const rosterColumns = useTableColumns(ROSTER_TABLE, () => DRIVER_ROSTER_COLUMNS);

/**
 * Search, status, the archived toggle, sort and page — all in the URL (R3c), so this view can be
 * sent to somebody and named as a saved view.
 *
 * ⚠ Archived drivers leave THIS list and nothing else (migration 0235). The filter is here rather
 * than in `useDriversQuery`, and that is the decision. Five other surfaces read that same query as a
 * name lookup — anomaly detail, assignment history, hazmat load detail, dashboard readiness,
 * driver-app settings — and an archived driver whose name stopped resolving would turn a historical
 * anomaly into one attributed to nobody. Archiving hides a row from the list somebody scans; it does
 * not erase the person from records they appear in.
 */
const {
  search, status: statusFilter, dqState, dqDue, dqRequirement,
  view, showArchived, sort, onSort, page, active, reset,
} = useRosterFilters();

/**
 * Saved views (R3c-2). A view is a name and this page's query string, so applying one is a
 * NAVIGATION and the URL afterwards IS the view — the same URL a colleague would receive as a link.
 * There is no second code path that "applies" a view, which is what stops the two drifting apart.
 */
const savedViews = useSavedViews(ROSTER_TABLE);
const route = useRoute();
const router = useRouter();

/** What Save would store: everything in the URL, which is exactly what a link carries. */
const currentQuery = computed(() => new URLSearchParams(route.query as Record<string, string>).toString());
/** The name of the saved view this page is currently showing, when it is showing one. */
const activeViewName = computed(
  () =>
    ROSTER_BUILT_IN_VIEWS.find((v) => v.query === currentQuery.value)?.name ??
    savedViews.views.value.find((v) => v.query === currentQuery.value)?.name ??
    null,
);

function applyView(query: string) {
  void router.replace({ path: route.path, query: Object.fromEntries(new URLSearchParams(query)) });
}
async function saveView(name: string) {
  try {
    await savedViews.save(name, currentQuery.value);
    toast.success("View saved", `“${name}” now opens this roster.`);
  } catch (e) {
    toast.error("Could not save the view", e instanceof Error ? e.message : undefined);
  }
}
async function removeView(name: string) {
  try {
    await savedViews.remove(name);
    toast.success("View deleted");
  } catch (e) {
    toast.error("Could not delete the view", e instanceof Error ? e.message : undefined);
  }
}

/**
 * The §391.51 folder (R5, D-ROS8). ONE modal owned by the page, never one per row — and the
 * documents themselves are fetched only when a folder is opened, so the roster's own load is
 * unchanged whatever the fleet size.
 */
const documentsDriver = ref<Driver | null>(null);
const documentsSubject = ref("driver");
const documentsDriverId = computed(() => documentsDriver.value?.id ?? null);
const documentsQ = useDocumentsQuery(documentsSubject, documentsDriverId);

const archiving = ref<Driver | null>(null);
const archiveDriver = useArchiveDriver();

async function setArchived(driver: Driver, archived: boolean) {
  try {
    await archiveDriver.mutateAsync({ id: driver.id, archived });
    toast.success(
      archived ? "Archived" : "Back on the roster",
      archived
        ? `${driver.full_name} is off the roster. Their qualification file is unchanged.`
        : `${driver.full_name} is on the roster again.`,
    );
  } catch (e) {
    toast.error(
      archived ? "Could not archive" : "Could not restore",
      e instanceof Error ? e.message : undefined,
    );
  } finally {
    archiving.value = null;
  }
}
const statusOptions = computed(() => [
  { value: "", label: "All statuses" },
  ...[...new Set((drivers.value ?? []).map((d) => d.status))].map((s) => ({ value: s, label: s })),
]);

/**
 * The qualification rollup, indexed for the filters (R4b).
 *
 * The roster table asks for this same query for its expiry columns; vue-query dedupes on the key, so
 * this is one request, not two — and filtering by "has expired items" and reading the CDL date
 * beside it therefore cannot disagree, because they are the same rows.
 */
const overviewQ = useComplianceOverviewQuery();
const overviewRows = computed(
  () => new Map((overviewQ.data.value?.drivers ?? []).map((d) => [d.driver_id, d])),
);

const filtered = computed(() => {
  const term = search.value.toLowerCase();
  const dq = { state: dqState.value, due: dqDue.value, req: dqRequirement.value };
  const filteringDq = Boolean(dqState.value || dqDue.value || dqRequirement.value);
  return (drivers.value ?? []).filter((d) => {
    if (Boolean(d.archived_at) !== showArchived.value) return false;
    if (statusFilter.value && d.status !== statusFilter.value) return false;
    if (filteringDq) {
      const row = overviewRows.value.get(d.id);
      // A driver the rollup does not return (an EFS stub, a terminated file) has no §391.51 picture
      // to match against — so a qualification filter excludes them rather than admitting them
      // silently as "nothing wrong".
      if (!row || !matchesDqFilters(row, dq)) return false;
    }
    if (!term) return true;
    return [d.full_name, d.employee_id, d.phone, d.samsara_username]
      .filter(Boolean)
      .some((f) => f!.toLowerCase().includes(term));
  });
});

const sorted = computed(() => sortRows(filtered.value, sort.value));

const pageRows = computed(() =>
  sorted.value.slice((page.value - 1) * ROSTER_PAGE_SIZE, page.value * ROSTER_PAGE_SIZE),
);

function openNew() {
  editing.value = null;
  drawerOpen.value = true;
}
function openEdit(d: Driver) {
  editing.value = d;
  drawerOpen.value = true;
}

async function onSubmit(input: DriverInput) {
  try {
    if (editing.value) await updateDriver.mutateAsync({ id: editing.value.id, input });
    else await createDriver.mutateAsync(input);
    drawerOpen.value = false;
    toast.success(editing.value ? "Driver updated" : "Driver created");
  } catch (e) {
    toast.error("Could not save driver", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      description="Drivers in your fleet. Assign drivers to vehicles from the Vehicles page."
    >
      <template #actions>
        <template v-if="session.can('roster')">
          <BaseButton
            title="Fold duplicate / name-only drivers into their Samsara record"
            @click="openReconcile"
          >
            Reconcile with Samsara
          </BaseButton>
          <BaseButton variant="primary" @click="openNew">
            <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> New driver
          </BaseButton>
        </template>
      </template>
    </PageHeader>

    <DataWorkspace>
    <FilterBar
      v-model:search="search"
      embedded
      search-placeholder="Search name, driver ID, employee ID, phone…"
      :count="filtered.length"
      count-label="drivers"
    >
      <template #filters>
        <FilterSelect v-model="statusFilter" label="Status" :options="statusOptions" />
        <FilterSelect v-model="view" label="Show" :options="VIEW_OPTIONS" />
        <!-- The same two filters the compliance fleet table carries, same words, same predicate. -->
        <FilterSelect v-model="dqState" label="File status" :options="DQ_STATE_OPTIONS" />
        <FilterSelect v-model="dqDue" label="Due" :options="DQ_DUE_OPTIONS" />
      </template>
      <template #actions>
        <!-- The roster can now be arrived at narrowed, from a link or a saved view, so it needs a
             way back that does not require knowing which controls were set (OdometerPage's shape). -->
        <BaseButton v-if="active" variant="ghost" size="sm" @click="reset">Clear filters</BaseButton>
        <SavedViewMenu
          :built-ins="ROSTER_BUILT_IN_VIEWS"
          :views="savedViews.views.value"
          :current-query="currentQuery"
          :active-name="activeViewName"
          :busy="savedViews.saving.value"
          @apply="applyView"
          @save="saveView"
          @remove="removeView"
        />
        <ColumnPicker :columns="rosterColumns" />
      </template>
    </FilterBar>

    <DriverRosterTable
      :rows="pageRows"
      :columns="rosterColumns.visible.value"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load drivers') : null"
      :retrying="isFetching"
      :sort="sort"
      :empty-text="
        (drivers ?? []).length === 0 ? 'No drivers yet.' : 'No drivers match these filters.'
      "
      :page="page"
      :page-size="ROSTER_PAGE_SIZE"
      :total="filtered.length"
      @sort="onSort"
      @retry="refetch"
      @update:page="page = $event"
      @edit="openEdit"
      @manage-access="openAccess"
      @documents="documentsDriver = $event"
      @archive="archiving = $event"
      @restore="setArchived($event, false)"
    />
    </DataWorkspace>

    <SlideOver
      :open="reconcileOpen"
      title="Reconcile drivers with Samsara"
      @close="reconcileOpen = false"
    >
      <div v-if="reconcile.loading.value" class="text-sm text-ink-muted">Analyzing…</div>
      <div v-else class="space-y-6">
        <p class="text-sm text-ink-muted">
          Drivers created from EFS fuel-card names are folded into their Samsara record, moving all
          fuel, idle and HOS history onto the one row. Only confident matches (phone, or an
          unambiguous full name) are auto-merged; the rest you can link by hand below.
        </p>

        <div>
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-semibold text-ink">
              Confident merges ({{ reconcile.report.value?.planned ?? 0 }})
            </h4>
            <BaseButton
              v-if="(reconcile.report.value?.planned ?? 0) > 0"
              variant="primary"
              size="sm"
              :disabled="reconcile.applying.value"
              @click="applyReconcile"
            >
              {{
                reconcile.applying.value
                  ? "Merging…"
                  : `Apply ${reconcile.report.value?.planned} merge(s)`
              }}
            </BaseButton>
          </div>
          <ul class="mt-2 divide-y divide-edge-subtle rounded-control border border-edge">
            <li
              v-for="pr in reconcile.report.value?.pairs ?? []"
              :key="pr.sourceId"
              class="flex items-center justify-between px-3 py-2 text-sm"
            >
              <span
                ><span class="text-ink-secondary">{{ pr.sourceName }}</span> →
                <span class="font-medium text-ink">{{ pr.canonicalName }}</span></span
              >
              <span class="text-xs text-ink-tertiary">by {{ pr.matchedBy }}</span>
            </li>
            <li
              v-if="!(reconcile.report.value?.pairs ?? []).length"
              class="px-3 py-2 text-sm text-ink-tertiary"
            >
              No confident merges found.
            </li>
          </ul>
        </div>

        <div>
          <h4 class="text-sm font-semibold text-ink">Link by hand ({{ stillUnmatched.length }})</h4>
          <p class="mt-1 text-xs text-ink-tertiary">
            Drivers with no confident Samsara match — pick the right person to merge into.
          </p>
          <ul class="mt-2 space-y-2">
            <li v-for="u in stillUnmatched" :key="u.id" class="flex items-center gap-2 text-sm">
              <span class="min-w-0 flex-1 truncate">{{ u.full_name }}</span>
              <AppSelect
                v-model="linkTarget[u.id]"
                class="max-w-64"
                placeholder="Select Samsara driver…"
                :options="samsaraCandidates.map((candidate) => ({ value: candidate.id, label: candidate.full_name }))"
              />
              <BaseButton size="sm" :disabled="!linkTarget[u.id]" @click="linkDriver(u.id)"
                >Link</BaseButton
              >
            </li>
            <li v-if="!stillUnmatched.length" class="text-sm text-ink-tertiary">
              Nothing left to link.
            </li>
          </ul>
        </div>
      </div>
    </SlideOver>

    <SlideOver
      :open="drawerOpen"
      :title="editing ? 'Edit driver' : 'New driver'"
      @close="drawerOpen = false"
    >
      <DriverForm
        :driver="editing"
        :submitting="saving"
        @submit="onSubmit"
        @cancel="drawerOpen = false"
      />
    </SlideOver>

    <DocumentsModal
      :open="documentsDriver !== null"
      :subject-label="documentsDriver?.full_name ?? ''"
      :documents="documentsQ.data.value ?? []"
      :loading="documentsQ.isLoading.value"
      :error="documentsQ.isError.value ? 'Could not load this driver\'s folder.' : null"
      @close="documentsDriver = null"
    />

    <DriverAccessModal :open="accessOpen" :driver="accessDriver" @close="accessOpen = false" />

    <ArchiveDriverModal
      :subject="archiving"
      kind="driver"
      :busy="archiveDriver.isPending.value"
      @close="archiving = null"
      @confirm="archiving && setArchived(archiving, true)"
    />
  </div>
</template>
