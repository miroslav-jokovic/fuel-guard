<script setup lang="ts">
import { ref } from "vue";
import type { HazmatLoadRow } from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import LoadStatusBadge from "@/features/hazmat/LoadStatusBadge.vue";
import { useHazmatLoadsQuery } from "@/features/hazmat/useHazmatLoads";

/**
 * Hazmat Load Workspace — list (plan H5). The dispatcher's queue of hand-declared hazmat loads. Reads
 * `GET /api/hazmat/loads`; each row links to the detail view where analysis + verdict live.
 */
const status = ref<string | undefined>(undefined);
const { data: loads, isLoading, isError, error } = useHazmatLoadsQuery(status);

function lineCount(load: HazmatLoadRow): number {
  return Array.isArray(load.declared_lines) ? load.declared_lines.length : 0;
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Hand-declared hazmat loads: declare, analyze, and review with citations.">
      <template #actions>
        <BaseButton variant="ghost" size="sm" to="/hazmat">← HazmatGuard</BaseButton>
        <BaseButton variant="primary" size="sm" to="/hazmat/loads/new">New load</BaseButton>
      </template>
    </PageHeader>

    <p v-if="isLoading" class="text-sm text-ink-muted">Loading loads…</p>
    <p v-else-if="isError" class="text-sm text-danger-600">
      {{ error instanceof Error ? error.message : "Could not load the queue." }}
    </p>

    <BaseCard v-else-if="!loads || loads.length === 0" class="text-center">
      <p class="py-10 text-sm text-ink-muted">
        No hazmat loads yet. <RouterLink to="/hazmat/loads/new" class="font-medium text-brand-600">Create one</RouterLink>
        to run a placard + compliance check.
      </p>
    </BaseCard>

    <BaseCard v-else padding="none">
      <table class="w-full text-sm">
        <thead class="border-b border-edge text-left text-xs uppercase tracking-wide text-ink-subtle">
          <tr>
            <th class="px-4 py-2 font-medium">Status</th>
            <th class="px-4 py-2 font-medium">Products</th>
            <th class="px-4 py-2 font-medium">Tank state</th>
            <th class="px-4 py-2 font-medium">Planned pickup</th>
            <th class="px-4 py-2 font-medium">Created</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="load in loads" :key="load.id" class="border-b border-edge last:border-0 hover:bg-surface-subtle">
            <td class="px-4 py-2.5"><LoadStatusBadge :status="load.status" /></td>
            <td class="px-4 py-2.5 text-ink">{{ lineCount(load) }} line{{ lineCount(load) === 1 ? "" : "s" }}</td>
            <td class="px-4 py-2.5 capitalize text-ink-secondary">{{ load.tank_state.replace(/_/g, " ") }}</td>
            <td class="px-4 py-2.5 text-ink-secondary">{{ load.planned_pickup_at ? fmtDate(load.planned_pickup_at) : "—" }}</td>
            <td class="px-4 py-2.5 text-ink-secondary">{{ fmtDate(load.created_at) }}</td>
            <td class="px-4 py-2.5 text-right">
              <BaseButton variant="ghost" size="sm" :to="`/hazmat/loads/${load.id}`">Open →</BaseButton>
            </td>
          </tr>
        </tbody>
      </table>
    </BaseCard>
  </div>
</template>
