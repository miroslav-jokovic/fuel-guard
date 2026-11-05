<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  AppIcon,
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  DataTable,
  type DataTableColumn,
  DataWorkspace,
  FilterBar,
  BulkActionBar,
  TablePagination,
  sortRows,
  useQueryState,
  SORT_DIRECTIONS,
  useUrlSort,
} from "@silvicom/ui";
import { ArrowDownTrayIcon } from "@silvicom/ui/icons";
import {
  DQ_DUE_FILTERS,
  DQ_EXPORT_MAX_DRIVERS,
  FILE_FILTERS,
  dqDueFilterOptions,
  compareDqUrgency,
  dqSoonest,
  dqWorstRank,
  fileFilterOptions,
  matchesDqFilters,
  type DriverOverviewRow,
  type DqAttentionItem,
  type DqItemState,
  type PaperThumb,
} from "@silvicom/shared";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import FileCell from "@/components/files/FileCell.vue";
import { BADGE_BASE, dqFileBadge, dqItemBadge, toneClass } from "@/lib/badges";
import { useComplianceOverviewQuery } from "@/composables/useCompliance";
import { useToastStore } from "@/stores/toast";
import { useSessionStore } from "@/stores/session";

/**
 * The fleet qualification table — ONE ROW PER DRIVER.
 *
 * The previous queue rendered one row per driver × requirement, so an unseeded ten-driver fleet was
 * nine pages of the same names repeating — thousands of "items" where the real unit of work is a
 * driver whose file needs attention. Here the driver is the row; the requirements are on the file
 * page. Worst file first, ranked by the same shared states the file page computes, so the two
 * surfaces cannot disagree.
 *
 * The File column is the Vehicles and Trailers lists' (DQ-FILE-COLUMN, 2026-11-03): the papers as
 * thumbnails in `FileCell`, opened in the page's one `FileGallery`, and a paper added through the
 * page's one `FileUploadDialog` — by a drop on the cell or "Upload paper" in the row menu. It replaced
 * an expand chevron whose detail rows repeated the Status column in longer words and then sent the
 * reader to the file page for anything they could act on. The table emits; the page owns both
 * dialogs, as `DriversPage` does.
 */
const PAGE_SIZE = 20;

const props = defineProps<{
  /** True while the page's binder request is in flight — disables the build button. */
  building?: boolean;
}>();
const emit = defineEmits<{
  "build-binder": [driverIds: string[], includeRestricted: boolean];
  /** Open the gallery on this driver's papers — on one paper, or with no id for "+N". */
  "open-file": [row: FleetRow, documentId?: string];
  /** Add a paper to this driver's file — with the scan when it was dropped on the cell. */
  upload: [row: FleetRow, file?: File];
}>();

const toast = useToastStore();
const session = useSessionStore();
const query = useComplianceOverviewQuery();
/** Filing a paper is the roster section's write, as on the file page (`QualificationSection`). */
const canUpload = computed(() => session.can("roster"));

/** Phase G (D-DQ15): the default binder carries no §382.401/§391.53 evidence. Only a privileged
 *  role sees the opt-in, and the ask is recorded on the export ledger server-side. */
const includeRestricted = ref(false);

/**
 * Binder selection lives with the table it selects from (the old design hid it on a different tab
 * than the queue, and the Exports empty state had to explain where to look). The page only runs
 * the request; the cap and the bar are the table's concern.
 */
const selected = ref<Set<string>>(new Set());
const atCap = computed(() => selected.value.size >= DQ_EXPORT_MAX_DRIVERS);
function setSelected(next: Set<string>): void {
  if (next.size <= DQ_EXPORT_MAX_DRIVERS) {
    selected.value = next;
    return;
  }
  selected.value = new Set([...next].slice(0, DQ_EXPORT_MAX_DRIVERS));
  toast.warning(
    "Binder limit reached",
    `A binder can contain up to ${DQ_EXPORT_MAX_DRIVERS} drivers. Build this binder, then select the remaining drivers.`,
  );
}
function buildBinder(): void {
  if (selected.value.size === 0) return;
  emit("build-binder", [...selected.value], session.restrictedAccess && includeRestricted.value);
  selected.value = new Set();
  includeRestricted.value = false;
}

// Search, both filters, the sort and the page live in the URL (D-US2), so Back from a driver's file
// returns to the same narrowed list. Unscoped: this is the only list on the qualification route (the
// Exports tab beside it keeps no list state). The filters are checked against the shared vocabulary
// (R4b) rather than a copy of it, so a hand-edited `?file=` outside it reads as no filter. The file
// word is the File chip's, the vocabulary every list that shows a file filters by (Q-UF9); before it
// this table's `?state=` meant "has ANY item in this state", the Drivers page's retired `?dq=`.
const qs = useQueryState();
const search = qs.param("search");
const fileFilter = qs.param("file", FILE_FILTERS);
const dueFilter = qs.param("due", DQ_DUE_FILTERS);
const page = qs.page();

// The page's attention strip (C5) writes the same two parameters, so the tiles and these controls are
// one filter model — the URL — with nothing mirrored between them (D-US2).

export interface FleetRow {
  id: string;
  driver_name: string;
  driver_status: string;
  state: "not_started" | "incomplete" | "complete";
  counts: Record<DqItemState, number>;
  attention: DqAttentionItem[];
  /** Carried so this row satisfies the shared filter predicate; unused by this table's own controls. */
  requirements: DriverOverviewRow["requirements"];
  /** The File cell's thumbnails and its "+N" count. */
  papers: PaperThumb[];
  paper_count: number;
  /** Sort rank: the file's worst state. Expired files first, complete files last. */
  worst: number;
  /** Days until the most urgent dated item — negative when overdue, null when nothing is dated. */
  soonest: number | null;
}


const all = computed<FleetRow[]>(() =>
  (query.data.value?.drivers ?? []).map((d) => {
    return {
      id: d.driver_id,
      driver_name: d.driver_name,
      driver_status: d.driver_status,
      state: d.state,
      counts: d.counts,
      attention: d.attention,
      requirements: d.requirements,
      papers: d.papers ?? [],
      paper_count: d.paper_count ?? 0,
      worst: dqWorstRank(d),
      soonest: dqSoonest(d),
    };
  }),
);

// The words and the values both live in `@silvicom/shared` (R4b): the roster shows the same two
// filters, and a filter that means the same thing on two pages must say the same thing on both.
const fileOptions = fileFilterOptions();
const dueOptions = dqDueFilterOptions();

const filtered = computed(() =>
  all.value.filter((r) => {
    // The vocabulary lives in `@silvicom/shared` (R4b): the roster applies the SAME predicate, and
    // two copies of "is this driver behind on their §391.51 file" is exactly the drift D-DQ6 forbids.
    if (!matchesDqFilters(r, { file: fileFilter.value, due: dueFilter.value })) return false;
    const t = search.value.trim().toLowerCase();
    if (t && !r.driver_name.toLowerCase().includes(t)) return false;
    return true;
  }),
);

/**
 * Default order: worst file first, most urgent date first within a state, then name — the shared
 * `compareDqUrgency`, which the Drivers page's File column sorts by too (DQ-INTO-DRIVERS-PLAN DD1).
 */
function bySeverity(a: FleetRow, b: FleetRow): number {
  return compareDqUrgency(a, b) || a.driver_name.localeCompare(b.driver_name);
}

const sorted = computed(() =>
  sort.value.key
    ? sortRows(filtered.value, sort.value, (row, key) => row[key as keyof FleetRow] as never)
    : [...filtered.value].sort(bySeverity),
);
const pageRows = computed(() =>
  sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);
watch([search, fileFilter, dueFilter], () => (page.value = 1));

const activeFilterCount = computed(
  () => [search.value.trim(), fileFilter.value, dueFilter.value].filter(Boolean).length,
);
function clearFilters(): void {
  qs.set({ search: undefined, file: undefined, due: undefined });
}

/** The one-glance file summary in the D4 vocabulary: "5 blocked · 1 expiring", or a single word.
 *  Expired vs missing survives on the file page and in the upload dialog, where each item says which it is. */
const fileChips = (row: FleetRow): Array<{ text: string; tone: string }> => {
  const chips: Array<{ text: string; tone: string }> = [];
  const blocked = row.counts.expired + row.counts.missing;
  if (blocked > 0) chips.push({ text: `${blocked} blocked`, tone: dqItemBadge("expired").tone });
  if (row.counts.expiring > 0)
    chips.push({ text: `${row.counts.expiring} expiring`, tone: dqItemBadge("expiring").tone });
  return chips;
};

function dueText(days: number | null): string {
  if (days === null) return "";
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue`;
  if (days === 0) return "today";
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/** "Medical card — 3 days overdue": the single most urgent thing about this driver. */
function nextDue(row: FleetRow): string | null {
  const first = row.attention.find((a) => a.daysRemaining !== null);
  if (!first) return null;
  return `${first.label} — ${dueText(first.daysRemaining)}`;
}

const columns: DataTableColumn[] = [
  {
    key: "driver_name",
    label: "Driver",
    sortable: true,
    width: "xl",
    cellClass: "font-medium text-ink",
  },
  { key: "file", label: "File", width: "lg" },
  { key: "status", label: "Status", width: "xl" },
  {
    key: "soonest",
    label: "Next due",
    sortable: true,
    width: "xl",
    cellClass: "text-ink-secondary",
  },
];
// No default key: unsorted IS the severity order (`bySeverity`), so the third click returns to it.
const { sort, onSort } = useUrlSort(
  qs.param("sort", columns.filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);
</script>

<template>
  <div class="space-y-6">
    <DataWorkspace>
    <FilterBar
      v-model:search="search"
      embedded
      search-placeholder="Search drivers…"
      :count="filtered.length"
      count-label="drivers"
      :active-count="activeFilterCount"
      @clear-all="clearFilters"
    >
      <template #filters>
        <FilterSelect v-model="fileFilter" label="File" :options="fileOptions" />
        <FilterSelect v-model="dueFilter" label="Due" :options="dueOptions" />
      </template>
    </FilterBar>

    <p v-if="query.data.value?.truncated" class="bg-warning-50 px-4 py-3 text-sm text-warning-700 sm:px-6">
      This picture is partial — the fleet has more qualification records than one read returns.
      Narrow the filters, or tell us so we can page it.
    </p>

    <BulkActionBar :count="selected.size" @clear="selected = new Set()">
      <template v-if="atCap" #note>
        That is the most drivers one binder holds. Send the rest as a second binder.
      </template>
      <BaseCheckbox v-if="session.restrictedAccess" v-model="includeRestricted">
        Include restricted records
      </BaseCheckbox>
      <BaseButton variant="primary" size="sm" :disabled="props.building" @click="buildBinder">
        <AppIcon :icon="ArrowDownTrayIcon" class="size-4" aria-hidden="true" />
        {{ props.building ? "Building…" : "Build audit binder" }}
      </BaseButton>
    </BulkActionBar>

    <DataTable
      embedded
      :columns="columns"
      :rows="pageRows"
      row-key="id"
      selectable
      :selected="selected"
      :loading="query.isLoading.value"
      :error="
        query.isError.value
          ? 'Could not load the qualification picture.'
          : null
      "
      :retrying="query.isFetching.value"
      :sort="sort"
      :empty-text="
        all.length === 0
          ? 'No active drivers yet. Add drivers on the Fleet page, or sync from Samsara.'
          : 'No drivers match these filters.'
      "
      @update:selected="setSelected"
      @sort="onSort"
      @retry="query.refetch()"
    >
      <template #cell-driver_name="{ row }">
        <RouterLink :to="`/compliance/${row.id}`" class="font-medium text-link hover:text-link-hover">
          {{ row.driver_name }}
        </RouterLink>
        <span
          v-if="row.driver_status !== 'active'"
          :class="['ml-2', BADGE_BASE, toneClass('neutral')]"
        >
          {{ row.driver_status.replace("_", " ") }}
        </span>
      </template>
      <template #cell-file="{ row }">
        <FileCell
          :papers="row.papers"
          :paper-count="row.paper_count"
          :items="row.requirements"
          :subject-label="row.driver_name"
          @open="emit('open-file', row, $event)"
          @drop="canUpload && emit('upload', row, $event[0])"
        />
      </template>
      <template #cell-status="{ row }">
        <span
          v-if="row.state !== 'incomplete'"
          :class="[BADGE_BASE, toneClass(dqFileBadge(row.state).tone)]"
          >{{ dqFileBadge(row.state).label }}</span
        >
        <span v-else class="inline-flex flex-wrap items-center gap-1.5">
          <span
            v-for="chip in fileChips(row)"
            :key="chip.text"
            :class="[BADGE_BASE, toneClass(chip.tone)]"
            >{{ chip.text }}</span
          >
        </span>
      </template>
      <template #cell-soonest="{ row }">
        <span v-if="nextDue(row)">{{ nextDue(row) }}</span>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #actions="{ row }">
        <KebabMenu>
          <BaseButton class="kebab-item" @click="emit('open-file', row)">View papers</BaseButton>
          <BaseButton v-if="canUpload" class="kebab-item" @click="emit('upload', row)">Upload paper…</BaseButton>
          <RouterLink :to="`/compliance/${row.id}`" class="kebab-item">Open qualification file…</RouterLink>
        </KebabMenu>
      </template>
      <template #footer>
        <TablePagination
          :page="page"
          :page-size="PAGE_SIZE"
          :total="filtered.length"
          :loading="query.isFetching.value"
          @update:page="page = $event"
        />
      </template>
    </DataTable>
    </DataWorkspace>
  </div>
</template>
