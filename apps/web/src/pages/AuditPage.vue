<script setup lang="ts">
import { computed, watch } from "vue";
import { useQueryState } from "@silvicom/ui";
import { useAuditQuery, type AuditFilters, type AuditPosition } from "@/features/audit/useAudit";
import { TablePagination } from "@silvicom/ui";
import { FilterBar } from "@silvicom/ui";
import { DataTable } from "@silvicom/ui";
import { DataWorkspace } from "@silvicom/ui";
import { type DataTableColumn } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppTabs, type TabItem } from "@silvicom/ui";
import CardChangeLog from "@/features/fuelCards/CardChangeLog.vue";
import { formatDateTime as fmt } from "@/lib/format";

/** Activity is the default account-wide view; card changes are a narrower ledger. */
type AuditTab = "activity" | "cards";
const TABS: TabItem[] = [
  { value: "activity", label: "Activity" },
  { value: "cards", label: "Card changes" },
];
const qs = useQueryState();

/**
 * `?tab=cards&cardId=…` is what the card page's "Change history" links to — the per-card question
 * 6.5.5 took off the card page.
 *
 * The tab is now a two-way binding over the URL (D-US2). It used to be read once at mount, because a
 * watch on `route.query` would have fought the operator on every click; through `useQueryState` the
 * click IS the write, so there is nothing to fight — and Back from a card the Card changes tab linked
 * to now returns to that tab instead of to Activity. `activity` is the fallback, so a plain link stays
 * `/audit` and an unknown `?tab=` opens Activity, as it always did.
 */
const tabParam = qs.param("tab", TABS.map((t) => t.value), "activity");
const tab = computed<AuditTab>({
  get: () => (tabParam.value === "cards" ? "cards" : "activity"),
  set: (v) => (tabParam.value = v),
});
const cardFilter = computed(() => qs.one("cardId"));

/**
 * The action search is in the URL (D-US2) under `?action=`, the same word the API takes — the page owns
 * the route's unscoped keys; the Card changes tab writes under `cards.`.
 *
 * So is the PAGE, as the cursor that addresses it (D-US12): `?before=<cursor>` is the page of rows
 * older than that row, `?after=<cursor>` the page newer than it, neither is the newest. The log is
 * evidence. A link to what it showed must reopen the same rows when an auditor follows it next week, and
 * a page number cannot: page 3 moves every time a row is written at the top. Until 2026-10-15 the page
 * number lived in memory over a stack of walked cursors, so a reload or a pasted link opened the newest
 * page. That stack is gone; the server now answers Newer from any cursor.
 */
const action = qs.param("action");
const before = qs.param("before");
const after = qs.param("after");
const filters = computed<AuditFilters>(() => ({ action: action.value.trim() || undefined }));
const position = computed<AuditPosition>(() =>
  before.value ? { before: before.value } : after.value ? { after: after.value } : {},
);
const { data: auditPage, isLoading, isError, isFetching, refetch } = useAuditQuery(filters, position);

// Watched by VALUE: `filters` reads the URL, so it recomputes on every navigation (a tab click
// included). A new search is a new list, so it starts from its newest page.
watch(() => filters.value.action, (next, prev) => {
  if (next !== prev) qs.set({ before: undefined, after: undefined });
});
const pageRows = computed(() => auditPage.value?.rows ?? []);

/** The page names the time its rows span, newest first: oldest – newest, as a reader reads a range. */
const span = computed(() => {
  const rows = pageRows.value;
  if (!rows.length) return null;
  const newest = fmt(rows[0]!.created_at);
  const oldest = fmt(rows.at(-1)!.created_at);
  return newest === oldest ? newest : `${oldest} – ${newest}`;
});
const pager = computed(() => ({
  span: span.value,
  hasNewer: auditPage.value?.hasNewer ?? false,
  hasOlder: auditPage.value?.hasNext ?? false,
}));
const toNewest = () => qs.set({ before: undefined, after: undefined });
const toNewer = () => qs.set({ before: undefined, after: auditPage.value?.newerCursor ?? undefined });
const toOlder = () => qs.set({ after: undefined, before: auditPage.value?.nextCursor ?? undefined });

/** The FilterBar's search box, over `?action=`. */
const search = action;


const columns: DataTableColumn[] = [
  { key: "created_at", label: "When", width: "lg", cellClass: "text-ink-muted" },
  { key: "action", label: "Action", width: "lg", cellClass: "font-mono text-xs text-ink" },
  { key: "entity", label: "Entity", width: "lg", cellClass: "text-ink-secondary" },
  { key: "meta", label: "Details", width: "3xl", cellClass: "text-ink-muted" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Review security-sensitive changes and operational activity across your organization." />

    <AppTabs v-model="tab" :tabs="TABS" label="Audit view" id-prefix="audit" />

    <!--
      The card LEDGER, not a filter over `audit_logs`. An audit row buries which card in
      `entity_id`/`meta` and carries no outcome; this side has the card, the status and the vendor's
      own fault text. See CardChangeLog.vue.
    -->
    <div v-if="tab === 'cards'" id="audit-panel-cards" role="tabpanel" aria-labelledby="audit-tab-cards">
      <CardChangeLog :card-id="cardFilter" />
    </div>

    <DataWorkspace v-else id="audit-panel-activity" role="tabpanel" aria-labelledby="audit-tab-activity">
      <!-- No count, by Q-SET5: it was a scan of the org's ~5 M rows on every load and keystroke. -->
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search action, e.g. invite, anomaly…"
      />

      <DataTable
        embedded
        :columns="columns"
        :rows="pageRows"
        row-key="id"
        :loading="isLoading"
        :error="isError ? 'Could not load the audit log.' : null"
        :retrying="isFetching"
        empty-text="No audit entries."
        @retry="refetch"
      >
        <template #cell-created_at="{ value }">{{ fmt(value) }}</template>
        <template #cell-meta="{ row }">
          <template v-if="Object.keys(row.meta || {}).length">{{ JSON.stringify(row.meta) }}</template>
          <span v-else class="text-ink-tertiary">—</span>
        </template>
        <template #footer>
          <TablePagination
            v-if="pageRows.length > 0 || before || after"
            :total="null"
            :log="pager"
            :loading="isFetching"
            @newest="toNewest"
            @newer="toNewer"
            @older="toOlder"
          />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
