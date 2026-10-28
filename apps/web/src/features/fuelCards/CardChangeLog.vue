<script setup lang="ts">
import { computed, watch } from "vue";
import {
  parseYmd,
  CARD_MUTATION_INTENT_LABELS,
  CARD_MUTATION_STATUS_LABELS,
  type CardMutationIntent,
  type CardMutationStatus,
} from "@silvicom/shared";
import {
  DataTable,
  type DataTableColumn,
  DataWorkspace,
  FilterBar,
  type FilterChip,
  TablePagination,
  useQueryState,
} from "@silvicom/ui";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { cardIdentityLabel } from "./cardIdentityLabel";
import { useCardMutationLog, type CardMutationLogFilters } from "./useCardControl";
import { formatDate, formatDateTime } from "@/lib/format";

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

/**
 * The search, the window and the page live in the URL (D-US2): a row links to its card, and Back from
 * that card has to land on the same narrowed, paged log rather than on page 1 of everything.
 *
 * Scoped `cards.` because this is a TAB of the Audit log page, which owns its route's unscoped keys
 * (`?tab=`, the Activity tab's `?action=`) and `?cardId=` — the card page's entry link, which stays
 * unscoped because that link is already written in the wild. No window by default, as before: a ledger
 * this size is read newest first, and "every change" is the honest unfiltered answer. A hand-edited
 * date that is not a real calendar day reads as no bound, never reaches the API.
 */
const qs = useQueryState("cards");
const search = qs.param("search");
const fromParam = qs.param("from");
const toParam = qs.param("to");
const from = computed<string | undefined>({
  get: () => parseYmd(fromParam.value) ?? undefined,
  set: (v) => (fromParam.value = v ?? ""),
});
const to = computed<string | undefined>({
  get: () => parseYmd(toParam.value) ?? undefined,
  set: (v) => (toParam.value = v ?? ""),
});
const page = qs.page();

const filters = computed<CardMutationLogFilters>(() => ({
  ...(props.cardId ? { cardId: props.cardId } : {}),
  ...(search.value.trim() ? { search: search.value.trim() } : {}),
  ...(from.value ? { from: from.value } : {}),
  ...(to.value ? { to: to.value } : {}),
}));

// Any filter change invalidates the page number: staying on page 4 of a narrowed result set shows
// an empty table that reads as "no card changes" rather than "you are past the end". Watched by VALUE,
// not `deep` on the object: `filters` reads the URL now, so it recomputes on every navigation — the
// page change included — and an object watch would put every Next press straight back on page 1.
watch(() => JSON.stringify(filters.value), () => { page.value = 1; });

const query = useCardMutationLog(filters, page, PAGE_SIZE);

const total = computed(() => query.data.value?.total ?? 0);

const rows = computed(() =>
  (query.data.value?.mutations ?? []).map((m) => ({
    ...m,
    when: formatDateTime(m.createdAt),
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
    ? [{ key: "dates", label: "Dates", value: `${from.value ? formatDate(from.value) : "any"} → ${to.value ? formatDate(to.value) : "any"}` }]
    : []),
]);

function removeChip(key: string): void {
  if (key === "dates") qs.set({ from: undefined, to: undefined });
}

// `cardId` is not counted: it is the page this log was opened FROM, not a filter the reader set, and
// `clearAll` leaves it alone for the same reason.
const activeFilterCount = computed(() => (search.value.trim() ? 1 : 0) + (from.value || to.value ? 1 : 0));

function clearAll(): void {
  qs.set({ search: undefined, from: undefined, to: undefined });
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
  <DataWorkspace>
    <FilterBar
      embedded
      v-model:search="search"
      search-placeholder="Search card, unit or driver…"
      :count="total"
      count-label="changes"
      :chips="chips"
      :active-count="activeFilterCount"
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
      embedded
      :columns="columns"
      :rows="rows"
      row-key="id"
      :loading="query.isLoading.value"
      :error="query.isError.value ? 'Could not load card changes.' : undefined"
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
  </DataWorkspace>
</template>
