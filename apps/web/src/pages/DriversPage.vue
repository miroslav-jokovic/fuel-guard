<script setup lang="ts">
import { AppIcon, FilterBar, DataWorkspace, AppButton as BaseButton } from "@silvicom/ui";
import { PlusIcon } from "@silvicom/ui/icons";
import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import type { Driver, DriverInput } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import {
  useDriversQuery,
  useCreateDriver,
  useUpdateDriverProfile,
  useArchiveDriver,
} from "@/composables/useDrivers";
import SlideOver from "@/components/SlideOver.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import ArchiveDriverModal from "@/components/ArchiveDriverModal.vue";
import RosterFreshnessLine from "@/components/RosterFreshnessLine.vue";
import RosterHeldList from "@/components/RosterHeldList.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import DriverForm from "@/features/roster/DriverForm.vue";
import { useToastStore } from "@/stores/toast";
import { describeDriverEdit } from "@/lib/format";
import DriverReconcilePanel from "@/features/roster/DriverReconcilePanel.vue";
import DriverAccessModal from "@/features/roster/DriverAccessModal.vue";
import DriverRosterTable from "@/features/roster/DriverRosterTable.vue";
import DriverBinderBar from "@/features/roster/DriverBinderBar.vue";
import { capSelection } from "@/features/roster/binderSelection";
import ExportHistory from "@/features/compliance/ExportHistory.vue";
import { DRIVER_ROSTER_COLUMNS } from "@/features/roster/driverRosterColumns";
import ColumnPicker from "@/components/ui/ColumnPicker.vue";
import SavedViewMenu from "@/components/ui/SavedViewMenu.vue";
import FileGallery from "@/components/files/FileGallery.vue";
import FileUploadDialog from "@/components/files/FileUploadDialog.vue";
import { useDriverDropItems } from "@/composables/useFileDropItems";
import type { FileSubject } from "@/components/files/fileSubject";
import { useSavedViewMenu } from "@/composables/useSavedViewMenu";
import { useTableColumns } from "@/composables/useTableColumns";
import {
  SAVED_VIEW_TABLES,
  canManageDriverIdentity,
  DQ_EXPORT_MAX_DRIVERS,
  seatedDriverIds,
  dqDueFilterOptions,
  fileFilterOptions,
  type FileFilterKind,
} from "@silvicom/shared";
import { filterRoster, fileFilterCounts, sortRoster, type RosterRowFilters } from "@/features/roster/rosterRows";
import { useComplianceOverviewQuery } from "@/composables/useCompliance";
import { useVehiclesQuery } from "@/composables/useVehicles";
import {
  useRosterFilters,
  DEFAULT_ROSTER_STATUS,
  ROSTER_PAGE_SIZE,
  VIEW_OPTIONS,
} from "@/features/roster/useRosterFilters";

const session = useSessionStore();
const { data: drivers, isLoading, isError, refetch, isFetching } = useDriversQuery();
const createDriver = useCreateDriver();
/**
 * The AUDITED edit path (R6a), not the PostgREST one this drawer used until 2026-08-31.
 *
 * ── THE DEFECT THIS REPLACES ────────────────────────────────────────────────────────────────────
 * Until 2026-08-31 this drawer called `useUpdateDriver`, which wrote `drivers` straight from the
 * browser, so `resolveDriverUpdate` never ran for the surface people actually use. That composable
 * is now deleted. Two consequences, both silent: the row was never claimed, so
 * `samsaraDriverSync` overwrote the office's correction on the next sweep — the exact failure its
 * own comment says "the roster PATCH exists to prevent", written on the assumption both halves had
 * landed — and a change to a §391.51-relevant field left no audit row at all.
 *
 * Measured on 2026-08-31: 282 of 287 live drivers were sync-owned (185 samsara, 97 efs), so this
 * was the behaviour for essentially the whole roster.
 */
const updateDriver = useUpdateDriverProfile();

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

// ── Reconcile duplicate / name-only drivers with Samsara (its own panel) ────────────────────────
const reconcileOpen = ref(false);

/**
 * The audit binder and its ledger (DQ-INTO-DRIVERS-PLAN DD2, D-DQ19), moved here from the Driver
 * Qualification list. Each control asks the API's own gate: building is `roster: manage`
 * (`POST /exports/binder`), the ledger is `safety: view` (`GET /exports`). A dispatcher holds neither,
 * so their roster gains no checkboxes and no button.
 */
const canBuildBinder = computed(() => session.can("roster"));
const canSeeBinders = computed(() => session.canView("safety"));
const selected = ref<Set<string>>(new Set());
function select(next: Set<string>) {
  const { selected: kept, capped } = capSelection(next);
  selected.value = kept;
  if (capped) toast.warning("Binder limit reached", `A binder holds up to ${DQ_EXPORT_MAX_DRIVERS} drivers. Build this one, then select the rest.`);
}
const bindersOpen = ref(false);

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
  search, status: statusFilter, defaultStatus, dqDue, dqRequirement, file: fileFilter, seat,
  view, showArchived, sort, onSort, page, reset,
} = useRosterFilters();
const { data: vehicles } = useVehiclesQuery();
const seated = computed(() => seatedDriverIds(vehicles.value ?? []));

/**
 * How many controls narrow the roster, for FilterBar's one "Clear filters" — a count where
 * `active` is only a yes/no; a re-sort counts in neither. The requirement (`req`)
 * counts although no control shows it — a built-in view sets it, and the reader still needs the
 * way back from it. Status counts only when it is off its default — `active` is where the roster
 * opens, not something the reader narrowed to, and "All statuses" is the one that counts.
 */
const activeFilterCount = computed(
  () =>
    [search.value, dqDue.value, dqRequirement.value, fileFilter.value, seat.value].filter(Boolean).length +
    (statusFilter.value !== defaultStatus.value ? 1 : 0) +
    (showArchived.value ? 1 : 0),
);

/**
 * Saved views (R3c-2): a name and this page's query string, applied by navigating — the wiring is
 * `useSavedViewMenu`'s, shared with the Dispatch board.
 */
const viewMenu = useSavedViewMenu(ROSTER_TABLE, "roster");

/**
 * The §391.51 file's papers, one at a time (UNIT-FILES-PLAN UF4b; D-ROS8 before it). ONE gallery
 * owned by the page, never one per row — and the papers themselves are fetched only when it opens,
 * so the roster's own load signs nothing but the thumbnails it draws, whatever the fleet size.
 */
const gallery = ref<{ subject: FileSubject; label: string; startId: string | null } | null>(null);
function openGallery(d: Driver, documentId?: string) {
  gallery.value = { subject: { type: "driver", id: d.id }, label: d.full_name, startId: documentId ?? null };
}
/**
 * Add a paper from the File cell (DQ-FILE-COLUMN) — the dialog the Driver Qualification, Vehicles and
 * Trailers lists open. A drop carries its scan in; filing is the roster section's write.
 */
const upload = ref<{ driver: Driver; file: File | null } | null>(null);
const uploadItems = useDriverDropItems(computed(() => upload.value?.driver.id ?? null));
function openUpload(d: Driver, file?: File) {
  if (session.can("roster")) upload.value = { driver: d, file: file ?? null };
}
/**
 * The File cell's "still needed" control (D-DQ22): a reader who files opens the upload panel, which
 * lists the same items with Record beside each; a reader who cannot is taken to the file to read it.
 */
const router = useRouter();
function openOutstanding(d: Driver) {
  if (session.can("roster")) openUpload(d);
  else void router.push(`/drivers/${d.id}?section=qualification`);
}

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
  // The default is listed even before the drivers load, so the control never shows a value it has
  // no option for.
  ...[...new Set([DEFAULT_ROSTER_STATUS, ...(drivers.value ?? []).map((d) => d.status)])].map((s) => ({ value: s, label: s })),
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

/** What the toolbar asks for, in the shape `rosterRows` reads (DQ-INTO-DRIVERS-PLAN DD1). */
const rowFilters = computed<RosterRowFilters>(() => ({
  term: search.value,
  status: statusFilter.value,
  showArchived: showArchived.value,
  seat: seat.value,
  seated: seated.value,
  file: fileFilter.value,
  due: dqDue.value,
  req: dqRequirement.value,
}));
const filtered = computed(() => filterRoster(drivers.value ?? [], overviewRows.value, rowFilters.value));

/**
 * The File cell's chip as a filter — the Vehicles and Trailers toolbars' options (UF4b, Q-UF9) — each
 * with how many drivers choosing it would leave, the other controls as set (D-DQ18). Plain words until
 * the rollup arrives: a "(0)" that only means "not loaded yet" would read as a clean fleet.
 */
const fileOptions = computed(() => {
  const counts = overviewQ.data.value
    ? fileFilterCounts(drivers.value ?? [], overviewRows.value, rowFilters.value)
    : null;
  return fileFilterOptions().map((o) =>
    counts && o.value ? { ...o, label: `${o.label} (${counts[o.value as FileFilterKind]})` } : o,
  );
});

const sorted = computed(() => sortRoster(filtered.value, sort.value, overviewRows.value));

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
    if (!editing.value) {
      await createDriver.mutateAsync(input);
      drawerOpen.value = false;
      toast.success("Driver created");
      return;
    }
    const saved = await updateDriver.mutateAsync({ id: editing.value.id, input });
    drawerOpen.value = false;
    // Say what the edit DID, not merely that it happened. Both facts change what the row means, and
    // both were previously written to the audit log and to nowhere the person could see (R6a).
    toast.success("Driver updated", describeDriverEdit(saved) ?? undefined);
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
        <!-- Outside the roster-manage block: an auditor reads the ledger (`safety: view`) and builds nothing. -->
        <BaseButton v-if="canSeeBinders" @click="bindersOpen = true">Audit binders</BaseButton>
        <template v-if="session.can('roster')">
          <!-- Merging drivers is irreversible and granted by NAME (DRIVER_IDENTITY_ROLES, SP11), so a
               safety manager — who manages the roster — is not offered a button the API refuses. -->
          <BaseButton
            v-if="canManageDriverIdentity(session.role)"
            title="Fold duplicate / name-only drivers into their Samsara record"
            @click="reconcileOpen = true"
          >
            Reconcile with Samsara
          </BaseButton>
          <BaseButton variant="primary" @click="openNew">
            <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> New driver
          </BaseButton>
        </template>
      </template>
      <template #freshness><RosterFreshnessLine /></template>
    </PageHeader>

    <RosterHeldList />

    <DataWorkspace>
    <!-- The roster can now be arrived at narrowed, from a link or a saved view, so it needs a way back
         that does not require knowing which controls were set — FilterBar's "Clear filters". -->
    <FilterBar
      v-model:search="search"
      embedded
      search-placeholder="Search name, driver ID, employee ID, phone…"
      :count="filtered.length"
      count-label="drivers"
      :active-count="activeFilterCount"
      @clear-all="reset"
    >
      <template #filters>
        <FilterSelect v-model="statusFilter" label="Status" :options="statusOptions" />
        <FilterSelect v-model="view" label="Show" :options="VIEW_OPTIONS" />
        <!-- The same two filters the compliance fleet table carries, same words, same predicate. File
             is the File cell's chip as a control (UF4b) — the vocabulary the Vehicles and Trailers
             toolbars carry too. It used to sit beside a "File status" (`?dq=`, "has ANY item in this
             state") that disagreed with the chip; Q-UF9 retired that one, which returned Due to the
             toolbar within its four controls (`lint:ui-adoption`). -->
        <FilterSelect v-model="fileFilter" label="File" :options="fileOptions" />
        <FilterSelect v-model="dqDue" label="Due" :options="DQ_DUE_OPTIONS" />
      </template>
      <template #actions>
        <SavedViewMenu
          :built-ins="viewMenu.builtIns"
          :views="viewMenu.views.value"
          :current-query="viewMenu.currentQuery.value"
          :active-name="viewMenu.activeName.value"
          :busy="viewMenu.busy.value"
          @apply="viewMenu.apply"
          @save="viewMenu.save"
          @remove="viewMenu.remove"
        />
        <ColumnPicker :columns="rosterColumns" />
      </template>
    </FilterBar>

    <DriverBinderBar
      v-if="canBuildBinder"
      :selected="selected"
      @clear="selected = new Set()"
      @built="bindersOpen = canSeeBinders"
    />
    <DriverRosterTable
      :selectable="canBuildBinder"
      :selected="selected"
      @update:selected="select"
      :rows="pageRows"
      :columns="rosterColumns.visible.value"
      :loading="isLoading"
      :error="isError ? 'Could not load the drivers.' : null"
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
      @open-file="openGallery"
      @upload-file="openUpload"
      @outstanding="openOutstanding"
      @archive="archiving = $event"
      @restore="setArchived($event, false)"
    />
    </DataWorkspace>

    <!-- The ledger of binders built (DQ-BINDER-PLAN), opened from the header or by a build. -->
    <SlideOver :open="bindersOpen" size="xl" title="Audit binders" @close="bindersOpen = false">
      <ExportHistory />
    </SlideOver>

    <DriverReconcilePanel :open="reconcileOpen" :drivers="drivers ?? []" @close="reconcileOpen = false" />

    <SlideOver
      :open="drawerOpen"
      :title="editing ? 'Edit driver' : 'New driver'"
      @close="drawerOpen = false"
    >
      <DriverForm
        :driver="editing"
        @submit="onSubmit"
      />
      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton @click="drawerOpen = false">Cancel</BaseButton>
          <BaseButton form="driver-form" type="submit" variant="primary" :disabled="saving">
            {{ saving ? "Saving…" : "Save driver" }}
          </BaseButton>
        </div>
      </template>
    </SlideOver>

    <FileGallery
      :subject="gallery?.subject ?? null"
      :subject-label="gallery?.label ?? ''"
      :start-id="gallery?.startId ?? null"
      @close="gallery = null"
    />
    <FileUploadDialog
      :subject="upload ? { type: 'driver', id: upload.driver.id } : null"
      :subject-label="upload?.driver.full_name ?? ''"
      :items="uploadItems"
      :outstanding="upload ? (overviewRows.get(upload.driver.id)?.attention ?? []) : []"
      :initial-file="upload?.file ?? null"
      :file-link="upload ? `/drivers/${upload.driver.id}?section=qualification` : '/drivers'"
      @close="upload = null"
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
