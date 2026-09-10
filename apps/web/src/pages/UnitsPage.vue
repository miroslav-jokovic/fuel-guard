<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { Cog6ToothIcon } from "@silvicom/ui/icons";
import { UNIT_KIND_LABELS, type UnitKitDto } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import KitRulesDrawer from "@/features/inventory/KitRulesDrawer.vue";
import { useUnitsQuery } from "@/features/inventory/useUnits";
import { BADGE_BASE, kitStatusBadge, toneClass } from "@/lib/badges";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
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
 * ── SEARCH AND SORT ARE THE PAGE'S OWN, BECAUSE THE FLEET ARRIVES WHOLE ───────────────────────
 * `/units` is unpaginated — a fleet is a few hundred rows at most and a kit list that stopped at
 * fifty would say "everything else is fine". So, unlike Parts and Assets, this page may filter
 * and order what it holds without presenting a page-local answer as the fleet's. The search is
 * over the unit number, which is the only thing anybody types here.
 *
 * ── THE FILTERS' "EVERYTHING" IS `""` ─────────────────────────────────────────────────────────
 * `FilterSelect` reads any non-empty value as applied. `PartsPage.vue` carries the measurement.
 */

const route = useRoute();
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
];

const search = ref("");
const kind = ref("");
/** The shop home's shortfall card links here with `?kit=short`; the filter is the page's own after that. */
const kit = ref(route.query.kit === "short" ? "short" : "");
watch(kit, (v) => void router.replace({ query: v === "short" ? { kit: "short" } : {} }));

const filter = computed(() => ({
  kind: (kind.value || undefined) as "tractor" | "trailer" | undefined,
  shortOnly: kit.value === "short",
}));
const units = useUnitsQuery(filter);

const sort = ref<SortState>({ key: null, dir: "asc" });
const onSort = (key: string) => (sort.value = toggleSort(sort.value, key));

const rows = computed(() => {
  const term = search.value.trim().toLowerCase();
  const all = units.data.value?.units ?? [];
  const found = term ? all.filter((u) => u.unitNumber.toLowerCase().includes(term)) : all;
  return sortRows(found, sort.value);
});

const COLUMNS: DataTableColumn[] = [
  { key: "unitNumber", label: "Unit", sortable: true, cellClass: "font-mono text-xs text-ink", width: "sm" },
  { key: "kind", label: "Kind", sortable: true, cellClass: "text-ink-secondary" },
  { key: "lines", label: "Kit" },
  { key: "shortBy", label: "Missing", sortable: true, numeric: true },
  { key: "state", label: "Status", sortable: true, width: "sm" },
];

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
      >
        <template #filters>
          <FilterSelect v-model="kind" label="Kind" :options="KIND_OPTIONS" />
          <FilterSelect v-model="kit" label="Kit" :options="KIT_OPTIONS" />
        </template>
      </FilterBar>

      <DataTable
        embedded
        :columns="COLUMNS"
        :rows="rows"
        row-key="unitId"
        :loading="units.isLoading.value"
        :error="units.isError.value ? 'Could not load the fleet' : null"
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
          <p v-else>
            No units yet. Trucks and trailers arrive from the roster — add one there, and its kit
            shows up here.
          </p>
        </template>
      </DataTable>
    </DataWorkspace>

    <KitRulesDrawer :open="rulesOpen" @close="rulesOpen = false" />
  </div>
</template>
