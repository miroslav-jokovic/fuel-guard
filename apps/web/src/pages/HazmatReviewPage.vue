<script setup lang="ts">
import { computed, ref } from "vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import LoadStatusBadge from "@/features/hazmat/LoadStatusBadge.vue";
import { useReviewQueueQuery } from "@/features/hazmat/useHazmatReview";
import { emptyQueueFilter, filterReviewQueue } from "@/features/hazmat/reviewModel";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";

/**
 * Hazmat review queue (plan H7). Loads in `needs_review`, oldest-first (longest-waiting at the top). The
 * fail-closed workflow: nothing here has auto-cleared; a review-role user opens a load to attest, override,
 * or reject it. Clearing itself lives on the load page (ReviewPanel). Filtering is a client-side narrowing
 * of the already-scoped queue — vehicle, driver, and a free-text search over the load id + declared lines.
 */
const { data: loads, isLoading, isError, error } = useReviewQueueQuery();
const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();

const filter = ref(emptyQueueFilter());
const search = computed({ get: () => filter.value.search, set: (v: string) => (filter.value.search = v) });

const vehicleOptions = computed(() => [
  { value: "", label: "All trucks" },
  ...(vehicles.value ?? []).map((v) => ({ value: v.id, label: v.unit_number })),
]);
const driverOptions = computed(() => [
  { value: "", label: "All drivers" },
  ...(drivers.value ?? []).map((d) => ({ value: d.id, label: d.full_name })),
]);

const visible = computed(() => filterReviewQueue(loads.value ?? [], filter.value));

const fmt = (iso: string) => new Date(iso).toLocaleString();
const waitingHrs = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Loads awaiting a trained reviewer. Oldest first — attest, override, or reject.">
      <template #actions>
        <BaseButton variant="ghost" size="sm" to="/hazmat">← HazmatGuard</BaseButton>
      </template>
    </PageHeader>

    <p v-if="isLoading" class="text-sm text-ink-muted">Loading queue…</p>
    <p v-else-if="isError" class="text-sm text-danger-600">{{ error instanceof Error ? error.message : "Could not load the queue." }}</p>

    <template v-else>
      <FilterBar v-model:search="search" search-placeholder="Search load #, product…" :count="visible.length" count-label="loads">
        <template #filters>
          <FilterSelect v-model="filter.vehicleId" label="Truck" :options="vehicleOptions" />
          <FilterSelect v-model="filter.driverId" label="Driver" :options="driverOptions" />
        </template>
      </FilterBar>

      <BaseCard v-if="visible.length === 0" class="text-center">
        <p class="py-10 text-sm text-ink-muted">
          {{ (loads?.length ?? 0) === 0 ? "Nothing awaiting review. 🎉" : "No loads match these filters." }}
        </p>
      </BaseCard>

      <BaseCard v-else padding="none">
        <table class="w-full text-sm">
          <thead class="border-b border-edge text-left text-xs uppercase tracking-wide text-ink-subtle">
            <tr>
              <th class="px-4 py-2 font-medium">Status</th>
              <th class="px-4 py-2 font-medium">Products</th>
              <th class="px-4 py-2 font-medium">Waiting</th>
              <th class="px-4 py-2 font-medium">Created</th>
              <th class="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="load in visible" :key="load.id" class="border-b border-edge last:border-0 hover:bg-surface-subtle">
              <td class="px-4 py-2.5"><LoadStatusBadge :status="load.status" /></td>
              <td class="px-4 py-2.5 text-ink">{{ Array.isArray(load.declared_lines) ? load.declared_lines.length : 0 }} line(s)</td>
              <td class="px-4 py-2.5 text-ink-secondary">{{ waitingHrs(load.created_at) }}h</td>
              <td class="px-4 py-2.5 text-ink-secondary">{{ fmt(load.created_at) }}</td>
              <td class="px-4 py-2.5 text-right">
                <BaseButton variant="primary" size="sm" :to="`/hazmat/loads/${load.id}`">Review →</BaseButton>
              </td>
            </tr>
          </tbody>
        </table>
      </BaseCard>
    </template>
  </div>
</template>
