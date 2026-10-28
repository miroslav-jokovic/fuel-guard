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
import { repairSettled, type RoadsideRepairDueDto, type UnitAttentionDto, type UnitKitDto } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import { useUnitsQuery } from "@/features/inventory/useUnits";
import { attentionSentence } from "@/features/maintenance/attentionWords";
import { useUnitsAttentionQuery } from "@/features/maintenance/useUnitShop";
import { useRoadsideRepairsDueQuery } from "@/features/roadside/useRoadsideInspections";
import { useOpens } from "@/composables/useOpens";
import { formatDate } from "@/lib/format";

/**
 * Trucks & trailers — the fleet, opened on what needs attention (MAINTENANCE-SECTION-REDESIGN-
 * PROPOSAL.md §4.3, M3; D-MX2, D-MX5). Until M3 this was the kit list (INVENTORY-PLAN.md I9) — every
 * unit with "Kind", "Should carry", "Missing" — and on a phone it ran 4,435 px of five-line cards
 * listing sold trucks (§1.2). Now a row is THREE facts: the number, the one sentence that put it on
 * the list, and when it was last checked; and the list opens filtered to units with a row on the
 * Shop worklist, with "every truck and trailer" one tap away.
 *
 * ── THE SENTENCE IS THE SERVER'S, AND THE TRUCK'S PAGE SAYS THE SAME ONE ──────────────────────
 * `/units/attention` derives each unit's reasons once (`unitAttention.ts`); this page words the first
 * (`attentionWords.ts`) and the truck's page words them all, from the same cached read — so the list
 * never names a reason the page then cannot find. Roadside repairs due are merged here by the unit
 * the officer wrote (D-IC7), as the roadside card does, because FMCSA's record carries no roster id.
 *
 * ── EVERY NUMBER ON THIS SCREEN CAME FROM THE API ─────────────────────────────────────────────
 * The kit's shortfall is `deriveKitStatus`'s (I9's done-when); nothing here recomputes it.
 *
 * ── SEARCH, SORT AND PAGING ARE THE PAGE'S OWN, BECAUSE THE FLEET ARRIVES WHOLE ───────────────
 * `/units` is unpaginated — a fleet is a few hundred rows at most — so the page may filter, order and
 * page what it holds without presenting a page-local answer as the fleet's. The filters live in the
 * URL (D-US2): no `?show=` at all is "needs attention" — the parameter's fallback, so the default view
 * is the URL a reader lands on. "Missing equipment" (`?show=short`) moved to Equipment's On trucks tab
 * in M7 (§7a.4); the route redirects the old address there.
 */
const router = useRouter();
const opens = useOpens();

const KIND_OPTIONS = [
  { value: "", label: "Trucks and trailers" },
  { value: "tractor", label: "Trucks" },
  { value: "trailer", label: "Trailers" },
];
const SHOW_OPTIONS = [
  { value: "attention", label: "Needs attention" },
  { value: "all", label: "Every truck and trailer" },
];
const PAGE_SIZE = 20;

const qs = useQueryState();
const search = qs.param("search");
const kind = qs.param("kind", KIND_OPTIONS.map((o) => o.value));
/** No `?show=` means "needs attention" — the list opens on it (§4.3); `?show=all` is the explicit everything. */
const show = qs.param("show", SHOW_OPTIONS.map((o) => o.value), "attention");
const activeFilterCount = computed(() => [search.value.trim(), kind.value].filter(Boolean).length + (show.value !== "attention" ? 1 : 0));
function resetFilters() {
  qs.set({ search: undefined, kind: undefined, show: undefined });
}

// ── the reads ──────────────────────────────────────────────────────────────────────────────────
const filter = computed(() => ({ kind: (kind.value || undefined) as "tractor" | "trailer" | undefined }));
const units = useUnitsQuery(filter);
const attentionQ = useUnitsAttentionQuery();
const roadsideOpen = computed(() => opens("/shop/roadside-repairs"));
const roadsideQ = useRoadsideRepairsDueQuery(roadsideOpen);

const rosterKind = (u: UnitKitDto): "tractor" | "trailer" => (u.kind === "tractor" ? "tractor" : "trailer");
const reasonsOf = computed(() => new Map((attentionQ.data.value ?? []).map((a: UnitAttentionDto) => [`${a.kind}:${a.unitId}`, a.reasons])));
const roadsideOf = computed(() => {
  const m = new Map<string, RoadsideRepairDueDto>();
  for (const r of roadsideQ.data.value ?? []) {
    if (repairSettled(r) || !r.unit.companyNumber) continue;
    const key = `${r.unit.kind}:${r.unit.companyNumber}`;
    if (!m.has(key)) m.set(key, r);
  }
  return m;
});

interface Row extends UnitKitDto {
  rosterKind: "tractor" | "trailer";
  /** The one sentence, or null when nothing is on the list for this unit. */
  needs: string | null;
  urgent: boolean;
}
const rows = computed<Row[]>(() => {
  const term = search.value.trim().toLowerCase();
  const all = (units.data.value?.units ?? []).map((u): Row => {
    const rk = rosterKind(u);
    const roadside = roadsideOf.value.get(`${rk}:${u.unitNumber}`);
    const reasons = reasonsOf.value.get(`${rk}:${u.unitId}`) ?? [];
    const first = reasons[0];
    const needs = roadside ? "Roadside violations to repair and certify" : first ? attentionSentence(first) : null;
    const urgent = Boolean(roadside) || (first?.kind === "annual" && first.daysRemaining < 0) || (first?.kind === "pm" && first.verdict === "overdue");
    return { ...u, rosterKind: rk, needs, urgent };
  });
  const shown = all.filter((u) => show.value === "all" || u.needs !== null);
  const found = term ? shown.filter((u) => u.unitNumber.toLowerCase().includes(term)) : shown;
  return sortRows(found, sort.value) as Row[];
});
const page = qs.page();
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE) as unknown as Record<string, unknown>[]);

const COLUMNS: DataTableColumn[] = [
  { key: "unitNumber", label: "Number", card: "title", sortable: true, cellClass: "font-medium text-ink", width: "sm" },
  { key: "needs", label: "Needs", card: "sentence" },
  { key: "lastCheckedAt", label: "Last checked", card: "meta", sortable: true, width: "md", cellClass: "text-ink-secondary" },
];
const { sort, onSort } = useUrlSort(
  qs.param("sort", COLUMNS.filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);
watch([search, kind, show, () => sort.value.key, () => sort.value.dir], () => (page.value = 1));

const loading = computed(() => units.isLoading.value || attentionQ.isPending.value);
const error = computed(() =>
  units.isError.value ? "Could not load the fleet." : attentionQ.isError.value ? "Could not load what needs attention." : null,
);
const openUnit = (row: Record<string, unknown>) => {
  const u = row as unknown as UnitKitDto;
  // The URL carries the ROSTER's kind, because that is which table the id is in (a reefer is a trailer).
  void router.push({ name: "unit", params: { kind: rosterKind(u), id: u.unitId } });
};
</script>

<template>
  <div class="space-y-6">
    <!-- What each truck should carry moved to Equipment's On trucks tab with Missing equipment (M7). -->
    <PageHeader description="Every truck and trailer, opened on what needs the shop's attention." />

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search truck or trailer number…"
        :count="rows.length"
        count-label="trucks and trailers"
        :active-count="activeFilterCount"
        @clear-all="resetFilters"
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
        :loading="loading"
        :error="error"
        :sort="sort"
        :row-class="() => 'cursor-pointer'"
        @sort="onSort"
        @row-click="openUnit"
        @retry="() => { units.refetch(); attentionQ.refetch(); }"
      >
        <template #cell-needs="{ row }">
          <span v-if="(row as unknown as Row).needs" :class="(row as unknown as Row).urgent ? 'font-medium text-danger-700' : 'text-ink'">{{ (row as unknown as Row).needs }}</span>
          <span v-else class="text-ink-tertiary">Nothing today</span>
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
          <p v-else-if="show === 'attention'">Nothing needs the shop's attention today. Every truck and trailer is one tap away under Show.</p>
          <p v-else>No trucks or trailers yet. They arrive from the roster — add one there, and it shows up here.</p>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>

  </div>
</template>
