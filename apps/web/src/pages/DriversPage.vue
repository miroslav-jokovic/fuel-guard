<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import { PlusIcon } from "@silvicom/ui/icons";
import { ref, computed, watch } from "vue";
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
import { toggleSort, sortRows, type SortState } from "@/lib/sort";
import { useDriverReconcile } from "@/features/roster/useDriverReconcile";
import DriverAccessModal from "@/features/roster/DriverAccessModal.vue";
import DriverRosterTable from "@/features/roster/DriverRosterTable.vue";

const PAGE_SIZE = 20;

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

const search = ref("");
const statusFilter = ref<string>("");

/**
 * Archived drivers leave THIS list and nothing else (migration 0235).
 *
 * ⚠ The filter is here rather than in `useDriversQuery`, and that is the decision. Five other
 * surfaces read that same query as a name lookup — anomaly detail, assignment history, hazmat load
 * detail, dashboard readiness, driver-app settings — and an archived driver whose name stopped
 * resolving would turn a historical anomaly into one attributed to nobody. Archiving hides a row
 * from the list somebody scans; it does not erase the person from records they appear in.
 */
const showArchived = ref(false);
const VIEW_OPTIONS = [
  { value: "live", label: "On the roster" },
  { value: "archived", label: "Archived" },
];
const view = computed({
  get: () => (showArchived.value ? "archived" : "live"),
  set: (v: string) => {
    showArchived.value = v === "archived";
  },
});

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

const filtered = computed(() => {
  const term = search.value.toLowerCase();
  return (drivers.value ?? []).filter((d) => {
    if (Boolean(d.archived_at) !== showArchived.value) return false;
    if (statusFilter.value && d.status !== statusFilter.value) return false;
    if (!term) return true;
    return [d.full_name, d.employee_id, d.phone, d.samsara_username]
      .filter(Boolean)
      .some((f) => f!.toLowerCase().includes(term));
  });
});

const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
}
const sorted = computed(() => sortRows(filtered.value, sort.value));

const page = ref(1);
watch([search, statusFilter, showArchived], () => (page.value = 1));
const pageRows = computed(() =>
  sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
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
      </template>
    </FilterBar>

    <DriverRosterTable
      :rows="pageRows"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load drivers') : null"
      :retrying="isFetching"
      :sort="sort"
      :empty-text="
        (drivers ?? []).length === 0 ? 'No drivers yet.' : 'No drivers match these filters.'
      "
      :page="page"
      :page-size="PAGE_SIZE"
      :total="filtered.length"
      @sort="onSort"
      @retry="refetch"
      @update:page="page = $event"
      @edit="openEdit"
      @manage-access="openAccess"
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
