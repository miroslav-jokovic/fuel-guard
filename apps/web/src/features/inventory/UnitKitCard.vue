<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import { type UnitKitDto } from "@silvicom/shared";
import { BADGE_BASE, kitStatusBadge, toneClass } from "@/lib/badges";
import { useUnitKitQuery } from "./useUnits";
import { useSessionStore } from "@/stores/session";

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
const maySee = computed(() => session.canView("maintenance"));

const kindRef = computed(() => props.kind);
const idRef = computed(() => (maySee.value ? props.unitId : ""));
const { data, isLoading, isError } = useUnitKitQuery(kindRef, idRef);

const unit = computed<UnitKitDto | null>(() => data.value?.unit ?? null);
/** Only the lines somebody expects, plus anything unexpected the unit is actually carrying. */
const lines = computed(() => (unit.value?.lines ?? []).filter((l) => l.expected > 0 || l.held > 0));
</script>

<template>
  <BaseCard v-if="maySee" padding="md">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-lg font-semibold text-ink">Kit</h2>
      <span
        v-if="unit && kitStatusBadge(unit.state)"
        :class="[BADGE_BASE, toneClass(kitStatusBadge(unit.state)!.tone)]"
      >
        {{ kitStatusBadge(unit.state)!.label }}
      </span>
    </div>

    <p v-if="isLoading" class="mt-3 text-sm text-ink-tertiary">Loading…</p>
    <p v-else-if="isError" class="mt-3 text-sm text-ink-secondary">Could not load what this unit is carrying.</p>

    <template v-else-if="unit">
      <dl v-if="lines.length" class="mt-3 space-y-2">
        <div v-for="line in lines" :key="line.assetTypeId" class="flex items-baseline justify-between gap-4">
          <dt class="text-sm text-ink">{{ line.assetTypeName }}</dt>
          <dd class="text-sm tabular-nums" :class="line.delta < 0 ? 'font-semibold text-danger-700' : 'text-ink-secondary'">
            {{ line.held }}<span class="text-ink-tertiary"> of {{ line.expected }}</span>
          </dd>
        </div>
      </dl>
      <p v-else class="mt-3 text-sm text-ink-secondary">
        Nothing is expected on this unit yet, and it is carrying nothing.
      </p>

      <RouterLink
        :to="{ name: 'unit', params: { kind, id: unitId } }"
        class="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline"
      >
        Open in the shop
      </RouterLink>
    </template>
  </BaseCard>
</template>
