<script setup lang="ts">
import TablePagination from "@/components/TablePagination.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import DataTable from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { toneClass } from "@/lib/badges";
import { toggleSort } from "@/lib/sort";
import { useIdlingPage } from "@/features/fleet/useIdlingPage";

const {
  isLoading, isError, error, isFetching, refetch,
  fleet, trkLoading, trkIsError, trkError, trkFetching, trkRefetch,
  trkSearch, trkCapFilter, trkCapOptions, trkConfSel, trkConfOptions, trkSort, trkPage,
  trkFilterCount, trkFiltered, trkPaged, clearTrk, trkColumns,
  usd, usd2, PAGE_SIZE,
  settings, confidence, adoptBand, onAdoptBand,
  tabs, activeTab, showInfo, showConfidence,
  dateFrom, dateTo, rangeLabel, priceNote,
  confTone, confBar, suggestionDiffers, fleetOptimizedPct,
  capBadge, xcheck, scoreTone, recordedLabel, recordedCls,
  drvSearch, drvSort, drvPage, drvFiltered, drvPaged, drvColumns,
  capSearch, capFilter, capOptions, capSort, capPage, capFilterCount, capFiltered, capPaged, clearCap, capColumns,
} = useIdlingPage();
</script>

<template>
  <div class="space-y-6">
    <PageHeader :description="`Avoidable idling costs, driver idle scores, and truck idle-reduction capability — ${rangeLabel}.`" />

    <!-- Which window every card + table below reflects (the date picker lives in the tab toolbars). -->
    <div class="flex items-center gap-2 text-sm">
      <span class="text-ink-muted">Showing</span>
      <span class="rounded-md bg-surface-muted px-2 py-0.5 font-semibold text-ink">{{ rangeLabel }}</span>
    </div>

    <!-- Fleet engine-time summary: running = drive + idle, with the avoidable slice (new model) -->
    <div v-if="fleet" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <BaseCard>
        <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Fleet running time</dt>
        <dd class="mt-1 text-2xl font-bold text-ink">{{ fleet.engineOnH.toLocaleString() }} <span class="text-base font-normal text-ink-subtle">engine-on h</span></dd>
        <dd class="mt-0.5 text-xs text-ink-subtle">{{ fleet.driveH.toLocaleString() }} h driving · {{ fleet.idleH.toLocaleString() }} h idling</dd>
      </BaseCard>
      <BaseCard>
        <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Idle share of runtime</dt>
        <dd class="mt-1 text-2xl font-bold text-ink">{{ fleet.idlePct }}%</dd>
        <dd class="mt-0.5 text-xs text-ink-subtle">of engine-on time was spent idling ({{ fleet.drivePct }}% driving)</dd>
      </BaseCard>
      <BaseCard>
        <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Avoidable idle</dt>
        <dd class="mt-1 text-2xl font-bold text-danger-700">{{ usd(fleet.avoidableUsd) }} <span class="text-base font-normal text-ink-subtle">· {{ fleet.avoidableH.toLocaleString() }} h</span></dd>
        <dd class="mt-0.5 text-xs text-ink-subtle">across {{ fleet.confidentTrucks }}/{{ fleet.totalTrucks }} trucks with confident data</dd>
        <dd class="mt-0.5 text-xs text-ink-subtle" title="Fuel price the idle cost is figured at">{{ priceNote }}</dd>
      </BaseCard>
    </div>

    <!-- Tab strip + info toggle -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex gap-1 rounded-lg bg-surface-muted p-1 text-sm">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="rounded-md px-3 py-1.5 font-medium transition"
          :class="activeTab === t.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink-secondary'"
          @click="activeTab = t.key"
        >
          {{ t.label }} <span class="ml-0.5 text-ink-subtle">{{ t.count }}</span>
        </button>
      </div>
      <div class="flex items-center gap-4">
        <BaseButton variant="ghost" size="sm" @click="showConfidence = !showConfidence">
          Data confidence
          <span v-if="confidence && confidence.overall != null" class="font-bold" :class="confTone(confidence.overall)">{{ confidence.overall }}%</span>
        </BaseButton>
        <BaseButton variant="ghost" size="sm" @click="showInfo = !showInfo">
          {{ showInfo ? "Hide" : "How idle is scored" }}
        </BaseButton>
      </div>
    </div>

    <!-- Collapsible explanation + comfort band (was the always-on top blurb) -->
    <BaseCard v-if="showInfo" padding="sm" class="space-y-3 text-sm">
      <p class="text-ink-secondary">
        We only count idling that could have been avoided: the engine running while parked, in comfortable
        weather, with no work being done. We don't count short stops, idling to run equipment (PTO), or idling to
        heat or cool the cab in extreme weather. Only <strong>avoidable</strong> idle affects a driver's score and
        the wasted-money total.
      </p>
      <p v-if="settings" class="text-ink-secondary">
        <span class="text-ink-muted">Comfortable-weather range (idle outside it counts as weather-excused — heating or cooling the cab):</span>
        <span class="ml-1 font-medium text-ink">{{ settings.comfort_low_f }}–{{ settings.comfort_high_f }}°F</span>
        <span class="ml-1 text-ink-subtle">· idle ≥ {{ settings.min_idle_minutes }} min scored</span>
        <span v-if="suggestionDiffers" class="ml-2 text-brand-600">
          · learned from your data: <strong>{{ settings.suggested_low_f }}–{{ settings.suggested_high_f }}°F</strong>
          <button
            type="button"
            :disabled="adoptBand.isPending.value"
            class="ml-1 rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-ink-inverse hover:bg-brand-500 disabled:opacity-50"
            @click="onAdoptBand"
          >
            {{ adoptBand.isPending.value ? "Adopting…" : "Adopt" }}
          </button>
          <span class="ml-1 text-ink-subtle">then re-sync to re-classify</span>
        </span>
      </p>
      <p v-if="fleetOptimizedPct != null" class="text-ink-secondary">
        <span class="text-ink-muted">Optimized-idle adoption:</span>
        <span class="ml-1 font-medium text-ink">{{ fleetOptimizedPct }}%</span>
        <span class="ml-1 text-ink-subtle">of parked time on APU or optimized idle (learned per truck)</span>
      </p>
    </BaseCard>

    <!-- Data confidence: how complete the inputs behind these numbers are -->
    <BaseCard v-if="showConfidence && confidence" padding="sm" class="space-y-3 text-sm">
      <div class="flex items-center justify-between">
        <p class="font-medium text-ink">Data confidence</p>
        <p v-if="confidence.overall != null" class="text-lg font-bold" :class="confTone(confidence.overall)">{{ confidence.overall }}%</p>
      </div>
      <p class="text-xs text-ink-muted">How complete the inputs behind these numbers are. Raise the low bars to raise your confidence — each note says how.</p>
      <div v-for="m in confidence.metrics" :key="m.key" class="space-y-1">
        <div class="flex items-center justify-between text-xs">
          <span class="text-ink-secondary">{{ m.label }}</span>
          <span class="font-medium tabular-nums" :class="confTone(m.pct)">
            {{ m.total ? m.pct + "%" : "no data yet" }}
            <span class="ml-1 font-normal text-ink-subtle">({{ m.covered }}/{{ m.total }})</span>
          </span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
          <div class="h-full rounded-full" :class="confBar(m.pct)" :style="{ width: (m.total ? m.pct : 0) + '%' }"></div>
        </div>
        <p class="text-xs text-ink-subtle">{{ m.note }}</p>
      </div>
    </BaseCard>

    <!-- ── TAB: Trucks — engine-on = drive + idle, avoidable ─────────────────── -->
    <template v-if="activeTab === 'trucks'">
      <FilterBar
        v-model:search="trkSearch"
        search-placeholder="Search truck…"
        :count="trkFiltered.length"
        count-label="trucks"
      >
        <template #filters>
          <DateRangeFilter v-model:from="dateFrom" v-model:to="dateTo" />
          <FilterSelect v-model="trkCapFilter" label="Capability" :options="trkCapOptions" />
          <FilterSelect v-model="trkConfSel" label="Data" :options="trkConfOptions" />
        </template>
        <template #actions>
          <BaseButton v-if="trkFilterCount" variant="ghost" size="sm" @click="clearTrk">Clear filters</BaseButton>
        </template>
      </FilterBar>
      <DataTable
        :columns="trkColumns"
        :rows="trkPaged"
        row-key="vehicleId"
        :loading="trkLoading"
        :error="trkIsError ? (trkError instanceof Error ? trkError.message : 'Failed to load') : null"
        :retrying="trkFetching"
        :sort="trkSort"
        empty-text="No engine-state data yet — run a Samsara sync from Settings → Data &amp; Sync to populate the idle foundation."
        :row-class="(t) => (t.confident ? '' : 'opacity-60')"
        @sort="trkSort = toggleSort(trkSort, $event)"
        @retry="trkRefetch"
      >
        <template #cell-idlePct="{ value }">{{ value }}%</template>
        <template #cell-avoidableUsd="{ value }">{{ usd2(value) }}</template>
        <template #cell-capability="{ value }">
          <span :class="['inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', capBadge(value).cls]" title="Learned from the truck's engine on/off pattern">{{ capBadge(value).label }}</span>
        </template>
        <template #cell-coveragePct="{ row }">
          <span
            :class="row.confident ? 'text-ink-secondary' : 'text-warning-600'"
            :title="row.confident ? 'Enough data to trust and score' : 'Thin data — excluded from the fleet avoidable total'"
          >
            {{ row.coveragePct }}%<span v-if="!row.confident" class="ml-1 text-xs font-medium">· low</span>
          </span>
        </template>
        <template #footer>
          <TablePagination :page="trkPage" :page-size="PAGE_SIZE" :total="trkFiltered.length" @update:page="trkPage = $event" />
        </template>
      </DataTable>
    </template>

    <!-- ── TAB: Drivers ──────────────────────────────────────────────────────── -->
    <template v-else-if="activeTab === 'drivers'">
      <FilterBar
        v-model:search="drvSearch"
        search-placeholder="Search driver…"
        :count="drvFiltered.length"
        count-label="drivers"
      >
        <template #filters>
          <DateRangeFilter v-model:from="dateFrom" v-model:to="dateTo" />
        </template>
      </FilterBar>
      <DataTable
        :columns="drvColumns"
        :rows="drvPaged"
        row-key="driverId"
        :loading="isLoading"
        :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
        :retrying="isFetching"
        :sort="drvSort"
        empty-text="No idle data yet — run a Samsara sync from Settings → Data &amp; Sync to populate the idle foundation."
        :row-class="(d) => (d.driverId === '__unattributed__' ? 'bg-surface-subtle/60' : '')"
        @sort="drvSort = toggleSort(drvSort, $event)"
        @retry="refetch"
      >
        <template #cell-driverName="{ row }">
          <span class="font-medium" :class="row.driverId === '__unattributed__' ? 'text-ink-subtle italic' : 'text-ink'">
            {{ row.driverName }}<span v-if="row.driverId === '__unattributed__'" class="ml-1 text-xs font-normal">(no driver assigned by Samsara)</span>
          </span>
        </template>
        <template #cell-score="{ row }">
          <span v-if="row.score != null" class="font-bold" :class="scoreTone(row.score)">{{ row.score }}</span>
          <span v-else class="text-ink-subtle">—</span>
        </template>
        <template #cell-idlePct="{ value }">{{ value }}%</template>
        <template #cell-avoidableUsd="{ value }">{{ usd2(value) }}</template>
        <template #footer>
          <TablePagination :page="drvPage" :page-size="PAGE_SIZE" :total="drvFiltered.length" @update:page="drvPage = $event" />
        </template>
      </DataTable>
    </template>

    <!-- ── TAB: Truck capability ─────────────────────────────────────────────── -->
    <template v-else>
      <FilterBar
        v-model:search="capSearch"
        search-placeholder="Search truck…"
        :count="capFiltered.length"
        count-label="trucks"
      >
        <template #filters>
          <FilterSelect v-model="capFilter" label="Capability" :options="capOptions" />
        </template>
        <template #actions>
          <BaseButton v-if="capFilterCount" variant="ghost" size="sm" @click="clearCap">Clear filters</BaseButton>
        </template>
      </FilterBar>
      <DataTable
        :columns="capColumns"
        :rows="capPaged"
        row-key="unit_number"
        :sort="capSort"
        empty-text="No trucks match. Set each truck's idle-reduction equipment on the Vehicles page; the data column fills in after a Samsara sync."
        :row-class="(t) => (t.cross_check === 'disagree' ? 'bg-danger-50/40' : '')"
        @sort="capSort = toggleSort(capSort, $event)"
      >
        <template #cell-recorded="{ row }">
          <span :class="['inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', recordedCls(row)]" title="What you recorded on the Vehicles page">{{ recordedLabel(row) }}</span>
          <span v-if="row.has_optimized_idle === true" :class="['ml-1 inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', toneClass('success')]" title="OEM optimized idle recorded">Optimized idle</span>
        </template>
        <template #cell-idle_capability="{ value }">
          <span :class="['inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', capBadge(value).cls]" title="Learned from the truck's engine on/off pattern">{{ capBadge(value).label }}</span>
        </template>
        <template #cell-idle_optimized_pct="{ value }">{{ value }}%</template>
        <template #cell-cross_check="{ value }">
          <span class="font-semibold" :class="xcheck(value).cls" :title="xcheck(value).title">{{ xcheck(value).label }}</span>
        </template>
        <template #footer>
          <TablePagination :page="capPage" :page-size="PAGE_SIZE" :total="capFiltered.length" @update:page="capPage = $event" />
        </template>
      </DataTable>
    </template>
  </div>
</template>
