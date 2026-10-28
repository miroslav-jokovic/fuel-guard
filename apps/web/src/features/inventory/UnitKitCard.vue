<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard, QueryState, FactList, type Fact } from "@silvicom/ui";
import { type UnitKitDto } from "@silvicom/shared";
import { BADGE_BASE, kitStatusBadge, toneClass } from "@/lib/badges";
import { useUnitKitQuery } from "./useUnits";
import { useSessionStore } from "@/stores/session";
import { useOpens } from "@/composables/useOpens";

/**
 * What this truck or trailer is carrying — read only (INVENTORY-PLAN.md I9, D-AVI17).
 *
 * ── IT IS READ ONLY ON PURPOSE, AND THE GATE IS `view` ────────────────────────────────────────
 * D-AVI17's rule is that the truck-and-trailer file adds a PAGE, never a store: everything here is
 * already written and queryable elsewhere, and this card is a window onto it. There is deliberately
 * no Assign, no Move and no kit-rule control — the equipment section owns the unit's file and the
 * shop owns what is inside it, and a button here would be the second quietly taking a decision from
 * the first. The link to `/shop/units/:kind/:id` is where those decisions are made.
 *
 * ── AND IT RENDERS NOTHING WHEN THE READER HAS NO SHOP ACCESS ─────────────────────────────────
 * Gated `maintenance: view` rather than on the equipment section this page belongs to. A fleet
 * manager without the shop gets no card at all, which is the honest answer — a card full of blanks
 * says "this truck carries nothing", and that is a different and alarming claim.
 */

const props = defineProps<{ kind: "tractor" | "trailer"; unitId: string }>();

const session = useSessionStore();
const opens = useOpens();
const maySee = computed(() => session.canView("maintenance"));

const kindRef = computed(() => props.kind);
const idRef = computed(() => (maySee.value ? props.unitId : ""));
const { data, isLoading, isError, error, isFetching, refetch } = useUnitKitQuery(kindRef, idRef);

const unit = computed<UnitKitDto | null>(() => data.value?.unit ?? null);
/** Only the lines somebody expects, plus anything unexpected the unit is actually carrying. */
const lines = computed(() => (unit.value?.lines ?? []).filter((l) => l.expected > 0 || l.held > 0));
/** One fact per line: held, with "of expected" beside it; a short line (delta < 0) reads in danger. */
const kitFacts = computed<Fact[]>(() =>
  lines.value.map((l) => ({
    key: l.assetTypeId,
    label: l.assetTypeName,
    value: l.held,
    numeric: true,
    ...(l.delta < 0 ? { tone: "font-semibold text-danger-700" } : {}),
  })),
);
</script>

<template>
  <BaseCard v-if="maySee">
    <!-- `text-sm`, the heading size every other card on the vehicle and trailer pages uses. This
         card rendered a `text-lg` "Kit" that was the loudest heading on a page whose own were
         `text-sm` (2026-09-10 critique). -->
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-sm font-semibold text-ink">Should carry</h2>
      <span
        v-if="unit && kitStatusBadge(unit.state)"
        :class="[BADGE_BASE, toneClass(kitStatusBadge(unit.state)!.tone)]"
      >
        {{ kitStatusBadge(unit.state)!.label }}
      </span>
    </div>

    <!-- A card on the vehicle page, so the one-line failure with its Retry beside it (D-US5). -->
    <div class="mt-3">
    <QueryState
      compact
      :loading="isLoading"
      :error="isError ? error : null"
      :retrying="isFetching"
      loading-text="Loading…"
      error-text="Could not load what it is carrying."
      @retry="refetch()"
    >
    <template v-if="unit">
      <FactList v-if="lines.length" layout="rows" :facts="kitFacts">
        <template v-for="line in lines" :key="line.assetTypeId" #[`value-${line.assetTypeId}`]="{ fact }">
          {{ fact.value }}<span class="font-normal text-ink-tertiary"> of {{ line.expected }}</span>
        </template>
      </FactList>
      <p v-else class="text-sm text-ink-secondary">
        Nothing is expected on this unit yet, and it is carrying nothing.
      </p>

      <!-- SP5: the card shows on `maintenance` view; Units (`maintenance.units`) is switchable per person. -->
      <RouterLink
        v-if="opens({ name: 'unit', params: { kind, id: unitId } })"
        :to="{ name: 'unit', params: { kind, id: unitId } }"
        class="mt-4 inline-block text-sm font-medium text-link hover:text-link-hover"
      >
        Open in the shop
      </RouterLink>
    </template>
    </QueryState>
    </div>
  </BaseCard>
</template>
