<script setup lang="ts">
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import LoadStatusBadge from "@/features/hazmat/LoadStatusBadge.vue";
import { useReviewQueueQuery } from "@/features/hazmat/useHazmatReview";

/**
 * Hazmat review queue (plan H7). Loads in `needs_review`, oldest-first (longest-waiting at the top). The
 * fail-closed workflow: nothing here has auto-cleared; a review-role user opens a load to attest, override,
 * or reject it. Clearing itself lives on the load page (ReviewPanel).
 */
const { data: loads, isLoading, isError, error } = useReviewQueueQuery();

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

    <BaseCard v-else-if="!loads || loads.length === 0" class="text-center">
      <p class="py-10 text-sm text-ink-muted">Nothing awaiting review. 🎉</p>
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
          <tr v-for="load in loads" :key="load.id" class="border-b border-edge last:border-0 hover:bg-surface-subtle">
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
  </div>
</template>
