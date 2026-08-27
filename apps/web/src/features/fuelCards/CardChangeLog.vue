<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  CARD_MUTATION_INTENT_LABELS,
  CARD_MUTATION_STATUS_LABELS,
  type CardMutationIntent,
  type CardMutationStatus,
} from "@silvicom/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterBar, { type FilterChip } from "@/components/ui/FilterBar.vue";
import TablePagination from "@/components/TablePagination.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { cardIdentityLabel } from "./cardIdentityLabel";
import { useCardMutationLog, type CardMutationLogFilters } from "./useCardControl";

/**
 * Every card change on the account — the Audit Log page's "Card changes" tab (Step 6.6).
 *
 * ── Why this is not the Activity tab with a filter on it ────────────────────────────────────────
 * `audit_logs` already carries `card.locked` and `card.override_granted`, so the reasonable
 * objection is that this shows the same events twice. It does not. An audit row buries WHICH card in
 * `entity_id`/`meta` and carries no OUTCOME; the ledger has the card, the status — `succeeded`,
 * `failed`, `sent`, `drift_detected` — and the vendor's own fault text. *"Which of my cards changed,
 * and did it work?"* is only answerable from this side.
 *
 * ── The two states worth more than the rest ─────────────────────────────────────────────────────
 * Toned the same way `CardMutationHistory.vue` tones them, because they mean the same thing here:
 *
 *   "Unverified" (`sent`)  — the write went out and nobody knows what happened. CAUTION, not danger:
 *                            a thing to check in the WEX portal, not a failure to retry.
 *   "…with other changes"  — it worked, and something else on the card moved at the same time.
 *     (`drift_detected`)     Somebody was in the portal, and this is where that shows up.
 */

const props = defineProps<{
  /**
   * Narrow to one card — what the card page's "Change history" links to.
   *
   * This is the per-card question 6.5.5 took off the card page and 6.6 left homeless: the tab could
   * answer it, but nothing could ASK it, so the endpoint's `cardId` filter was a field no caller
   * ever set. A speculative filter is exactly what standing rule 7 forbids; this is the caller.
   */
  cardId?: string;
}>();

const PAGE_SIZE = 25;

const search = ref("");
const from = ref<string | undefined>(undefined);
const to = ref<string | undefined>(undefined);
const page = ref(1);

const filters = computed<CardMutationLogFilters>(() => ({
  ...(props.cardId ? { cardId: props.cardId } : {}),
  ...(search.value.trim() ? { search: search.value.trim() } : {}),
  ...(from.value ? { from: from.value } : {}),
  ...(to.value ? { to: to.value } : {}),
}));

// Any filter change invalidates the page number: staying on page 4 of a narrowed result set shows
// an empty table that reads as "no card changes" rather than "you are past the end".
watch(filters, () => { page.value = 1; }, { deep: true });

const query = useCardMutationLog(filters, page, PAGE_SIZE);

const total = computed(() => query.data.value?.total ?? 0);

const rows = computed(() =>
  (query.data.value?.mutations ?? []).map((m) => ({
    ...m,
    when: new Date(m.createdAt).toLocaleString(),
    // Unit AND driver, not one-or-the-other: on a fleet where many last-4 groups hold more than one
    // card, the hidden field is often the only thing telling two rows apart (Step 7.7).
    who: cardIdentityLabel(m).unidentified ? "" : cardIdentityLabel(m).qualifier,
    what: CARD_MUTATION_INTENT_LABELS[m.intent as CardMutationIntent] ?? m.intent,
    outcome: CARD_MUTATION_STATUS_LABELS[m.status as CardMutationStatus] ?? m.status,
  })),
);

/** `sent` is caution, never danger — see the docblock. */
const statusTone = (status: string): string => {
  switch (status) {
    case "succeeded": return "success";
    case "drift_detected": return "warning";
    case "sent": return "caution";
    case "failed": return "danger";
    default: return "neutral";
  }
};

const chips = computed<FilterChip[]>(() => [
  ...(from.value || to.value
    ? [{ key: "dates", label: "Dates", value: `${from.value ?? "any"} → ${to.value ?? "any"}` }]
    : []),
]);

function removeChip(key: string): void {
  if (key === "dates") { from.value = undefined; to.value = undefined; }
}

function clearAll(): void {
  search.value = "";
  from.value = undefined;
  to.value = undefined;
}

const columns: DataTableColumn[] = [
  { key: "when", label: "When", width: "lg", cellClass: "text-ink-muted" },
  { key: "maskedRef", label: "Card", width: "lg", cellClass: "font-medium text-ink" },
  { key: "who", label: "Unit / driver", width: "xl", cellClass: "text-ink-secondary" },
  { key: "what", label: "What", width: "lg" },
  { key: "outcome", label: "Outcome", width: "lg" },
];
</script>

<template>
  <div class="space-y-4">
    <FilterBar
      v-model:search="search"
      search-placeholder="Search card, unit or driver…"
      :count="total"
      count-label="changes"
      :chips="chips"
      @remove="removeChip"
      @clear-all="clearAll"
    >
      <template #filters>
        <DateRangeFilter
          :from="from"
          :to="to"
          @update:from="from = $event ?? undefined"
          @update:to="to = $event ?? undefined"
        />
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="rows"
      row-key="id"
      :loading="query.isLoading.value"
      :error="query.isError.value ? (query.error.value?.message ?? 'Could not load card changes') : undefined"
      :retrying="query.isFetching.value"
      empty-text="No card changes match these filters."
      @retry="query.refetch()"
    >
      <template #cell-outcome="{ row }">
        <span :class="[BADGE_BASE, toneClass(statusTone((row as { status: string }).status))]">
          {{ (row as { outcome: string }).outcome }}
        </span>
        <!-- EFS's own words carry the reference WEX asks for when somebody calls them. -->
        <p v-if="(row as { efsFaultMessage: string | null }).efsFaultMessage" class="mt-1 text-xs text-ink-muted">
          {{ (row as { efsFaultMessage: string }).efsFaultMessage }}
        </p>
      </template>
      <!-- A row names a card; it should also reach it. -->
      <template #cell-maskedRef="{ row }">
        <RouterLink
          v-if="(row as { cardId: string | null }).cardId"
          :to="`/fuel-cards/${(row as { cardId: string }).cardId}`"
          class="font-medium text-brand-700 hover:underline"
        >
          {{ (row as { maskedRef: string }).maskedRef }}
        </RouterLink>
        <span v-else>{{ (row as { maskedRef: string }).maskedRef }}</span>
      </template>
      <template #cell-who="{ row }">
        <span v-if="(row as { who: string }).who">{{ (row as { who: string }).who }}</span>
        <span v-else class="italic text-ink-tertiary">no unit or driver</span>
      </template>
      <template #footer>
        <TablePagination
          v-if="total > 0"
          :page="page"
          :page-size="PAGE_SIZE"
          :total="total"
          :loading="query.isFetching.value"
          @update:page="page = $event"
        />
      </template>
    </DataTable>
  </div>
</template>
