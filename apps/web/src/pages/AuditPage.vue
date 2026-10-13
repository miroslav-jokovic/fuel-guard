<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useQueryState } from "@/composables/useQueryState";
import { AUDIT_LOG_PAGE_SIZE as PAGE_SIZE } from "@silvicom/shared";
import { useAuditQuery, type AuditFilters } from "@/features/audit/useAudit";
import TablePagination from "@/components/TablePagination.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import DataTable from "@/components/ui/DataTable.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
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
 * ⚠ The PAGE is deliberately not. This log pages on a keyset cursor (Q-SET5: no count, ~5 M rows), and
 * page N is only reachable by walking the N − 1 cursors before it, which this page holds in memory. A
 * `?page=3` read back on a reload would have no cursor to stand on and would show page 1's rows under a
 * "page 3" label. Putting the cursor itself in the URL would fix reload but not Prev, which needs every
 * earlier one; that is an API change (a backwards cursor), not a page change, so the walk restarts on
 * reload, as Assignment history's "Load more" does for the same reason.
 */
const action = qs.param("action");
const filters = computed<AuditFilters>(() => ({ action: action.value.trim() || undefined }));
const page = ref(1);
const cursors = ref<(string | null)[]>([null]);
const cursor = computed(() => cursors.value[page.value - 1] ?? null);
const { data: auditPage, isLoading, isError, error, isFetching, refetch } = useAuditQuery(filters, cursor);

// Watched by VALUE: `filters` reads the URL, so it recomputes on every navigation (a tab click
// included), and a reset on each of those would throw away the cursor walk for nothing.
watch(() => filters.value.action, () => {
  page.value = 1;
  cursors.value = [null];
});
watch(() => auditPage.value?.nextCursor, (next) => {
  if (next && cursors.value.length === page.value) cursors.value.push(next);
});
const pageRows = computed(() => auditPage.value?.rows ?? []);

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
            v-if="pageRows.length > 0 || page > 1"
            :page="page"
            :page-size="PAGE_SIZE"
            :total="null"
            :has-next="auditPage?.hasNext ?? false"
            :page-rows="pageRows.length"
            :loading="isFetching"
            :jumpable="false"
            @update:page="page = $event"
          />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
