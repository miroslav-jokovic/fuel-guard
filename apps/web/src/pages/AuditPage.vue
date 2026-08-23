<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRoute } from "vue-router";
import { useAuditQuery, type AuditFilters } from "@/features/audit/useAudit";
import TablePagination from "@/components/TablePagination.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppButton as BaseButton } from "@fuelguard/ui";
import CardChangeLog from "@/features/fuelCards/CardChangeLog.vue";

/**
 * Two tabs (Step 6.6). Hand-rolled, because there is no `Tabs` component in the design system and
 * the house pattern is a `role="tablist"` strip of `BaseButton`s on `bg-surface-muted` —
 * `CompliancePage.vue:316`, `DriverAppSettingsPage.vue:229`. Following it beats inventing a seventh.
 *
 * Activity is the DEFAULT: it is the account-wide question, and card changes are a narrower one an
 * operator arrives at deliberately.
 */
type AuditTab = "activity" | "cards";
const TABS: { value: AuditTab; label: string }[] = [
  { value: "activity", label: "Activity" },
  { value: "cards", label: "Card changes" },
];
const route = useRoute();

/**
 * `?tab=cards&cardId=…` is what the card page's "Change history" links to — the per-card question
 * 6.5.5 took off the card page. Read once at mount rather than watched: this is an entry point, not
 * a two-way binding, and re-reading it would fight the operator every time they clicked the tab.
 */
const tab = ref<AuditTab>(route.query.tab === "cards" ? "cards" : "activity");
const cardFilter = computed(() => (typeof route.query.cardId === "string" ? route.query.cardId : undefined));

const PAGE_SIZE = 50;
const filters = ref<AuditFilters>({});
const page = ref(1);
const cursors = ref<(string | null)[]>([null]);
const cursor = computed(() => cursors.value[page.value - 1] ?? null);
const { data: auditPage, isLoading, isError, error, isFetching, refetch } = useAuditQuery(filters, cursor);

watch(filters, () => {
  page.value = 1;
  cursors.value = [null];
}, { deep: true });
watch(() => auditPage.value?.nextCursor, (next) => {
  if (next && cursors.value.length === page.value) cursors.value.push(next);
});
const total = computed(() => auditPage.value?.total ?? 0);
const pageRows = computed(() => auditPage.value?.rows ?? []);

/** Two-way proxy for the action search ("" ⇄ undefined). */
const search = computed({
  get: () => filters.value.action ?? "",
  set: (v: string) => (filters.value = { action: v.trim() || undefined }),
});

const fmt = (iso: string) => new Date(iso).toLocaleString();

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

    <nav class="flex gap-1 rounded-surface bg-surface-muted p-1 text-sm" role="tablist" aria-label="Audit view">
      <BaseButton
        v-for="t in TABS"
        :id="`audit-tab-${t.value}`"
        :key="t.value"
        type="button"
        role="tab"
        class="rounded-control px-3 py-1.5 font-medium transition"
        :class="tab === t.value ? 'bg-surface text-ink' : 'text-ink-muted hover:text-ink-secondary'"
        :aria-selected="tab === t.value"
        :aria-controls="`audit-panel-${t.value}`"
        @click="tab = t.value"
      >
        {{ t.label }}
      </BaseButton>
    </nav>

    <!--
      The card LEDGER, not a filter over `audit_logs`. An audit row buries which card in
      `entity_id`/`meta` and carries no outcome; this side has the card, the status and the vendor's
      own fault text. See CardChangeLog.vue.
    -->
    <div v-if="tab === 'cards'" id="audit-panel-cards" role="tabpanel" aria-labelledby="audit-tab-cards">
      <CardChangeLog :card-id="cardFilter" />
    </div>

    <div v-else id="audit-panel-activity" role="tabpanel" aria-labelledby="audit-tab-activity" class="space-y-6">
    <FilterBar
      v-model:search="search"
      search-placeholder="Search by action (e.g. invite, anomaly, threshold)"
      :count="total"
      count-label="events"
    />

    <DataTable
      :columns="columns"
      :rows="pageRows"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load audit log') : null"
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
          v-if="total > 0"
          :page="page"
          :page-size="PAGE_SIZE"
          :total="total"
          :loading="isFetching"
          :jumpable="false"
          @update:page="page = $event"
        />
      </template>
    </DataTable>
    </div>
  </div>
</template>
