<script setup lang="ts">
import { formatRuleId } from "@fuelguard/shared";
import SlideOver from "@/components/SlideOver.vue";
import AnomalyDetail from "@/features/anomalies/AnomalyDetail.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import TablePagination from "@/components/TablePagination.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import { BADGE_BASE, severityTone, statusTone } from "@/lib/badges";
import { useAnomaliesPage } from "./useAnomaliesPage";

const {
  filters, search,
  status, severity, vehicleId, statusOptions, severityOptions, unitOptions,
  setFrom, setTo, activeFilterCount, resetFilters,
  session,
  unit, pairedTrailer, driverName,
  columns, sort, onSort,
  total, pageRows, page, PAGE_SIZE,
  isLoading, isError, error, isFetching, refetch,
  selectedIds, setSelected, selectedCount, isActionable, busy, bulkTransition, rowAction,
  selectedRow, fmt,
} = useAnomaliesPage();
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Fuel-card alerts from anomaly detection — theft, misuse, and data-quality signals across your fleet." />

    <!-- Tabs: all alerts vs reefer-fueling cases (design-system segmented control) -->
    <div class="flex w-fit gap-1 rounded-lg bg-surface-muted p-1 text-sm">
      <button
        class="rounded-md px-3 py-1.5 font-medium transition"
        :class="!filters.reeferOnly ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink-secondary'"
        @click="filters = { ...filters, reeferOnly: undefined }"
      >
        All alerts
      </button>
      <button
        class="rounded-md px-3 py-1.5 font-medium transition"
        :class="filters.reeferOnly ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink-secondary'"
        @click="filters = { ...filters, reeferOnly: true }"
      >
        Reefer fueling
      </button>
    </div>

    <BaseCard v-if="filters.reeferOnly" as="div">
      <p class="text-sm text-ink-secondary">
        Reefer-fueling alerts flag trucks that haul a reefer but may be fueling it with ULSD selected at the pump —
        a reefer-hauling truck buying little or no reefer (ULSR) fuel, or a ULSD fill that didn't fully enter the
        tractor tank. Each row shows the truck, its paired reefer trailer, and the driver on the flagged fill.
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
        <FilterSelect v-model="vehicleId" label="Unit" :options="unitOptions" />
        <DateRangeFilter :from="filters.from" :to="filters.to" @update:from="setFrom" @update:to="setTo" />
      </template>
      <template #actions>
        <BaseButton v-if="activeFilterCount" variant="ghost" size="sm" @click="resetFilters">Clear filters</BaseButton>
        <BaseButton
          v-if="session.canManage"
          variant="ghost"
          size="sm"
          to="/settings/data"
          title="Rebuild and Re-sync Samsara moved to Settings → Data & Sync (with live progress)"
        >
          Rebuild / Re-sync →
        </BaseButton>
      </template>
    </FilterBar>

    <!-- Bulk action bar -->
    <div
      v-if="selectedCount > 0"
      class="flex flex-col gap-2 rounded-lg bg-brand-50 px-4 py-3 ring-1 ring-brand-200 sm:flex-row sm:items-center sm:justify-between"
    >
      <span class="text-sm font-medium text-brand-900">{{ selectedCount }} selected</span>
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
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load anomalies') : null"
      :retrying="isFetching"
      empty-text="Nothing here — no alerts match these filters."
      :sort="sort"
      :selectable="session.canManage"
      :selected="selectedIds"
      :row-class="(row) => isActionable(row) ? 'cursor-pointer' : 'cursor-pointer bg-surface-subtle/50 opacity-60'"
      @update:selected="setSelected"
      @sort="onSort"
      @row-click="selectedRow = $event"
      @retry="refetch"
    >
      <template #cell-severity="{ row }">
        <span :class="[BADGE_BASE, severityTone(row.severity)]">{{ row.severity }}</span>
      </template>
      <template #cell-type="{ row }">{{ formatRuleId(row.rule_id) }}</template>
      <template #cell-vehicle="{ row }">{{ unit(row.vehicle_id) }}</template>
      <template #cell-trailer="{ row }">{{ pairedTrailer(row.vehicle_id) }}</template>
      <template #cell-driver="{ row }">{{ driverName(row) }}</template>
      <template #cell-status="{ row }">
        <span :class="[BADGE_BASE, statusTone(row.status)]">{{ row.status }}</span>
      </template>
      <template #cell-when="{ row }">
        <span :title="`Detected ${fmt(row.created_at)}`">{{ fmt(row.fueled_at ?? row.created_at) }}</span>
      </template>
      <template #actions="{ row }">
        <KebabMenu v-if="session.canManage && isActionable(row)">
          <button class="kebab-item" @click="selectedRow = row">Review details</button>
          <button v-if="row.status === 'open'" class="kebab-item" @click="rowAction(row, 'investigating')">Start investigating</button>
          <button class="kebab-item" @click="rowAction(row, 'resolved', 'Resolved by reviewer', 'confirmed')">Resolve</button>
          <button class="kebab-item kebab-item-danger" @click="rowAction(row, 'dismissed', 'False alarm', 'false_positive')">False alarm</button>
        </KebabMenu>
        <button v-else class="text-sm font-medium text-brand-600 hover:text-brand-500" @click="selectedRow = row">Review</button>
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
