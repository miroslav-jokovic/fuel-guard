<script setup lang="ts">
import { computed, watch } from "vue";
import { RouterLink } from "vue-router";
import { TOLL_PROVIDERS, TOLL_PROVIDER_LABEL, type TransponderDto } from "@silvicom/shared";
import { AppBadge, DataTable, DataWorkspace, FilterBar, TablePagination, useQueryState, type DataTableColumn } from "@silvicom/ui";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { formatDateTime } from "@/lib/format";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import TollTagDrawer from "./TollTagDrawer.vue";
import { useTollTagsQuery } from "./useTollTags";
import { TAG_STATUSES, TAG_STATUS_LABEL, TAG_STATUS_TONE, matchesTagSearch, tagSince, tagStatus, tagUnit } from "./tollTagRows";

/**
 * Every toll tag the fleet holds, in one table (TOLLS-PER-TRUCK-PLAN.md TL2b) — the Tolls page's
 * second tab, beside the statements whose tolls these tags decide. The truck page's card shows one
 * truck's tags; this is the whole fleet's, so the office can check a season of tags in one place and
 * find which truck has a number a statement printed.
 *
 * Retired tags are hidden until asked for. Search, provider, status, the page and the open tag are in
 * the URL (D-US2). Opening a row opens the tag's drawer, with its history and the same acts as the card.
 */
const PAGE_SIZE = 50;
const qs = useQueryState();
const search = qs.param("search");
const provider = qs.param("provider", TOLL_PROVIDERS);
const status = qs.param("status", TAG_STATUSES);
const openId = qs.param("tag");
const page = qs.page();
watch([search, provider, status], () => (page.value = 1));

const { zone } = useOrgTimezone();
const { data, isLoading, isError, isFetching, refetch } = useTollTagsQuery();
const all = computed(() => data.value ?? []);
const rows = computed(() =>
  all.value.filter(
    (t) =>
      (status.value ? tagStatus(t) === status.value : tagStatus(t) !== "retired") &&
      (!provider.value || t.provider === provider.value) &&
      matchesTagSearch(t, search.value),
  ),
);
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const openTag = computed<TransponderDto | null>(() => all.value.find((t) => t.id === openId.value) ?? null);

const providerOptions = TOLL_PROVIDERS.map((p) => ({ value: p, label: TOLL_PROVIDER_LABEL[p] }));
const statusOptions = TAG_STATUSES.map((s) => ({ value: s, label: TAG_STATUS_LABEL[s] }));
const activeFilterCount = computed(() => (search.value.trim() ? 1 : 0) + (provider.value ? 1 : 0) + (status.value ? 1 : 0));
function resetFilters() {
  qs.set({ search: undefined, provider: undefined, status: undefined });
}

const columns: DataTableColumn[] = [
  { key: "tag", label: "Tag" },
  { key: "unit", label: "Truck" },
  { key: "since", label: "On truck since", cellClass: "text-ink-secondary" },
  { key: "status", label: "Status" },
];
</script>

<template>
  <DataWorkspace>
    <FilterBar
      v-model:search="search"
      embedded
      search-placeholder="Search tag number or truck…"
      :count="rows.length"
      count-label="tags"
      :active-count="activeFilterCount"
      @clear-all="resetFilters"
    >
      <template #filters>
        <FilterSelect v-model="provider" label="Provider" :options="providerOptions" />
        <FilterSelect v-model="status" label="Status" :options="statusOptions" />
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="pageRows"
      embedded
      row-key="id"
      :loading="isLoading"
      :error="isError ? 'Could not load the toll tags.' : null"
      :retrying="isFetching"
      @retry="refetch"
      @row-click="(row) => (openId = row.id)"
    >
      <template #empty>
        <p v-if="activeFilterCount">No tag matches these filters.</p>
        <p v-else data-test="tags-empty">No toll tags on file yet. Add them one at a time, or import a spreadsheet of the whole fleet.</p>
      </template>
      <template #cell-tag="{ row }">
        <span class="block font-medium text-ink">{{ TOLL_PROVIDER_LABEL[(row as TransponderDto).provider] }} {{ (row as TransponderDto).tagNumber }}</span>
        <span v-if="(row as TransponderDto).issuer" class="block text-xs text-ink-tertiary">{{ (row as TransponderDto).issuer }}</span>
      </template>
      <template #cell-unit="{ row }">
        <RouterLink
          v-if="tagUnit(row as TransponderDto)"
          :to="`/vehicles/${(row as TransponderDto).currentVehicleId}`"
          class="font-medium text-link hover:text-link-hover"
          @click.stop
        >
          Unit {{ tagUnit(row as TransponderDto) }}
        </RouterLink>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #cell-since="{ row }">{{ tagSince(row as TransponderDto) ? formatDateTime(tagSince(row as TransponderDto), "—", zone) : "—" }}</template>
      <template #cell-status="{ row }">
        <AppBadge :tone="TAG_STATUS_TONE[tagStatus(row as TransponderDto)]">{{ TAG_STATUS_LABEL[tagStatus(row as TransponderDto)] }}</AppBadge>
      </template>
      <template #footer>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" :loading="isFetching" @update:page="page = $event" />
      </template>
    </DataTable>

    <TollTagDrawer :tag="openTag" @close="openId = ''" />
  </DataWorkspace>
</template>
