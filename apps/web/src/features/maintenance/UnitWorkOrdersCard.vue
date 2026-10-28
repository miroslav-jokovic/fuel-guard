<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard, QueryState } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useOpens } from "@/composables/useOpens";
import { useUnitShopFileQuery } from "./useUnitShop";
import WorkOrderRows from "./WorkOrderRows.vue";

/**
 * The shop's open orders for one unit (UNIT-FILES-PLAN UF5's Maintenance section): a read-only window
 * on the fleet section's truck and trailer pages, linking to the shop's own page for the unit where
 * the whole record lives (D-MX3). Since M3 it reads the unit's shop file — FleetPal's orders matched
 * to THIS roster row by the reconciliation (F5) — where it used to pick the fleet-wide list apart by
 * the unit-number string, a second matching rule beside the mapping that would silently disagree for
 * a truck FleetPal numbers differently.
 *
 * Gated `maintenance: view` like the kit card beside it: a reader without the shop section gets no
 * card, not a card that says "nothing open", which is a claim about the truck.
 */
const props = defineProps<{ kind: "tractor" | "trailer"; unitId: string }>();
const session = useSessionStore();
const opens = useOpens();
const maySee = computed(() => session.canView("maintenance"));
const kind = computed(() => props.kind);
const id = computed(() => (maySee.value ? props.unitId : ""));
const q = useUnitShopFileQuery(kind, id);
const orders = computed(() => q.data.value?.openWorkOrders ?? []);
</script>

<template>
  <BaseCard v-if="maySee" padding="none" data-test="unit-work-orders">
    <h3 class="border-b border-edge-subtle px-5 py-3 text-sm font-semibold text-ink">Open work orders</h3>
    <div v-if="q.isPending.value || q.isError.value" class="px-5 py-3">
      <QueryState
        compact
        :loading="q.isPending.value && !q.isError.value"
        :error="q.isError.value"
        :retrying="q.isFetching.value"
        loading-text="Loading the shop's open orders…"
        error-text="Could not load the open work orders."
        @retry="q.refetch()"
      />
    </div>
    <template v-else>
      <WorkOrderRows :orders="orders" empty-text="Nothing open in the shop for this unit." />
      <!-- SP5: the card shows on `maintenance` view; the shop's page (`maintenance.units`) is switchable per person. -->
      <RouterLink
        v-if="opens({ name: 'unit', params: { kind, id: unitId } })"
        :to="{ name: 'unit', params: { kind, id: unitId } }"
        class="block border-t border-edge-subtle px-5 py-3 text-sm font-medium text-link hover:text-link-hover"
      >
        Open in the shop
      </RouterLink>
    </template>
  </BaseCard>
</template>
