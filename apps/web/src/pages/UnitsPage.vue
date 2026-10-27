<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  useQueryState,
  SORT_DIRECTIONS,
  useUrlSort,
  AppButton as BaseButton,
  AppIcon,
  DataWorkspace,
  FilterBar,
  DataTable,
  type DataTableColumn,
  TablePagination,
  sortRows,
} from "@silvicom/ui";
import { Cog6ToothIcon } from "@silvicom/ui/icons";
import { UNIT_KIND_LABELS, type UnitKitDto } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import KitRulesDrawer from "@/features/inventory/KitRulesDrawer.vue";
import { useUnitsQuery } from "@/features/inventory/useUnits";
import { BADGE_BASE, kitStatusBadge, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import { useSessionStore } from "@/stores/session";

/**
 * Units — every active truck and trailer, against the kit it is supposed to carry
 * (INVENTORY-PLAN.md I9, D-INV12).
 *
 * ── IT IS THE ASSETS LIST READ FROM THE OTHER END ─────────────────────────────────────────────
 * `/shop/assets` answers "where is A-0412". This page answers "what is truck 654 missing", which is
 * the question a yard walk actually starts from. Same rows underneath; the difference is which side
 * the reader is standing on, and that is why it is a page rather than a filter on the other one.
 *
 * ── EVERY NUMBER ON THIS SCREEN CAME FROM THE API ─────────────────────────────────────────────
 * `deriveKitStatus` runs once, on the server, and this page renders its answer. Nothing here
 * recomputes `held − expected` from the lines — that is I9's done-when, and the way it stays true is
 * that there is no arithmetic in this file at all.
 *
 * ── THE SHORTFALL COLUMN COUNTS THINGS, NOT LINES ─────────────────────────────────────────────
 * A trailer missing two straps and a chain is short by THREE. `shortBy` is what the shop home
 * counts and what somebody loads into a truck before driving out to the yard; the number of lines
 * is a fact about the table, not about the walk.
 *
 * ── SEARCH, SORT AND PAGING ARE THE PAGE'S OWN, BECAUSE THE FLEET ARRIVES WHOLE ───────────────
 * `/units` is unpaginated — a fleet is a few hundred rows at most and a kit list that stopped at
 * fifty would say "everything else is fine". So, unlike Parts and Assets, this page may filter,
 * order and page what it holds without presenting a page-local answer as the fleet's: the count in
 * the toolbar is the whole answer, and the footer pages the same list twenty at a time, the way
 * `TrailersPage.vue` and `VehiclesPage.vue` page the roster the fleet came from. The search is over
 * the unit number, which is the only thing anybody types here.
 *
 * The unit number is `font-medium text-ink`, the identity-column tone every roster list uses for
 * it. It shipped in `font-mono`, which the product reserves for machine identifiers — decal serials,
 * barcodes — and a truck number is what somebody says across a yard, not a machine's.
 *
 * ── THE FILTERS' "EVERYTHING" IS `""` ─────────────────────────────────────────────────────────
 * `FilterSelect` reads any non-empty value as applied. `PartsPage.vue` carries the measurement.
 */

const router = useRouter();
const session = useSessionStore();

const KIND_OPTIONS = [
  { value: "", label: "Trucks and trailers" },
  { value: "tractor", label: "Trucks" },
  { value: "trailer", label: "Trailers" },
];
const KIT_OPTIONS = [
  { value: "", label: "Every unit" },
  { value: "short", label: "Short of something" },
  // R10: the shop home's "Short of kit" tile links here. While a fleet is being tagged every unit is
  // short on paper; a unit somebody has walked and found short is the one worth the trip.
  { value: "short-checked", label: "Short, and checked" },
];

const PAGE_SIZE = 20;

// Filters, sort and page live in the URL (D-US2). The shop home's shortfall card links here with
// `?kit=short`, and that link is now simply this parameter rather than a one-time seed the page
// mirrored back by hand — so it also survives a reload and Back from a unit. Each `allowed` list is
// read off its options, never retyped.
const qs = useQueryState();
const search = qs.param("search");
const kind = qs.param("kind", KIND_OPTIONS.map((o) => o.value));
const kit = qs.param("kit", KIT_OPTIONS.map((o) => o.value));

const activeFilterCount = computed(() => [search.value.trim(), kind.value, kit.value].filter(Boolean).length);
function resetFilters() {
  qs.set({ search: undefined, kind: undefined, kit: undefined });
}

const filter = computed(() => ({
  kind: (kind.value || undefined) as "tractor" | "trailer" | undefined,
  shortOnly: kit.value === "short" || kit.value === "short-checked",
  checkedOnly: kit.value === "short-checked",
}));
const units = useUnitsQuery(filter);

const rows = computed(() => {
  const term = search.value.trim().toLowerCase();
  const all = units.data.value?.units ?? [];
  const found = term ? all.filter((u) => u.unitNumber.toLowerCase().includes(term)) : all;
  return sortRows(found, sort.value);
});

const page = qs.page();
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const COLUMNS: DataTableColumn[] = [
  { key: "unitNumber", label: "Unit", sortable: true, cellClass: "font-medium text-ink", width: "sm" },
  { key: "kind", label: "Kind", sortable: true, cellClass: "text-ink-secondary" },
  { key: "lines", label: "Kit" },
  { key: "shortBy", label: "Missing", sortable: true, numeric: true },
  { key: "state", label: "Status", sortable: true, width: "sm" },
  { key: "lastCheckedAt", label: "Last checked", cellClass: "text-ink-secondary" },
];
const { sort, onSort } = useUrlSort(
  qs.param("sort", COLUMNS.filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);
// The sort is watched by its two strings, not as the `sort` object: a re-sort returns to page 1, and
// nothing but a re-sort may — a pasted `?page=2&sort=…` has to land on page 2.
watch([search, kind, kit, () => sort.value.key, () => sort.value.dir], () => (page.value = 1));

/** "3 of 5 kinds carried" — what the row is about, in the words the reader is looking for. */
const carried = (u: UnitKitDto) => u.lines.filter((l) => l.expected > 0 && l.delta >= 0).length;
const expectedKinds = (u: UnitKitDto) => u.lines.filter((l) => l.expected > 0).length;

const openUnit = (row: Record<string, unknown>) => {
  const u = row as unknown as UnitKitDto;
  void router.push({
    name: "unit",
    // The URL carries the ROSTER's kind, because that is which table the id is in. A reefer is a
    // trailer as far as the fleet tables are concerned; `unitKindOf` draws the kit distinction.
    params: { kind: u.kind === "tractor" ? "tractor" : "trailer", id: u.unitId },
  });
};

const rulesOpen = ref(false);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="What every truck and trailer is supposed to be carrying, and what it is missing.">
      <template #actions>
        <!-- Worded, not an icon-only gear — `PartsPage.vue` records why. This is the page's only
             action, and an unlabelled one was the whole of its header. -->
        <BaseButton v-if="session.can('maintenance')" @click="rulesOpen = true">
          <AppIcon :icon="Cog6ToothIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Kit rules
        </BaseButton>
      </template>
    </PageHeader>

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search unit number…"
        :count="rows.length"
        count-label="units"
        :active-count="activeFilterCount"
        @clear-all="resetFilters"
      >
        <template #filters>
          <FilterSelect v-model="kind" label="Kind" :options="KIND_OPTIONS" />
          <FilterSelect v-model="kit" label="Kit" :options="KIT_OPTIONS" />
        </template>
      </FilterBar>

      <DataTable
        embedded
        :columns="COLUMNS"
        :rows="pageRows"
        row-key="unitId"
        :loading="units.isLoading.value"
        :error="units.isError.value ? 'Could not load the fleet.' : null"
        :sort="sort"
        :row-class="() => 'cursor-pointer'"
        @sort="onSort"
        @row-click="openUnit"
        @retry="() => units.refetch()"
      >
        <template #cell-kind="{ value }">{{ UNIT_KIND_LABELS[value as keyof typeof UNIT_KIND_LABELS] }}</template>
        <template #cell-lines="{ row }">
          <span v-if="expectedKinds(row)" class="text-ink-secondary">
            {{ carried(row) }} of {{ expectedKinds(row) }} carried
          </span>
          <span v-else class="text-ink-tertiary">Nothing expected yet</span>
        </template>
        <template #cell-shortBy="{ value }">
          <span v-if="value > 0" class="font-semibold text-danger-700">{{ value }}</span>
          <span v-else class="text-ink-tertiary">—</span>
        </template>
        <!-- `[BADGE_BASE, toneClass(...)]`: the rule `apps/web/CLAUDE.md` states for every badge. -->
        <template #cell-state="{ value }">
          <span v-if="kitStatusBadge(value)" :class="[BADGE_BASE, toneClass(kitStatusBadge(value)!.tone)]">
            {{ kitStatusBadge(value)!.label }}
          </span>
          <span v-else class="text-ink-tertiary">—</span>
        </template>
        <template #cell-lastCheckedAt="{ value }">
          <span v-if="value">{{ formatDate(value) }}</span>
          <span v-else class="text-ink-tertiary">Never</span>
        </template>
        <template #actions="{ row }">
          <KebabMenu>
            <BaseButton class="kebab-item" @click="openUnit(row)">Open unit</BaseButton>
          </KebabMenu>
        </template>
        <template #empty>
          <p v-if="search">No unit number matches that.</p>
          <p v-else-if="kit === 'short'">
            Nothing is short. Every truck and trailer is carrying what its kit asks for.
          </p>
          <p v-else-if="kit === 'short-checked'">
            Nothing checked is short. Units nobody has checked yet are not counted here.
          </p>
          <p v-else>
            No units yet. Trucks and trailers arrive from the roster — add one there, and its kit
            shows up here.
          </p>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>

    <KitRulesDrawer :open="rulesOpen" @close="rulesOpen = false" />
  </div>
</template>
