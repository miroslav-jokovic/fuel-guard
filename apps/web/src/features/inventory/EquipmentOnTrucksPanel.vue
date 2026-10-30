<script setup lang="ts">
import { computed, watch } from "vue";
import { useRouter } from "vue-router";
import {
  useQueryState,
  SORT_DIRECTIONS,
  useUrlSort,
  AppButton as BaseButton,
  DataWorkspace,
  FilterBar,
  DataTable,
  type DataTableColumn,
  TablePagination,
  sortRows,
} from "@silvicom/ui";
import { KIT_RULES_SHOWN, type UnitKitDto } from "@silvicom/shared";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import { useUnitsQuery } from "@/features/inventory/useUnits";
import { missingWords, onBoardSentence } from "@/features/inventory/onBoardWords";
import { formatDate } from "@/lib/format";

/**
 * Equipment › Trucks & trailers — one row per truck or trailer and what it carries (MAINTENANCE-SECTION-
 * REDESIGN-PROPOSAL §7a.4, M7, where it was "On trucks"; the owner's R3: "a separate page where we see
 * the equipment assigned to each truck"). Renamed by EA2, which lists by who holds a thing.
 *
 * ── IT OPENS ON THE UNITS CARRYING SOMETHING (EA2) ────────────────────────────────────────────
 * Four hundred units of which a handful carry tagged equipment is a list of "Nothing on board yet",
 * so the tab's own default (`?show=` empty) is the units holding at least one thing — what the owner
 * asked to see. *Every truck and trailer* is one tap away, and is where a unit is found to assign to;
 * the row opens it, where Assign equipment is.
 *
 * ── WHERE "MISSING EQUIPMENT" WENT ────────────────────────────────────────────────────────────
 * It was a group on the Shop page (M2), then a Show option on Trucks & trailers, whose `?show=short`
 * now redirects here as `?show=missing` (`routes/maintenance.ts`). A truck's equipment is asked about
 * HERE; Trucks & trailers still lists "missing equipment" as one of a truck's reasons, from the same
 * server answer (`unitAttention.ts`), because it is one more thing that truck needs.
 *
 * ── THE ROW IS THE KIT READ, WORDED ───────────────────────────────────────────────────────────
 * `/units` already carries every line a unit holds and its shortfall (`deriveKitStatus`, I9), so no
 * endpoint was added: `onBoardWords.ts` words the lines, and the server names a driver only for a
 * truck carrying a tablet (`listUnitKits`, D-DE1). The fleet arrives whole — a few hundred rows — so
 * the panel searches, sorts and pages what it holds, as Trucks & trailers does.
 *
 * "Missing something" and the red "N missing" are Should carry's, and hidden with it (`KIT_RULES_SHOWN`).
 */

const PAGE_SIZE = 20;
const KIND_OPTIONS = [
  { value: "", label: "Trucks and trailers" },
  { value: "tractor", label: "Trucks" },
  { value: "trailer", label: "Trailers" },
];
const SHOW_OPTIONS = [
  { value: "", label: "Carrying something" },
  { value: "all", label: "Every truck and trailer" },
  // R10: a unit somebody walked and found short; the never-checked are short on paper only.
  ...(KIT_RULES_SHOWN ? [{ value: "missing", label: "Missing something" }] : []),
  { value: "never", label: "Never checked" },
];
const carries = (u: UnitKitDto) => u.lines.some((l) => l.held > 0);

const router = useRouter();
const qs = useQueryState();
const search = qs.param("search");
const kind = qs.param("kind", KIND_OPTIONS.map((o) => o.value));
const show = qs.param("show", SHOW_OPTIONS.map((o) => o.value));
const activeFilterCount = computed(() => [search.value.trim(), kind.value, show.value].filter(Boolean).length);
const clearAll = () => qs.set({ search: undefined, kind: undefined, show: undefined });

const filter = computed(() => ({ kind: (kind.value || undefined) as "tractor" | "trailer" | undefined }));
const units = useUnitsQuery(filter);

interface Row extends UnitKitDto {
  carries: string | null;
  missing: string | null;
}
const rows = computed<Row[]>(() => {
  const term = search.value.trim().toLowerCase();
  const all = (units.data.value?.units ?? [])
    .map((u): Row => ({ ...u, carries: onBoardSentence(u), missing: KIT_RULES_SHOWN ? missingWords(u) : null }))
    .filter((u) =>
      show.value === "missing" ? u.missing !== null : show.value === "never" ? u.lastCheckedAt === null : show.value === "all" ? true : carries(u),
    )
    .filter((u) => !term || u.unitNumber.toLowerCase().includes(term));
  return sortRows(all, sort.value) as Row[];
});
const page = qs.page();
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE) as unknown as Record<string, unknown>[]);

const COLUMNS: DataTableColumn[] = [
  { key: "unitNumber", label: "Number", card: "title", sortable: true, cellClass: "font-medium text-ink", width: "sm" },
  // Sorted by how many are missing, so "most missing first" is one tap; the cell says the rest.
  { key: "shortBy", label: "On board", card: "sentence", sortable: true },
  { key: "lastCheckedAt", label: "Last checked", card: "meta", sortable: true, width: "md", cellClass: "text-ink-secondary" },
];
const { sort, onSort } = useUrlSort(
  qs.param("sort", COLUMNS.filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);
watch([search, kind, show, () => sort.value.key, () => sort.value.dir], () => (page.value = 1));

const openUnit = (row: Record<string, unknown>) => {
  const u = row as unknown as UnitKitDto;
  // The URL carries the ROSTER's kind, because that is which table the id is in (a reefer is a trailer).
  void router.push({ name: "unit", params: { kind: u.kind === "tractor" ? "tractor" : "trailer", id: u.unitId }, query: { tab: "equipment" } });
};
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-ink-tertiary">What each truck and trailer carries. Open one to assign more by scanning, or to return something.</p>

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search truck or trailer number…"
        :count="rows.length"
        count-label="trucks and trailers"
        :active-count="activeFilterCount"
        @clear-all="clearAll"
      >
        <template #filters>
          <FilterSelect v-model="show" label="Show" :options="SHOW_OPTIONS" />
          <FilterSelect v-model="kind" label="Kind" :options="KIND_OPTIONS" />
        </template>
      </FilterBar>

      <DataTable
        embedded
        :columns="COLUMNS"
        :rows="pageRows"
        row-key="unitId"
        :loading="units.isLoading.value"
        :error="units.isError.value ? 'Could not load what the trucks carry.' : null"
        :sort="sort"
        :row-class="() => 'cursor-pointer'"
        @sort="onSort"
        @row-click="openUnit"
        @retry="() => units.refetch()"
      >
        <template #cell-shortBy="{ row }">
          <span data-test="on-board">
            <span v-if="(row as unknown as Row).missing" class="font-medium text-danger-700">{{ (row as unknown as Row).missing }} · </span>
            <span v-if="(row as unknown as Row).carries" class="text-ink">{{ (row as unknown as Row).carries }}</span>
            <span v-else class="text-ink-tertiary">Nothing on board yet</span>
          </span>
        </template>
        <template #cell-lastCheckedAt="{ value }">
          <span v-if="value">{{ formatDate(value) }}</span>
          <span v-else class="text-ink-tertiary">Never</span>
        </template>
        <template #actions="{ row }">
          <KebabMenu>
            <BaseButton class="kebab-item" @click="openUnit(row)">Open</BaseButton>
          </KebabMenu>
        </template>
        <template #empty>
          <p v-if="search">No truck or trailer number matches that.</p>
          <p v-else-if="show === 'missing'">Nothing checked is missing anything. Trucks and trailers nobody has checked yet are under Never checked.</p>
          <p v-else-if="show === 'never'">Every truck and trailer has been checked at least once.</p>
          <p v-else-if="!show">
            Nothing is assigned to a truck or trailer yet. Open one — choose Show › Every truck and trailer — and
            press Assign equipment.
          </p>
          <p v-else>No trucks or trailers yet. They arrive from the roster — add one there, and it shows up here.</p>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
