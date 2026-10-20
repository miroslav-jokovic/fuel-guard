<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard, QueryState } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { formatDate } from "@/lib/format";
import { useOpenWorkOrdersQuery } from "./useShopBacklog";

/**
 * The shop's open orders for one unit (UNIT-FILES-PLAN UF5's Maintenance section): a read-only window
 * onto the same read the Fleet manager's Shop card makes, narrowed to this unit's number. The shop
 * section owns the work; this says what is open and where it is, and links nowhere FleetPal does not.
 *
 * Gated `maintenance: view` like the kit card beside it: a reader without the shop section gets no
 * card, not a card that says "nothing open", which is a claim about the truck.
 */
const props = defineProps<{ unitNumber: string }>();
const session = useSessionStore();
const maySee = computed(() => session.canView("maintenance"));
const q = useOpenWorkOrdersQuery();
const orders = computed(() => (q.data.value ?? []).filter((o) => o.unitNumber === props.unitNumber));
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
    <ul v-else class="divide-y divide-edge-subtle text-sm">
      <li v-for="o in orders" :key="o.id" class="flex items-center justify-between gap-4 px-5 py-2">
        <span class="min-w-0 truncate text-ink">
          <span v-if="o.referenceNumber" class="font-mono text-xs text-ink-muted">{{ o.referenceNumber }}</span>
          {{ o.description ?? "Work order" }}
        </span>
        <span class="shrink-0 text-xs text-ink-muted">
          <template v-if="o.priority">{{ o.priority }} · </template>{{ o.openedAt ? formatDate(o.openedAt) : "—" }}
        </span>
      </li>
      <li v-if="orders.length === 0" class="px-5 py-3 text-ink-muted">Nothing open in the shop for this unit.</li>
    </ul>
  </BaseCard>
</template>
