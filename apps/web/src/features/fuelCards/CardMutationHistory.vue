<script setup lang="ts">
import { computed, toRef } from "vue";
import {
  CARD_MUTATION_INTENT_LABELS,
  CARD_MUTATION_STATUS_LABELS,
  type CardMutationIntent,
  type CardMutationStatus,
} from "@fuelguard/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useCardMutations } from "./useCardControl";

/**
 * What has been done to this card, and what came of it.
 *
 * Reads the mutation ledger, which records an attempt BEFORE it is dispatched — so a change that
 * crashed mid-flight appears here as an unresolved row rather than not at all. Two states are worth
 * more than the rest and are toned accordingly:
 *
 *   "Unverified" (`sent`)   — the write went out and nobody knows what happened. Caution, not danger:
 *                             it is a thing to go and check in the WEX portal, not a failure.
 *   "Applied, with other    — it worked, and something else on the card moved at the same time.
 *    changes" (drift)         Somebody was in the portal, and the audit log says so.
 */

const props = defineProps<{ cardId: string }>();

const query = useCardMutations(toRef(props, "cardId"));

const columns: DataTableColumn[] = [
  { key: "createdAt", label: "When" },
  { key: "intent", label: "What" },
  { key: "reason", label: "Why" },
  { key: "status", label: "Outcome" },
];

const rows = computed(() =>
  (query.data.value?.mutations ?? []).map((m) => ({
    ...m,
    when: new Date(m.createdAt).toLocaleString(),
    what: CARD_MUTATION_INTENT_LABELS[m.intent as CardMutationIntent] ?? m.intent,
    outcome: CARD_MUTATION_STATUS_LABELS[m.status as CardMutationStatus] ?? m.status,
  })),
);

const statusTone = (status: string): string => {
  switch (status) {
    case "succeeded": return "success";
    case "drift_detected": return "caution";
    case "sent": return "caution";
    case "failed": return "danger";
    default: return "neutral";
  }
};
</script>

<template>
  <DataTable
    :columns="columns"
    :rows="rows"
    row-key="id"
    dense
    :loading="query.isLoading.value"
    :error="query.isError.value ? (query.error.value?.message ?? 'Could not load the change history') : null"
    empty-text="No changes yet."
    @retry="query.refetch()"
  >
    <template #cell-createdAt="{ row }">{{ row.when }}</template>
    <template #cell-intent="{ row }">{{ row.what }}</template>
    <template #cell-status="{ row }">
      <div class="space-y-1">
        <span :class="[BADGE_BASE, toneClass(statusTone(row.status))]">{{ row.outcome }}</span>
        <p v-if="row.efsFaultMessage" class="text-xs text-ink-subtle">{{ row.efsFaultMessage }}</p>
        <p v-else-if="row.driftFields?.length" class="text-xs text-ink-subtle">
          Also changed: {{ row.driftFields.map((f: string) => f.replace(/^\//, "")).join(", ") }}
        </p>
      </div>
    </template>
  </DataTable>
</template>
