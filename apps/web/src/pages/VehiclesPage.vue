<script setup lang="ts">
import {
  AppIcon,
  useQueryState,
  SORT_DIRECTIONS,
  useUrlSort,
  FilterBar,
  TablePagination,
  DataTable,
  BulkActionBar,
  type DataTableColumn,
  DataWorkspace,
  AppButton as BaseButton,
  useConfirm,
  sortRows,
} from "@silvicom/ui";
import {
  PlusIcon,
} from "@silvicom/ui/icons";
import { ref, computed, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { FILE_FILTERS, fileFilterOptions, VEHICLE_CHECKS, VEHICLE_CHECK_LABELS, VEHICLE_STATUSES, isStatusFromTms, matchesFileFilter, matchesVehicleCheck, paperStanding, PAPER_CHECK_ITEMS, todayInZone, unitFileChip, type Vehicle, type VehicleInput } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { useVehiclesQuery, useCreateVehicle, useUpdateVehicle, useRetireVehicle, useBulkUpdateVehicles } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { useUnitFilesQuery } from "@/composables/useCompliance";
import FileCell from "@/components/files/FileCell.vue";
import FileGallery from "@/components/files/FileGallery.vue";
import type { FileSubject } from "@/components/files/fileSubject";
import SlideOver from "@/components/SlideOver.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import InspectionExpiryCell from "@/features/maintenance/InspectionExpiryCell.vue";
import RosterFreshnessLine from "@/components/RosterFreshnessLine.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import VehicleForm from "@/features/roster/VehicleForm.vue";
import VehicleSetupImport from "@/features/roster/VehicleSetupImport.vue";
import { useToastStore } from "@/stores/toast";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import { useOrgTimezone } from "@/composables/useOrgTimezone";

const PAGE_SIZE = 20;
const session = useSessionStore();
// A drop on a File cell opens the unit's File section (UNIT-FILES-PLAN UF5) — see `FileCell`'s note.
const router = useRouter();
const { data: vehicles, isLoading, isError, refetch, isFetching } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();

// Filters, sort and page live in the URL (D-US2), so reload, a pasted link and Back from a truck keep
// the list. "active" is the fallback, so it stays out of a plain link and "All statuses" writes `any`.
const qs = useQueryState();
const search = qs.param("search");
const statusFilter = qs.param("status", VEHICLE_STATUSES, "active");
/**
 * What a truck is missing — the Operations tab's Seats and Truck paperwork cards link here with it
 * (FLEET-MANAGER-HOME-PLAN D-FM9), so "11 registrations overdue" opens exactly those eleven. Asked of
 * `matchesVehicleCheck`, the predicate the cards count with, on the carrier's calendar day.
 */
const checkFilter = qs.param("check", VEHICLE_CHECKS);
/**
 * The file chip's filter (UNIT-FILES-PLAN UF4). The chip and the filter both ask `unitFileChip`, so
 * clicking "2 expiring" on a row lists exactly the trucks whose chip reads expiring.
 */
const fileFilter = qs.param("file", FILE_FILTERS);
const fileOptions = fileFilterOptions();
const unitFilesQ = useUnitFilesQuery("tractor");
/** Each truck's file, by id — the column, both filters and the paperwork checks read it. */
const fileById = computed(() => new Map((unitFilesQ.data.value?.units ?? []).map((u) => [u.subject_id, u])));
const chipById = computed(() => new Map([...fileById.value].map(([id, u]) => [id, unitFileChip(u)])));
const { zone } = useOrgTimezone();
const today = computed(() => todayInZone(new Date(), zone.value));
const checkOptions = [{ value: "", label: "Any" }, ...VEHICLE_CHECKS.map((c) => ({ value: c, label: VEHICLE_CHECK_LABELS[c] }))];
const statusOptions = [
  { value: "", label: "All statuses" },
  ...VEHICLE_STATUSES.map((s) => ({ value: s, label: s })),
];
// "active" is where the list opens, not a narrowing anybody chose: it does not count, and clearing returns to it.
const activeFilterCount = computed(
  () => (search.value.trim() ? 1 : 0) + (statusFilter.value !== "active" ? 1 : 0) + (checkFilter.value ? 1 : 0) + (fileFilter.value ? 1 : 0),
);
function resetFilters() {
  qs.set({ search: undefined, status: undefined, check: undefined, file: undefined });
}

const filtered = computed(() => {
  const term = search.value.toLowerCase();
  return (vehicles.value ?? []).filter((v) => {
    if (statusFilter.value && v.status !== statusFilter.value) return false;
    if (checkFilter.value && !matchesVehicleCheck(v, checkFilter.value, fileById.value.get(v.id))) return false;
    if (fileFilter.value) {
      const chip = chipById.value.get(v.id);
      if (!chip || !matchesFileFilter(chip, fileFilter.value)) return false;
    }
    if (!term) return true;
    return [v.unit_number, v.make, v.model, v.plate, v.vin, String(v.year ?? "")]
      .filter(Boolean)
      .some((f) => f!.toLowerCase().includes(term));
  });
});

/**
 * The two paper columns show the truck's standing on the paper — its filed date, else McLeod's marked
 * "date only" (D-UF3) — the answer `?check=` and the Truck paperwork card count with. Showing McLeod's
 * raw column here would put "valid" beside a row the overdue filter just listed.
 */
const PAPER_COLUMNS: Record<string, string> = {
  dot_annual_inspection_expires_at: PAPER_CHECK_ITEMS.inspection,
  registration_expires_at: PAPER_CHECK_ITEMS.registration,
};
const standing = (v: Vehicle, column: string) =>
  paperStanding(fileById.value.get(v.id)?.items.find((i) => i.key === PAPER_COLUMNS[column]));

const getVal = (v: Vehicle, key: string): unknown => {
  if (key in PAPER_COLUMNS) return standing(v, key).goodUntil;
  const raw = (v as unknown as Record<string, unknown>)[key];
  return typeof raw === "string" && raw !== "" && !isNaN(Number(raw)) ? Number(raw) : raw;
};
const sorted = computed(() => sortRows(filtered.value, sort.value, getVal));

const columns: DataTableColumn[] = [
  { key: "unit_number", label: "Unit", sortable: true, width: "sm" },
  { key: "file", label: "File", width: "lg" },
  { key: "vehicle", label: "Vehicle", width: "lg", cellClass: "text-ink-secondary" },
  { key: "fuel_type", label: "Fuel", width: "sm", cellClass: "capitalize text-ink-secondary" },
  { key: "tank_capacity_gal", label: "Tank", sortable: true, numeric: true, width: "sm", cellClass: "text-ink-secondary" },
  { key: "baseline_mpg", label: "Baseline MPG", sortable: true, numeric: true, width: "lg", cellClass: "text-ink-secondary" },
  { key: "samsara_fuel_percent", label: "Fuel level", sortable: true, numeric: true, width: "md", cellClass: "text-ink-secondary" },
  { key: "current_odometer", label: "Odometer", sortable: true, numeric: true, width: "md", cellClass: "text-ink-secondary" },
  { key: "assigned_driver_id", label: "Driver", width: "md", cellClass: "text-ink-secondary" },
  { key: "has_apu", label: "APU", sortable: true, width: "sm" },
  { key: "has_optimized_idle", label: "Optimized idle", sortable: true, width: "md" },
  { key: "dot_annual_inspection_expires_at", label: "Annual inspection", sortable: true, width: "md" },
  { key: "registration_expires_at", label: "Registration", sortable: true, width: "md" },
  { key: "status", label: "Status", sortable: true, width: "sm" },
];
const { sort, onSort } = useUrlSort(
  qs.param("sort", columns.filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);

const page = qs.page();
watch([search, statusFilter, checkFilter, fileFilter], () => (page.value = 1));

/** The gallery's subject, or null when closed — one dialog for the whole list, never one per row. */
const gallery = ref<{ subject: FileSubject; label: string; startId: string | null } | null>(null);
function openGallery(v: Vehicle, documentId?: string) {
  gallery.value = { subject: { type: "tractor", id: v.id }, label: `Unit ${v.unit_number}`, startId: documentId ?? null };
}
const pageRows = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const createVehicle = useCreateVehicle();
const updateVehicle = useUpdateVehicle();
const retireVehicle = useRetireVehicle();

const toast = useToastStore();
const ask = useConfirm();
const drawerOpen = ref(false);
const editing = ref<Vehicle | null>(null);

// ── selection (bulk idle-reduction capability edit) ───────────────────────────
const selected = ref<Set<string>>(new Set());
const selectedCount = computed(() => selected.value.size);
const bulkUpdate = useBulkUpdateVehicles();
async function bulkSetCapability(
  patch: Partial<Pick<Vehicle, "has_apu" | "has_optimized_idle" | "apu_type">>,
  label: string,
) {
  try {
    const n = await bulkUpdate.mutateAsync({ ids: [...selected.value], patch });
    selected.value = new Set();
    toast.success(`${label} — ${n} truck${n === 1 ? "" : "s"} updated`);
  } catch (e) {
    toast.error("Bulk update failed", e instanceof Error ? e.message : undefined);
  }
}

const driverName = (id: string | null) =>
  id ? (drivers.value?.find((d) => d.id === id)?.full_name ?? "—") : "—";

// Fuel vehicles (diesel/gasoline) need a tank capacity + baseline MPG for the detection engine.
// Samsara can't provide these, so flag them as "setup needed" after a sync.
const needsSetup = (v: Vehicle) =>
  (v.fuel_type === "diesel" || v.fuel_type === "gasoline") &&
  (Number(v.tank_capacity_gal) <= 0 || !v.baseline_mpg);

const saving = computed(() => createVehicle.isPending.value || updateVehicle.isPending.value);

function openNew() {
  editing.value = null;
  drawerOpen.value = true;
}
function openEdit(v: Vehicle) {
  editing.value = v;
  drawerOpen.value = true;
}

async function onSubmit(input: VehicleInput) {
  try {
    if (editing.value) await updateVehicle.mutateAsync({ id: editing.value.id, input });
    else await createVehicle.mutateAsync(input);
    drawerOpen.value = false;
    toast.success(editing.value ? "Vehicle updated" : "Vehicle created");
  } catch (e) {
    toast.error("Could not save vehicle", e instanceof Error ? e.message : undefined);
  }
}

const setupOpen = ref(false);

async function onRetire(v: Vehicle) {
  // The product's dialog, red: a retired vehicle leaves the active list (D-US7). Its history is kept.
  const asked = await ask({
    title: `Retire vehicle ${v.unit_number}?`,
    message: "Its history is preserved.",
    confirmLabel: "Retire",
    tone: "danger",
  });
  if (asked) {
    try {
      await retireVehicle.mutateAsync(v.id);
      toast.success(`Vehicle ${v.unit_number} retired`);
    } catch (e) {
      toast.error("Could not retire vehicle", e instanceof Error ? e.message : undefined);
    }
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Fleet vehicles and their fuel parameters.">
      <template #actions>
        <template v-if="session.can('equipment')">
          <BaseButton
            title="Import vehicles from CSV — download a blank template, fill it in, and upload"
            @click="setupOpen = true"
          >
            Import vehicles
          </BaseButton>
          <BaseButton variant="primary" @click="openNew">
            <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> New vehicle
          </BaseButton>
        </template>
      </template>
      <template #freshness><RosterFreshnessLine /></template>
    </PageHeader>

    <DataWorkspace>
    <FilterBar
      v-model:search="search"
      embedded
      search-placeholder="Search unit, make, model, plate, VIN…"
      :count="filtered.length"
      count-label="vehicles"
      :active-count="activeFilterCount"
      @clear-all="resetFilters"
    >
      <template #filters>
        <FilterSelect v-model="statusFilter" label="Status" :options="statusOptions" />
        <FilterSelect v-model="checkFilter" label="Needs" :options="checkOptions" />
        <FilterSelect v-model="fileFilter" label="File" :options="fileOptions" />
      </template>
    </FilterBar>

    <!-- Bulk idle-reduction capability: select trucks, then set APU / Optimized-Idle on all of them at once. -->
    <BulkActionBar v-if="session.can('equipment')" :count="selectedCount" @clear="selected = new Set()">
      <template #note>Set idle-reduction capability:</template>
      <BaseButton size="sm" :disabled="bulkUpdate.isPending.value" @click="bulkSetCapability({ has_apu: true }, 'Marked as having an APU')">Has APU</BaseButton>
      <BaseButton size="sm" :disabled="bulkUpdate.isPending.value" @click="bulkSetCapability({ has_apu: false, apu_type: 'none' }, 'Marked as no APU')">No APU</BaseButton>
      <BaseButton size="sm" :disabled="bulkUpdate.isPending.value" @click="bulkSetCapability({ has_optimized_idle: true }, 'Marked as having Optimized-Idle')">Has Optimized-Idle</BaseButton>
      <BaseButton size="sm" :disabled="bulkUpdate.isPending.value" @click="bulkSetCapability({ has_optimized_idle: false }, 'Marked as no Optimized-Idle')">No Optimized-Idle</BaseButton>
    </BulkActionBar>

    <DataTable
      embedded
      :columns="columns"
      :rows="pageRows"
      row-key="id"
      :selectable="session.can('equipment')"
      :selected="selected"
      :loading="isLoading"
      :error="isError ? 'Could not load the vehicles.' : null"
      :retrying="isFetching"
      :sort="sort"
      :empty-text="(vehicles ?? []).length === 0 ? 'No vehicles yet.' : 'No vehicles match these filters.'"
      @sort="onSort"
      @retry="refetch"
      @update:selected="selected = $event"
    >
      <template #cell-unit_number="{ row }">
        <RouterLink :to="`/vehicles/${row.id}`" class="font-medium text-link hover:text-link-hover">{{ row.unit_number }}</RouterLink>
        <!-- Replacement lifecycle (identity check 2026-08-12): the identity sync stamps this when the
             mapped Samsara vehicle no longer exists. Surfaced, never auto-retired — a human decides. -->
        <span
          v-if="row.samsara_missing_since && row.status !== 'retired'"
          :class="[BADGE_BASE, toneClass('warning'), 'ml-2']"
          :title="`This truck's Samsara vehicle no longer exists (since ${formatDate(row.samsara_missing_since)}). It cannot sync telematics — likely replaced. Retire it if the physical truck is gone.`"
        >Samsara link lost</span>
      </template>
      <template #cell-file="{ row }">
        <FileCell
          v-if="fileById.get(row.id)"
          :papers="fileById.get(row.id)!.papers ?? []"
          :paper-count="fileById.get(row.id)!.paper_count ?? 0"
          :items="fileById.get(row.id)!.items"
          :subject-label="`Unit ${row.unit_number}`"
          @open="openGallery(row, $event)"
          @drop="router.push(`/vehicles/${row.id}?section=file`)"
        />
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #cell-vehicle="{ row }">{{ [row.year, row.make, row.model].filter(Boolean).join(" ") || "—" }}</template>
      <template #cell-tank_capacity_gal="{ row }">
        <span v-if="Number(row.tank_capacity_gal) > 0">{{ row.tank_capacity_gal }} gal</span>
        <span v-else-if="needsSetup(row)" :class="[BADGE_BASE, toneClass('warning')]">Set tank</span>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #cell-baseline_mpg="{ row }">
        <span v-if="row.baseline_mpg">{{ row.baseline_mpg }}</span>
        <span v-else-if="needsSetup(row)" :class="[BADGE_BASE, toneClass('warning')]">Set MPG</span>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #cell-samsara_fuel_percent="{ value }">
        <span v-if="value != null">{{ value }}%</span>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #cell-current_odometer="{ row }">
        <span v-if="Number(row.current_odometer) > 0">{{ Math.round(Number(row.current_odometer)).toLocaleString() }} mi</span>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #cell-assigned_driver_id="{ row }">{{ driverName(row.assigned_driver_id) }}</template>
      <template v-for="column in Object.keys(PAPER_COLUMNS)" :key="column" #[`cell-${column}`]="{ row }">
        <!-- "—" until the truck's file arrives: "Not recorded" before it loads would be a claim. -->
        <span v-if="!fileById.get(row.id)" class="text-ink-tertiary">—</span>
        <InspectionExpiryCell v-else :expires-on="standing(row, column).goodUntil" :today="today" />
        <span
          v-if="fileById.get(row.id) && standing(row, column).source === 'date_only'"
          class="ml-1 text-xs text-ink-tertiary"
          title="McLeod's date — no paper is filed for it yet"
        >date only</span>
      </template>
      <template #cell-has_apu="{ value }">
        <span v-if="value === true" :class="[BADGE_BASE, toneClass('success')]">Yes</span>
        <span v-else-if="value === false" class="text-ink-tertiary">No</span>
        <span v-else :class="[BADGE_BASE, toneClass('warning')]">Unset</span>
      </template>
      <template #cell-has_optimized_idle="{ value }">
        <span v-if="value === true" :class="[BADGE_BASE, toneClass('success')]">Yes</span>
        <span v-else-if="value === false" class="text-ink-tertiary">No</span>
        <span v-else :class="[BADGE_BASE, toneClass('warning')]">Unset</span>
      </template>
      <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
      <template #actions="{ row }">
        <KebabMenu v-if="session.can('equipment')">
          <BaseButton class="kebab-item" @click="openEdit(row)">Edit vehicle</BaseButton>
          <!-- Q-7: a McLeod-linked truck is retired in McLeod, and the next sweep would un-retire it here. -->
          <BaseButton
            v-if="row.status !== 'retired' && !isStatusFromTms({ link: row.mcleod_tractor_id, identity_source: row.identity_source })"
            class="kebab-item kebab-item-danger"
            @click="onRetire(row)"
          >Retire vehicle</BaseButton>
        </KebabMenu>
      </template>
      <template #footer>
        <TablePagination
          :page="page"
          :page-size="PAGE_SIZE"
          :total="filtered.length"
          @update:page="page = $event"
        />
      </template>
    </DataTable>
    </DataWorkspace>

    <FileGallery
      :subject="gallery?.subject ?? null"
      :subject-label="gallery?.label ?? ''"
      :start-id="gallery?.startId ?? null"
      @close="gallery = null"
    />

    <SlideOver :open="setupOpen" title="Import vehicles" @close="setupOpen = false">
      <VehicleSetupImport :vehicles="vehicles ?? []" @done="setupOpen = false" />
    </SlideOver>

    <SlideOver :open="drawerOpen" :title="editing ? 'Edit vehicle' : 'New vehicle'" @close="drawerOpen = false">
      <VehicleForm
        :vehicle="editing"
        :drivers="drivers ?? []"
        @submit="onSubmit"
      />
      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton @click="drawerOpen = false">Cancel</BaseButton>
          <BaseButton form="vehicle-form" type="submit" variant="primary" :disabled="saving">
            {{ saving ? "Saving…" : "Save vehicle" }}
          </BaseButton>
        </div>
      </template>
    </SlideOver>
  </div>
</template>
