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
import KitRulesDrawer from "@/features/inventory/KitRulesDrawer.vue";
import { useUnitsQuery } from "@/features/inventory/useUnits";
import { BADGE_BASE, kitStatusBadge, toneClass } from "@/lib/badges";
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
 */

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const KIND_OPTIONS = [
  { value: "all", label: "Trucks and trailers" },
  { value: "tractor", label: "Trucks" },
  { value: "trailer", label: "Trailers" },
];
const KIT_OPTIONS = [
  { value: "all", label: "Every unit" },
  { value: "short", label: "Short of something" },
];

const kind = ref("all");
/** The shop home's shortfall card links here with `?kit=short`; the filter is the page's own after that. */
const kit = ref(route.query.kit === "short" ? "short" : "all");
watch(kit, (v) => void router.replace({ query: v === "short" ? { kit: "short" } : {} }));

const filter = computed(() => ({
  kind: kind.value === "all" ? undefined : (kind.value as "tractor" | "trailer"),
  shortOnly: kit.value === "short",
}));
const units = useUnitsQuery(filter);

const COLUMNS: DataTableColumn[] = [
  { key: "unitNumber", label: "Unit", cellClass: "font-mono text-xs text-ink", width: "sm" },
  { key: "kind", label: "Kind", cellClass: "text-ink-secondary" },
  { key: "lines", label: "Kit" },
  { key: "shortBy", label: "Missing", numeric: true },
  { key: "state", label: "Status", width: "sm" },
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
        <BaseButton v-if="session.can('maintenance')" aria-label="Kit rules" @click="rulesOpen = true">
          <AppIcon :icon="Cog6ToothIcon" class="size-5" aria-hidden="true" />
        </BaseButton>
      </template>
    </PageHeader>

    <DataWorkspace>
      <FilterBar embedded :count="units.data.value?.total ?? 0" count-label="units">
        <template #filters>
          <FilterSelect v-model="kind" label="Kind" :options="KIND_OPTIONS" />
          <FilterSelect v-model="kit" label="Kit" :options="KIT_OPTIONS" />
        </template>
      </FilterBar>

      <DataTable
        embedded
        :columns="COLUMNS"
        :rows="units.data.value?.units ?? []"
        row-key="unitId"
        :loading="units.isLoading.value"
        :error="units.isError.value ? 'Could not load the fleet' : null"
        :row-class="() => 'cursor-pointer'"
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
        <!-- `[BADGE_BASE, toneClass(...)]` and NOT `AppBadge`: "Extra items" is two words, and that
             primitive carries `capitalize`, which title-cased "In repair" on a real page at I8. -->
        <template #cell-state="{ value }">
          <span v-if="kitStatusBadge(value)" :class="[BADGE_BASE, toneClass(kitStatusBadge(value)!.tone)]">
            {{ kitStatusBadge(value)!.label }}
          </span>
          <span v-else class="text-ink-tertiary">—</span>
        </template>
        <template #empty>
          <p v-if="kit === 'short'">
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
