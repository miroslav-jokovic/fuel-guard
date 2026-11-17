<script setup lang="ts">
import { computed, watch } from "vue";
import { TOLL_PROVIDERS, TOLL_PROVIDER_LABEL, type TollStatementDto } from "@silvicom/shared";
import { AppBadge, DataTable, DataWorkspace, FilterBar, TablePagination, useQueryState, type DataTableColumn } from "@silvicom/ui";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { formatDateTime } from "@/lib/format";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useSessionStore } from "@/stores/session";
import TollStatementDrawer from "./TollStatementDrawer.vue";
import { useTollStatementsQuery } from "./useTollStatements";
import {
  STATEMENT_STATUS_LABEL,
  STATEMENT_STATUS_TONE,
  fileKind,
  matchesStatementSearch,
  statementPeriod,
  statementStatus,
} from "./tollStatementRows";

/**
 * The toll statements uploaded (TOLLS-PER-TRUCK-PLAN.md TL4a), the Tolls page's first tab. Newest
 * upload first. Removed files are hidden until asked for, and then shown crossed off with their
 * reason. Search, provider, that switch, the page and the open statement are in the URL (D-US2).
 */
const PAGE_SIZE = 50;
const qs = useQueryState();
const search = qs.param("search");
const provider = qs.param("provider", TOLL_PROVIDERS);
const show = qs.param("show", ["removed"] as const);
const openId = qs.param("statement");
const page = qs.page();
watch([search, provider, show], () => (page.value = 1));

const session = useSessionStore();
const canUpload = computed(() => session.can("accounting"));
const { zone } = useOrgTimezone();

const { data, isLoading, isError, isFetching, refetch } = useTollStatementsQuery();
const all = computed(() => data.value ?? []);
const rows = computed(() =>
  all.value.filter(
    (s) => (show.value === "removed" || !s.removedAt) && (!provider.value || s.provider === provider.value) && matchesStatementSearch(s, search.value),
  ),
);
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const openStatement = computed<TollStatementDto | null>(() => all.value.find((s) => s.id === openId.value) ?? null);

const providerOptions = TOLL_PROVIDERS.map((p) => ({ value: p, label: TOLL_PROVIDER_LABEL[p] }));
const showOptions = [{ value: "removed", label: "Show removed files too" }];
const activeFilterCount = computed(() => (search.value.trim() ? 1 : 0) + (provider.value ? 1 : 0) + (show.value ? 1 : 0));
function resetFilters() {
  qs.set({ search: undefined, provider: undefined, show: undefined });
}

const columns: DataTableColumn[] = [
  { key: "uploadedAt", label: "Uploaded", cellClass: "text-ink-secondary" },
  { key: "provider", label: "Provider" },
  { key: "fileName", label: "File" },
  { key: "period", label: "Period" },
  { key: "uploadedByName", label: "By" },
  { key: "status", label: "Status" },
];
</script>

<template>
  <DataWorkspace>
    <FilterBar
      v-model:search="search"
      embedded
      search-placeholder="Search file or provider…"
      :count="rows.length"
      count-label="statements"
      :active-count="activeFilterCount"
      @clear-all="resetFilters"
    >
      <template #filters>
        <FilterSelect v-model="provider" label="Provider" :options="providerOptions" />
        <FilterSelect v-model="show" label="Removed" :options="showOptions" />
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="pageRows"
      embedded
      row-key="id"
      :loading="isLoading"
      :error="isError ? 'Could not load the toll statements.' : null"
      :retrying="isFetching"
      @retry="refetch"
      @row-click="(row) => (openId = row.id)"
    >
      <template #empty>
        <p v-if="activeFilterCount">No statement matches these filters.</p>
        <p v-else data-test="statements-empty">No toll statements uploaded yet.{{ canUpload ? " Upload the files E-ZPass, K-TAG and ExpressToll send to start." : "" }}</p>
      </template>
      <template #cell-uploadedAt="{ value }">{{ formatDateTime(value, "—", zone) }}</template>
      <template #cell-provider="{ value }">{{ TOLL_PROVIDER_LABEL[value as TollStatementDto["provider"]] }}</template>
      <template #cell-fileName="{ row }">
        <span class="block max-w-xs truncate font-medium" :class="row.removedAt ? 'text-ink-tertiary line-through' : 'text-ink'" :title="row.fileName">{{ row.fileName }}</span>
        <span class="block text-xs text-ink-tertiary">{{ fileKind(row) }}</span>
      </template>
      <template #cell-period="{ row }">
        <span :class="statementPeriod(row) ? 'text-ink-secondary' : 'text-ink-tertiary'">{{ statementPeriod(row) ?? "—" }}</span>
      </template>
      <template #cell-uploadedByName="{ value }">
        <span class="text-ink-secondary">{{ value ?? "—" }}</span>
      </template>
      <template #cell-status="{ row }">
        <AppBadge :tone="STATEMENT_STATUS_TONE[statementStatus(row)]">{{ STATEMENT_STATUS_LABEL[statementStatus(row)] }}</AppBadge>
      </template>
      <template #footer>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" :loading="isFetching" @update:page="page = $event" />
      </template>
    </DataTable>

    <TollStatementDrawer :statement="openStatement" @close="openId = ''" />
  </DataWorkspace>
</template>
