<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { AppButton as BaseButton, AppCard as BaseCard } from "@silvicom/ui";
import {
  KIT_EXPECTATION_SOURCE_LABELS,
  UNIT_KIND_LABELS,
  type AssetDto,
  type UnitKitLineDto,
} from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import AssetMoveDrawer from "@/features/inventory/AssetMoveDrawer.vue";
import UnitOverrideDrawer from "@/features/inventory/UnitOverrideDrawer.vue";
import { useUnitKitQuery } from "@/features/inventory/useUnits";
import { useLocationsQuery } from "@/features/inventory/useInventory";
import { BADGE_BASE, kitStatusBadge, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";

/**
 * One unit: what it should carry, what it does, and who has it (INVENTORY-PLAN.md I9).
 *
 * ── TWO TABLES, BECAUSE THEY ANSWER TWO QUESTIONS ─────────────────────────────────────────────
 * The KIT is by kind of thing — "two load bars expected, one held" — and is what a yard walk is
 * planned from. The ASSETS are the individual things with numbers on them, and are what a person
 * standing at the truck actually touches. Folding them into one table would mean either losing the
 * shortfall (which has no single asset behind it) or repeating the expectation on every row.
 *
 * ── REMOVING SOMETHING IS A MOVE, NOT A DELETE ────────────────────────────────────────────────
 * "Take it off this truck" is `move_asset` with a destination, because an asset is always somewhere
 * and a row that stopped naming a holder without a movement would leave the ledger unable to say
 * where the thing went. The drawer is `AssetMoveDrawer` — the same one the asset page opens, so
 * both paths write the same row through the same door (D-INV3).
 */

const route = useRoute();
const session = useSessionStore();

const kind = computed(() => (String(route.params.kind ?? "") === "tractor" ? "tractor" : "trailer") as "tractor" | "trailer");
const unitId = computed(() => String(route.params.id ?? ""));

const { data, isLoading, isError, error, refetch } = useUnitKitQuery(kind, unitId);
const unit = computed(() => data.value?.unit ?? null);
const assets = computed<AssetDto[]>(() => data.value?.assets ?? []);
const canManage = computed(() => session.can("maintenance"));

/** Active only: a move into a bay that has been closed is refused by 0333 (`IV012`). */
const { data: locations } = useLocationsQuery();

const moving = ref<AssetDto | null>(null);
const overriding = ref(false);

const KIT_COLUMNS: DataTableColumn[] = [
  { key: "assetTypeName", label: "What it should carry" },
  { key: "expected", label: "Expected", numeric: true },
  { key: "held", label: "On the unit", numeric: true },
  { key: "delta", label: "Difference", numeric: true },
  { key: "source", label: "Rule from", cellClass: "text-ink-tertiary" },
];

const ASSET_COLUMNS: DataTableColumn[] = [
  { key: "displayNo", label: "Number", cellClass: "font-mono text-xs text-ink", width: "sm" },
  { key: "name", label: "What it is" },
  { key: "assetTypeName", label: "Kind", cellClass: "text-ink-secondary" },
  { key: "serialNumber", label: "Serial", cellClass: "font-mono text-xs text-ink-tertiary" },
];

/** Only the lines worth a row: expected here, or actually carried and unexpected. */
const kitLines = computed<UnitKitLineDto[]>(() =>
  (unit.value?.lines ?? []).filter((l) => l.expected > 0 || l.held > 0),
);
</script>

<template>
  <div class="space-y-6">
    <!-- D-INV3: the driver is read off the truck at the moment somebody looks and is stored
         nowhere. Null for a trailer, because whoever is pulling it today is a different question
         with a different answer — and said ONCE, in the header. A real render carried it twice,
         which reads as two facts about two moments rather than one fact stated plainly. -->
    <PageHeader
      :title="unit ? `${UNIT_KIND_LABELS[unit.kind]} ${unit.unitNumber}` : 'Unit'"
      :description="unit?.inferredDriverName ? `Assigned to ${unit.inferredDriverName} right now` : undefined"
    >
      <template v-if="unit && canManage" #actions>
        <BaseButton @click="overriding = true">Kit for this unit</BaseButton>
      </template>
    </PageHeader>

    <BaseCard v-if="isError" padding="md">
      <p class="text-sm text-ink">
        {{ error instanceof Error ? error.message : "Could not load the unit." }}
      </p>
      <BaseButton class="mt-3" @click="() => refetch()">Try again</BaseButton>
    </BaseCard>

    <template v-else-if="unit">
      <BaseCard padding="md">
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p class="text-sm text-ink">
              <span v-if="unit.shortBy">Missing {{ unit.shortBy }}</span>
              <span v-else-if="unit.extraBy">Carrying {{ unit.extraBy }} more than the kit asks for</span>
              <span v-else>Carrying everything the kit asks for</span>
            </p>
          </div>
          <span
            v-if="kitStatusBadge(unit.state)"
            :class="[BADGE_BASE, toneClass(kitStatusBadge(unit.state)!.tone)]"
          >
            {{ kitStatusBadge(unit.state)!.label }}
          </span>
        </div>
      </BaseCard>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold text-ink">Kit</h2>
        <DataWorkspace>
          <DataTable embedded :columns="KIT_COLUMNS" :rows="kitLines" row-key="assetTypeId" :loading="isLoading">
            <template #cell-delta="{ value }">
              <span v-if="value < 0" class="font-semibold text-danger-700">{{ value }}</span>
              <span v-else-if="value > 0" class="text-ink-secondary">+{{ value }}</span>
              <span v-else class="text-ink-tertiary">—</span>
            </template>
            <template #cell-source="{ value }">
              {{ KIT_EXPECTATION_SOURCE_LABELS[value as keyof typeof KIT_EXPECTATION_SOURCE_LABELS] }}
            </template>
            <template #empty>
              <p>
                Nothing is expected on this unit yet. Set the kit for its kind on the Units page, or
                give this one its own list.
              </p>
            </template>
          </DataTable>
        </DataWorkspace>
      </section>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold text-ink">On the unit</h2>
        <DataWorkspace>
          <DataTable embedded :columns="ASSET_COLUMNS" :rows="assets" row-key="id" :loading="isLoading">
            <template #cell-serialNumber="{ value }">{{ value ?? "—" }}</template>
            <template #actions="{ row }">
              <KebabMenu v-if="canManage">
                <!-- "Take it off" is a MOVE. An asset is always somewhere, and a row that stopped
                     naming a holder without a movement would leave the ledger unable to say where
                     the thing went. -->
                <BaseButton class="kebab-item" @click="moving = row">Move it somewhere</BaseButton>
              </KebabMenu>
            </template>
            <template #empty>
              <p>This unit is carrying nothing that has a number on it.</p>
            </template>
          </DataTable>
        </DataWorkspace>
      </section>
    </template>

    <AssetMoveDrawer
      v-if="moving"
      :open="true"
      :asset="moving"
      mode="move"
      :locations="locations ?? []"
      @close="moving = null"
    />
    <UnitOverrideDrawer
      v-if="unit && overriding"
      :open="true"
      :unit="unit"
      :roster-kind="kind"
      @close="overriding = false"
    />
  </div>
</template>
