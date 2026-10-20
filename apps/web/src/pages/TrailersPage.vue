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
import { PlusIcon } from "@silvicom/ui/icons";
import { ref, computed, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { FILE_FILTERS, fileFilterOptions, PAPER_CHECK_ITEMS, TRAILER_TYPE_LABELS, VEHICLE_STATUSES, handPairingPatch, isStatusFromTms, matchesFileFilter, paperStanding, todayInZone, unitFileChip, type Trailer, type TrailerInput, type TrailerWrite } from "@silvicom/shared";
import { useTrailersOnLoadsQuery } from "@/composables/useTrailerLink";
import { gpsPairingNote } from "@/lib/trailerPairingNote";
import { useSessionStore } from "@/stores/session";
import {
  useTrailersQuery,
  useCreateTrailer,
  useUpdateTrailer,
  useRetireTrailer,
  useBulkUpdateTrailers,
} from "@/composables/useTrailers";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useUnitFilesQuery } from "@/composables/useCompliance";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
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
import TrailerForm from "@/features/roster/TrailerForm.vue";
import { useToastStore } from "@/stores/toast";
import { BADGE_BASE, toneClass } from "@/lib/badges";

const PAGE_SIZE = 20;
const session = useSessionStore();
// A drop on a File cell opens the unit's File section (UNIT-FILES-PLAN UF5) — see `FileCell`'s note.
const router = useRouter();
const { data: trailers, isLoading, isError, refetch, isFetching } = useTrailersQuery();
const { data: vehicles } = useVehiclesQuery();
const toast = useToastStore();
const ask = useConfirm();

// ── filters ─────────────────────────────────────────────────────────────────────
// Filters, sort and page live in the URL (D-US2), so reload, a pasted link and Back keep the list.
const qs = useQueryState();
const search = qs.param("search");
const statusFilter = qs.param("status", VEHICLE_STATUSES, "active");
const reeferFilter = qs.param("reefer", ["reefer", "non"]);
/** The file chip's filter — the chip and the filter both ask `unitFileChip` (UNIT-FILES-PLAN UF4). */
const fileFilter = qs.param("file", FILE_FILTERS);
const fileOptions = fileFilterOptions();
const unitFilesQ = useUnitFilesQuery("trailer");
// The carrier's calendar day, as the Vehicles page judges its cells (D-PREC5).
const { zone } = useOrgTimezone();
const today = computed(() => todayInZone(new Date(), zone.value));
const fileById = computed(() => new Map((unitFilesQ.data.value?.units ?? []).map((u) => [u.subject_id, u])));
const chipById = computed(() => new Map([...fileById.value].map(([id, u]) => [id, unitFileChip(u)])));
/** The inspection column shows the trailer's standing on the paper, as the Vehicles page does (D-UF3). */
const inspection = (t: Trailer) =>
  paperStanding(fileById.value.get(t.id)?.items.find((i) => i.key === PAPER_CHECK_ITEMS.inspection));
const statusOptions = [
  { value: "", label: "All statuses" },
  ...VEHICLE_STATUSES.map((s) => ({ value: s, label: s })),
];
// "active" is where the list opens, not a narrowing anybody chose: it does not count, and clearing returns to it.
const activeFilterCount = computed(
  () => (search.value.trim() ? 1 : 0) + (statusFilter.value !== "active" ? 1 : 0) + (reeferFilter.value ? 1 : 0) + (fileFilter.value ? 1 : 0),
);
function resetFilters() {
  qs.set({ search: undefined, status: undefined, reefer: undefined, file: undefined });
}
const reeferOptions = [
  { value: "", label: "All trailers" },
  { value: "reefer", label: "Reefers only" },
  { value: "non", label: "Non-reefers" },
];

const filtered = computed(() => {
  const term = search.value.toLowerCase();
  return (trailers.value ?? []).filter((t) => {
    if (statusFilter.value && t.status !== statusFilter.value) return false;
    if (reeferFilter.value === "reefer" && !t.is_reefer) return false;
    if (reeferFilter.value === "non" && t.is_reefer) return false;
    if (fileFilter.value) {
      const chip = chipById.value.get(t.id);
      if (!chip || !matchesFileFilter(chip, fileFilter.value)) return false;
    }
    if (!term) return true;
    return [t.unit_number, t.make, t.model, t.plate]
      .filter(Boolean)
      .some((f) => f!.toLowerCase().includes(term));
  });
});

const getVal = (t: Trailer, key: string): unknown =>
  key === "dot_annual_inspection_expires_at" ? inspection(t).goodUntil : (t as unknown as Record<string, unknown>)[key];
const sorted = computed(() => sortRows(filtered.value, sort.value, getVal));

const page = qs.page();
watch([search, statusFilter, reeferFilter, fileFilter], () => (page.value = 1));

/** One gallery for the whole list, never one per row. */
const gallery = ref<{ subject: FileSubject; label: string; startId: string | null } | null>(null);
function openGallery(t: Trailer, documentId?: string) {
  gallery.value = { subject: { type: "trailer", id: t.id }, label: `Trailer ${t.unit_number}`, startId: documentId ?? null };
}
const pageRows = computed(() =>
  sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);

const onLoads = useTrailersOnLoadsQuery();
const vehUnit = (id: string | null) =>
  id ? (vehicles.value?.find((v) => v.id === id)?.unit_number ?? "—") : "—";

const columns: DataTableColumn[] = [
  { key: "unit_number", label: "Unit", sortable: true, cellClass: "font-medium text-ink" },
  { key: "file", label: "File" },
  { key: "trailer", label: "Make / Model", cellClass: "text-ink-secondary" },
  { key: "trailer_type", label: "Type", sortable: true },
  {
    key: "reefer_tank_capacity_gal",
    label: "Reefer tank",
    sortable: true,
    numeric: true,
    cellClass: "text-ink-secondary",
  },
  // Two sources, two columns (TRAILER-LINK-PLAN D-TL1): the load McLeod put the trailer on, and the
  // truck the GPS last saw it with. They are different questions and disagree often, so neither stands in
  // for the other.
  { key: "on_load", label: "On load (McLeod)", cellClass: "text-ink-secondary" },
  { key: "assigned_vehicle_id", label: "GPS pairing", cellClass: "text-ink-secondary" },
  { key: "dot_annual_inspection_expires_at", label: "Annual inspection", sortable: true },
  { key: "status", label: "Status", sortable: true },
];
const { sort, onSort } = useUrlSort(
  qs.param("sort", columns.filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);

// ── selection (bulk edit) ─────────────────────────────────────────────────────────
const selected = ref<Set<string>>(new Set());
const selectedCount = computed(() => selected.value.size);

// ── mutations ─────────────────────────────────────────────────────────────────────
const createTrailer = useCreateTrailer();
const updateTrailer = useUpdateTrailer();
const retireTrailer = useRetireTrailer();
const bulkUpdate = useBulkUpdateTrailers();
const saving = computed(() => createTrailer.isPending.value || updateTrailer.isPending.value);

const drawerOpen = ref(false);
const editing = ref<Trailer | null>(null);
function openNew() {
  editing.value = null;
  drawerOpen.value = true;
}
function openEdit(t: Trailer) {
  editing.value = t;
  drawerOpen.value = true;
}

async function onSubmit(input: TrailerInput) {
  try {
    // A pairing a person changes is marked theirs, so the daily GPS run leaves it alone (Q-TL3); the
    // schema turns a cleared select into "absent", so the clear is written out explicitly here.
    const hand = editing.value
      ? handPairingPatch(editing.value.assigned_vehicle_id ?? null, input.assigned_vehicle_id ?? null)
      : handPairingPatch(null, input.assigned_vehicle_id ?? null);
    const saved: TrailerWrite = hand ? { ...input, ...hand } : input;
    if (editing.value) await updateTrailer.mutateAsync({ id: editing.value.id, input: saved });
    else await createTrailer.mutateAsync(saved);
    drawerOpen.value = false;
    toast.success(editing.value ? "Trailer updated" : "Trailer created");
  } catch (e) {
    toast.error("Could not save trailer", e instanceof Error ? e.message : undefined);
  }
}

const statusFromTms = (t: Trailer) =>
  isStatusFromTms({ link: t.mcleod_trailer_id, identity_source: t.identity_source });

async function bulkSet(patch: { is_reefer?: boolean; status?: Trailer["status"] }) {
  // Q-7: a status write on a McLeod-linked trailer is reverted by the next roster sweep, so a bulk
  // retire leaves those rows out and says how many — rather than reporting a change that won't hold.
  const ids = [...selected.value];
  const byId = new Map((trailers.value ?? []).map((t) => [t.id, t]));
  const writable = patch.status ? ids.filter((id) => !statusFromTms(byId.get(id)!)) : ids;
  const skipped = ids.length - writable.length;
  try {
    const n = await bulkUpdate.mutateAsync({ ids: writable, patch });
    selected.value = new Set();
    toast.success(
      `Updated ${n} trailer${n === 1 ? "" : "s"}`,
      skipped ? `${skipped} set in McLeod were left alone. Retire them there.` : undefined,
    );
  } catch (e) {
    toast.error("Bulk update failed", e instanceof Error ? e.message : undefined);
  }
}

async function toggleReefer(t: Trailer) {
  try {
    await bulkUpdate.mutateAsync({ ids: [t.id], patch: { is_reefer: !t.is_reefer } });
    toast.success(t.is_reefer ? "Unmarked as reefer" : "Marked as reefer");
  } catch (e) {
    toast.error("Update failed", e instanceof Error ? e.message : undefined);
  }
}

async function onRetire(t: Trailer) {
  // The product's dialog, red: a retired trailer leaves the active list (D-US7). Its history is kept.
  const asked = await ask({
    title: `Retire trailer ${t.unit_number}?`,
    message: "Its history is preserved.",
    confirmLabel: "Retire",
    tone: "danger",
  });
  if (asked) {
    try {
      await retireTrailer.mutateAsync(t.id);
      toast.success(`Trailer ${t.unit_number} retired`);
    } catch (e) {
      toast.error("Could not retire trailer", e instanceof Error ? e.message : undefined);
    }
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      description="Trailers in your fleet, from McLeod. Type (Reefer / Dry) is set by you with the buttons below — only reefers are checked against reefer (ULSR) fuel. Paired tractor is inferred from GPS co-location over the last 5 days; Status is the trailer's active/retired state."
    >
      <template #actions>
        <template v-if="session.can('equipment')">
          <BaseButton variant="primary" @click="openNew">
            <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> New trailer
          </BaseButton>
        </template>
      </template>
      <template #freshness><RosterFreshnessLine /></template>
    </PageHeader>

    <DataWorkspace>
    <FilterBar
      v-model:search="search"
      embedded
      search-placeholder="Search unit, make, model, plate…"
      :count="filtered.length"
      count-label="trailers"
      :active-count="activeFilterCount"
      @clear-all="resetFilters"
    >
      <template #filters>
        <FilterSelect v-model="reeferFilter" label="Type" :options="reeferOptions" />
        <FilterSelect v-model="statusFilter" label="Status" :options="statusOptions" />
        <FilterSelect v-model="fileFilter" label="File" :options="fileOptions" />
      </template>
    </FilterBar>

    <!-- Bulk action bar -->
    <BulkActionBar v-if="session.can('equipment')" :count="selectedCount" @clear="selected = new Set()">
      <BaseButton size="sm" :disabled="bulkUpdate.isPending.value" @click="bulkSet({ is_reefer: true })">Mark as reefer</BaseButton>
      <BaseButton size="sm" :disabled="bulkUpdate.isPending.value" @click="bulkSet({ is_reefer: false })">Unmark reefer</BaseButton>
      <BaseButton size="sm" :disabled="bulkUpdate.isPending.value" @click="bulkSet({ status: 'retired' })">Retire</BaseButton>
    </BulkActionBar>

    <DataTable
      embedded
      :columns="columns"
      :rows="pageRows"
      row-key="id"
      :loading="isLoading"
      :error="isError ? 'Could not load the trailers.' : null"
      :retrying="isFetching"
      :sort="sort"
      :selectable="session.can('equipment')"
      :selected="selected"
      :empty-text="
        (trailers ?? []).length === 0
          ? 'No trailers yet. Add one, or sync from Samsara.'
          : 'No trailers match these filters.'
      "
      @update:selected="selected = $event"
      @sort="onSort"
      @retry="refetch"
    >
      <!-- The trailer's own page (UF5), as the truck's unit number has always opened the truck's. -->
      <template #cell-unit_number="{ row }">
        <RouterLink :to="`/trailers/${row.id}`" class="font-medium text-link hover:text-link-hover">{{ row.unit_number }}</RouterLink>
      </template>
      <template #cell-file="{ row }">
        <FileCell
          v-if="fileById.get(row.id)"
          :chip="chipById.get(row.id)!"
          :papers="fileById.get(row.id)!.papers ?? []"
          :paper-count="fileById.get(row.id)!.paper_count ?? 0"
          :items="fileById.get(row.id)!.items"
          :subject-label="`Trailer ${row.unit_number}`"
          @open="openGallery(row, $event)"
          @filter="fileFilter = $event"
          @drop="router.push(`/trailers/${row.id}?section=file`)"
        />
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #cell-trailer="{ row }">{{
        [row.year, row.make, row.model].filter(Boolean).join(" ") || "—"
      }}</template>
      <template #cell-trailer_type="{ row }">
        <span v-if="row.trailer_type === 'tanker'" :class="[BADGE_BASE, toneClass('caution')]">Tanker</span>
        <span v-else-if="row.trailer_type" :class="[BADGE_BASE, toneClass('neutral')]">
          {{ TRAILER_TYPE_LABELS[row.trailer_type] }}
        </span>
        <span v-else class="text-xs text-ink-tertiary">Not set</span>
      </template>
      <template #cell-reefer_tank_capacity_gal="{ row }">{{
        row.is_reefer ? row.reefer_tank_capacity_gal + " gal" : "N/A"
      }}</template>
      <template #cell-on_load="{ row }">
        <template v-if="onLoads.byTrailerId.value.get(row.id)">
          {{ vehUnit(onLoads.byTrailerId.value.get(row.id)!.vehicleId) }}
          <span class="block text-xs text-ink-tertiary">Load {{ onLoads.byTrailerId.value.get(row.id)!.ref ?? "—" }}</span>
        </template>
        <span v-else>—</span>
      </template>
      <template #cell-assigned_vehicle_id="{ row }">
        {{ vehUnit(row.assigned_vehicle_id) }}
        <span v-if="gpsPairingNote(row)" class="block text-xs text-ink-tertiary">{{ gpsPairingNote(row) }}</span>
      </template>
      <template #cell-dot_annual_inspection_expires_at="{ row }">
        <span v-if="!fileById.get(row.id)" class="text-ink-tertiary">—</span>
        <InspectionExpiryCell v-else :expires-on="inspection(row).goodUntil" :today="today" />
        <span
          v-if="fileById.get(row.id) && inspection(row).source === 'date_only'"
          class="ml-1 text-xs text-ink-tertiary"
          title="McLeod's date — no paper is filed for it yet"
        >date only</span>
      </template>
      <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
      <template #actions="{ row }">
        <KebabMenu v-if="session.can('equipment')">
          <BaseButton class="kebab-item" @click="openEdit(row)">Edit</BaseButton>
          <BaseButton class="kebab-item" @click="toggleReefer(row)">
            {{ row.is_reefer ? "Unmark reefer" : "Mark as reefer" }}
          </BaseButton>
          <BaseButton
            v-if="row.status !== 'retired' && !statusFromTms(row)"
            class="kebab-item kebab-item-danger"
            @click="onRetire(row)"
          >
            Retire
          </BaseButton>
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

    <SlideOver
      :open="drawerOpen"
      :title="editing ? 'Edit trailer' : 'New trailer'"
      @close="drawerOpen = false"
    >
      <TrailerForm
        :trailer="editing"
        :vehicles="vehicles ?? []"
        @submit="onSubmit"
      />
      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton @click="drawerOpen = false">Cancel</BaseButton>
          <BaseButton form="trailer-form" type="submit" variant="primary" :disabled="saving">
            {{ saving ? "Saving…" : "Save trailer" }}
          </BaseButton>
        </div>
      </template>
    </SlideOver>
  </div>
</template>
