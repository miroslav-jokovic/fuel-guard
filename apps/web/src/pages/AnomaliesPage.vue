<script setup lang="ts">
import { formatRuleId } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import AnomalyDetail from "@/features/anomalies/AnomalyDetail.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import TablePagination from "@/components/TablePagination.vue";
import { AppButton as BaseButton, AppTabs, type TabItem } from "@silvicom/ui";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import { BADGE_BASE, severityTone, statusTone } from "@/lib/badges";
import { useAnomaliesPage } from "./useAnomaliesPage";
import { useOpens } from "@/composables/useOpens";

const {
  filters, search, reeferOnly, setReeferOnly,
  status, severity, vehicleIds, statusOptions, severityOptions, unitOptions,
  setFrom, setTo, activeFilterCount, resetFilters,
  session,
  unit, pairedTrailer, driverName,
  columns, sort, onSort,
  total, pageRows, page, PAGE_SIZE,
  isLoading, isError, error, isFetching, refetch,
  selectedIds, setSelected, selectedCount, isActionable, busy, bulkTransition, rowAction,
  selectedRow, fmt,
} = useAnomaliesPage();
// SP5: the button goes where Data & sync is — asked of that page's gate (a Settings screen that starts
// off for everyone but the admin), not of `safety` manage, which a safety manager holds and the page never asked.
const opens = useOpens();

const VIEW_TABS: TabItem[] = [
  { value: "all", label: "All alerts" },
  { value: "reefer", label: "Reefer fueling" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Fuel-card fills that look wrong: possible theft, card misuse, or data that does not add up." />

    <!-- W4 (F02-F04 chunk 14c): the shared tab strip, which a hand-built pair of buttons was not — no
         tablist role, no arrow keys. The URL's `reefer=1` stays the one place the choice lives. -->
    <AppTabs :model-value="reeferOnly ? 'reefer' : 'all'" :tabs="VIEW_TABS" label="Alert view" @update:model-value="setReeferOnly($event === 'reefer')" />

    <BaseCard v-if="reeferOnly" as="div">
      <p class="text-sm text-ink-secondary">
        These alerts are for trucks that pull a reefer and may be filling it with truck diesel instead of reefer
        fuel: a truck that buys little or no reefer fuel, or a diesel fill that did not all go into the truck's own
        tank. Each row shows the truck, its reefer trailer, and the driver on the fill.
      </p>
    </BaseCard>

    <FilterBar
      v-model:search="search"
      search-placeholder="Search message or vehicle…"
      :count="total"
      count-label="alerts"
    >
      <template #filters>
        <FilterSelect v-model="status" label="Status" :options="statusOptions" />
        <FilterSelect v-model="severity" label="Severity" :options="severityOptions" />
        <FilterSelect v-model="vehicleIds" label="Unit" :options="unitOptions" multiple />
        <DateRangeFilter :from="filters.from" :to="filters.to" @update:from="setFrom" @update:to="setTo" />
      </template>
      <template #actions>
        <BaseButton v-if="activeFilterCount" variant="ghost" size="sm" @click="resetFilters">Clear filters</BaseButton>
        <BaseButton
          v-if="opens('/settings/data')"
          variant="ghost"
          size="sm"
          to="/settings/data"
          title="Check all fills again, or bring Samsara data in again, from Settings → Data & sync"
        >
          Data &amp; sync →
        </BaseButton>
      </template>
    </FilterBar>

    <!-- Bulk action bar -->
    <div
      v-if="selectedCount > 0"
      class="flex flex-col gap-2 rounded-surface bg-brand-50 px-4 py-3 ring-1 ring-brand-200 sm:flex-row sm:items-center sm:justify-between"
    >
      <span class="text-sm font-medium text-brand-800">{{ selectedCount }} selected</span>
      <div class="flex flex-wrap gap-2">
        <BaseButton size="sm" :disabled="busy" @click="bulkTransition('investigating')">Investigate</BaseButton>
        <BaseButton size="sm" :disabled="busy" @click="bulkTransition('dismissed', 'False alarm', 'Mark {n} alerts as false alarm?', 'false_positive')">False alarm</BaseButton>
        <BaseButton size="sm" :disabled="busy" @click="bulkTransition('resolved', 'Resolved by reviewer', 'Resolve {n} alerts?', 'confirmed')">Resolve</BaseButton>
        <BaseButton variant="ghost" size="sm" @click="setSelected(new Set())">Clear</BaseButton>
      </div>
    </div>

    <!-- Table -->
    <DataTable
      :columns="columns"
      :rows="pageRows"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Could not load alerts') : null"
      :retrying="isFetching"
      empty-text="Nothing here — no alerts match these filters."
      :sort="sort"
      :selectable="session.can('safety')"
      :selected="selectedIds"
      :row-class="(row) => isActionable(row) ? 'cursor-pointer' : 'cursor-pointer bg-surface-subtle/50 opacity-60'"
      @update:selected="setSelected"
      @sort="onSort"
      @row-click="selectedRow = $event"
      @retry="refetch"
    >
      <template #cell-severity="{ row }">
        <span :class="[BADGE_BASE, severityTone(row.severity), 'capitalize']">{{ row.severity }}</span>
      </template>
      <template #cell-type="{ row }">{{ formatRuleId(row.rule_id) }}</template>
      <template #cell-vehicle="{ row }">{{ unit(row.vehicle_id) }}</template>
      <template #cell-trailer="{ row }">{{ pairedTrailer(row.vehicle_id) }}</template>
      <template #cell-driver="{ row }">{{ driverName(row) }}</template>
      <template #cell-status="{ row }">
        <span :class="[BADGE_BASE, statusTone(row.status), 'capitalize']">{{ row.status }}</span>
      </template>
      <template #cell-when="{ row }">
        <span :title="`Detected ${fmt(row.created_at)}`">{{ fmt(row.fueled_at ?? row.created_at) }}</span>
      </template>
      <template #actions="{ row }">
        <KebabMenu v-if="session.can('safety') && isActionable(row)">
          <BaseButton class="kebab-item" @click="selectedRow = row">Review details</BaseButton>
          <BaseButton v-if="row.status === 'open'" class="kebab-item" @click="rowAction(row, 'investigating')">Start investigating</BaseButton>
          <BaseButton class="kebab-item" @click="rowAction(row, 'resolved', 'Resolved by reviewer', 'confirmed')">Resolve</BaseButton>
          <BaseButton class="kebab-item kebab-item-danger" @click="rowAction(row, 'dismissed', 'False alarm', 'false_positive')">False alarm</BaseButton>
        </KebabMenu>
        <BaseButton v-else class="text-sm font-medium text-link hover:text-link-hover" @click="selectedRow = row">Review</BaseButton>
      </template>
      <template #footer>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="total" @update:page="page = $event" />
      </template>
    </DataTable>

    <SlideOver :open="!!selectedRow" title="Alert" @close="selectedRow = null">
      <AnomalyDetail v-if="selectedRow" :anomaly="selectedRow" :vehicle-unit="unit(selectedRow.vehicle_id)" @changed="selectedRow = null" />
    </SlideOver>
  </div>
</template>
