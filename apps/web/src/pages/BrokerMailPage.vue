<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  BROKER_MAIL_ANSWERED_HOURS,
  BROKER_MAIL_OPEN_DAYS,
  BROKER_MAIL_REASON_LABELS,
  BROKER_MAIL_TABS,
  BROKER_MAIL_TAB_LABELS,
  formatDisplayDateTime,
  type BrokerMailRow,
  type BrokerMailTab,
} from "@silvicom/shared";
import { AppBadge, AppButton, AppCallout, AppTabs, DataTable, DataWorkspace, FilterBar, TablePagination, useQueryState, type DataTableColumn } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { useBrokerMailQuery } from "@/features/brokerMail/useBrokerMail";
import { answeredBy, matchNote, matchesBrokerMailSearch, waitLabel, waitTone, waitedMinutes } from "@/features/brokerMail/brokerMailRows";

/**
 * Broker mail (BROKER-MAIL-READER-PLAN P2): the broker emails in the caller's OWN Outlook that nobody
 * has answered, read by the mail gateway. Oldest first, because the broker who has waited longest is
 * the one about to call. Replying in Outlook closes a row by itself on the gateway's next read (D-BMR9);
 * nothing here closes one, so the list can never claim an answer Outlook does not hold.
 *
 * Whose rows arrive is the API's answer (Q-BM9): the caller's own mailbox, or every dispatcher's for a
 * holder of `dispatch.broker_mail_all` — only then is there a Dispatcher column and filter. The queue,
 * the search, the dispatcher and the page are in the URL (D-US2).
 */
const PAGE_SIZE = 50;
const qs = useQueryState();
const search = qs.param("search");
const owner = qs.param("dispatcher");
const page = qs.page();
const tab = computed<BrokerMailTab>({
  get: () => BROKER_MAIL_TABS.find((t) => t === qs.one("queue")) ?? BROKER_MAIL_TABS[0],
  set: (v) => qs.set({ queue: v === BROKER_MAIL_TABS[0] ? undefined : v }),
});
watch([search, owner, tab], () => (page.value = 1));

const ownerParam = computed(() => owner.value || undefined);
const { data, isLoading, isError, isFetching, refetch } = useBrokerMailQuery(tab, ownerParam);

// "Waited" is read against a clock that moves with each minute's refresh, not the page's first paint.
const now = ref(Date.now());
watch(data, () => (now.value = Date.now()));

const seesAll = computed(() => data.value?.seesAll ?? false);
const answerWithin = computed(() => data.value?.answerWithinMinutes ?? 20);
const rows = computed(() => (data.value?.rows ?? []).filter((r) => matchesBrokerMailSearch(r, search.value)));
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const tabItems = computed(() =>
  BROKER_MAIL_TABS.map((t) => ({ value: t, label: BROKER_MAIL_TAB_LABELS[t], badge: data.value ? data.value.counts[t] : undefined })),
);
const dispatcherOptions = computed(() => (data.value?.dispatchers ?? []).map((d) => ({ value: d.userId, label: d.name })));
const activeFilterCount = computed(() => (search.value.trim() ? 1 : 0) + (owner.value ? 1 : 0));
function resetFilters() {
  qs.set({ search: undefined, dispatcher: undefined });
}

/** The caller's own mailbox is not read: say why, unless they are here to see everyone's. */
const mailboxNotice = computed(() => {
  const m = data.value?.myMailbox;
  if (!m || m.read) return null;
  if (m.reason === "off") return { tone: "info" as const, text: "Broker mail reading is switched off, so no Outlook is read yet." };
  if (seesAll.value) return null;
  const why = m.reason ? BROKER_MAIL_REASON_LABELS[m.reason] : "";
  return { tone: "caution" as const, text: `Your Outlook is not read: ${why.toLowerCase()}. An admin can see why on Settings › Broker mail.` };
});

const columns = computed<DataTableColumn[]>(() => [
  tab.value === "handled"
    ? { key: "answeredAt", label: "Answered", card: "status" }
    : { key: "waited", label: "Waiting", card: "status" },
  { key: "fromAddress", label: "From", card: "title" },
  { key: "load", label: tab.value === "needs_load" ? "Why no load" : "Load", card: "figure" },
  { key: "subject", label: "Subject", card: "sentence", cellClass: "max-w-md truncate" },
  ...(seesAll.value ? [{ key: "ownerName", label: "Dispatcher", card: "meta" } as DataTableColumn] : []),
  { key: "receivedAt", label: "Received", card: "meta" },
]);

const emptyText = computed(() => {
  if (tab.value === "waiting") return `Nothing waiting. Every broker email about a load from the last ${BROKER_MAIL_OPEN_DAYS} days has an answer in Outlook.`;
  if (tab.value === "needs_load") return "Every unanswered broker email names a load 360 could find.";
  return `No broker email was answered in the last ${BROKER_MAIL_ANSWERED_HOURS} hours.`;
});
const rowOf = (r: unknown) => r as BrokerMailRow;
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Broker emails in your Outlook that nobody has answered yet, oldest first. Reply in Outlook as usual: the row closes by itself within a minute or two." />

    <AppCallout v-if="mailboxNotice" :tone="mailboxNotice.tone" data-test="mailbox-notice">{{ mailboxNotice.text }}</AppCallout>

    <AppTabs v-model="tab" :tabs="tabItems" label="Broker mail queue" scrollable />

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search sender, subject, load…"
        :count="rows.length"
        count-label="emails"
        :active-count="activeFilterCount"
        @clear-all="resetFilters"
      >
        <template v-if="seesAll" #filters>
          <FilterSelect v-model="owner" label="Dispatcher" :options="dispatcherOptions" />
        </template>
      </FilterBar>

      <DataTable
        :columns="columns"
        :rows="pageRows"
        embedded
        row-key="id"
        :loading="isLoading"
        :error="isError ? 'Could not load broker mail.' : null"
        :retrying="isFetching"
        @retry="refetch"
      >
        <template #empty>
          <p v-if="activeFilterCount">No broker email matches these filters.</p>
          <p v-else>{{ emptyText }}</p>
        </template>
        <template #cell-waited="{ row }">
          <AppBadge :tone="waitTone(waitedMinutes(rowOf(row).receivedAt, now), answerWithin)">{{ waitLabel(waitedMinutes(rowOf(row).receivedAt, now)) }}</AppBadge>
        </template>
        <template #cell-answeredAt="{ row }">
          <span class="text-ink-secondary">{{ answeredBy(rowOf(row), seesAll) }}</span>
          <span class="block text-xs text-ink-tertiary">{{ formatDisplayDateTime(rowOf(row).answeredAt) }}</span>
        </template>
        <template #cell-fromAddress="{ row }">
          <span class="font-medium text-ink">{{ rowOf(row).fromAddress ?? "—" }}</span>
          <!-- Q-BMR4: it came through a list or a shared address, not to this dispatcher by name. -->
          <span v-if="!rowOf(row).addressedDirectly" class="block text-xs text-ink-tertiary">sent to a shared address</span>
        </template>
        <template #cell-load="{ row }">
          <AppButton v-if="rowOf(row).load" variant="link" :to="`/loads/${rowOf(row).load!.id}`">{{ rowOf(row).load!.ref ?? "Open load" }}</AppButton>
          <span v-else class="text-ink-secondary">{{ matchNote(rowOf(row)) }}</span>
        </template>
        <template #cell-subject="{ value }">
          <span class="text-ink-secondary" :title="value ?? undefined">{{ value ?? "(no subject)" }}</span>
        </template>
        <template #cell-receivedAt="{ value }">
          <span class="text-ink-secondary">{{ formatDisplayDateTime(value) }}</span>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" :loading="isFetching" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>

    <p v-if="data && tab !== 'handled'" class="text-xs text-ink-tertiary" data-test="answer-within">
      Red after {{ answerWithin }} minutes without an answer, amber in the five minutes before.
    </p>
  </div>
</template>
