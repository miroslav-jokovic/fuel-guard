<script setup lang="ts">
import TablePagination from "@/components/TablePagination.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import { AppButton as BaseButton, AppTabs } from "@silvicom/ui";
import { AppCard as BaseCard, AppIcon } from "@silvicom/ui";
import { ChevronDownIcon, ChevronRightIcon } from "@silvicom/ui/icons";
import DataTable from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import SamsaraFeedLine from "@/components/SamsaraFeedLine.vue";
import { toneClass } from "@/lib/badges";
import { toggleSort } from "@/lib/sort";
import { useIdlingPage } from "@/features/idle/useIdlingPage";
import IdleBurnRatesPanel from "@/features/idle/IdleBurnRatesPanel.vue";
import IdleEngineParityPanel from "@/features/idle/IdleEngineParityPanel.vue";

const {
  isLoading, isError, error, isFetching, refetch,
  fleet, trkLoading, trkIsError, trkError, trkFetching, trkRefetch,
  trkSearch, trkCapFilter, trkCapOptions, trkConfSel, trkConfOptions, trkSort, trkPage,
  trkFilterCount, trkFiltered, trkPaged, clearTrk, trkColumns, trkExpanded, toggleTrk, trkDetail,
  usd, usd2, PAGE_SIZE,
  settings, confidence, adoptBand, onAdoptBand,
  tabs, answered, activeTab, showInfo, showConfidence,
  dateFrom, dateTo, rangeLabel, estimate,
  confTone, confBar, suggestionDiffers, fleetOptimizedPct,
  capBadge, behavesBadge, sourceLabel, xcheck, scoreTone, recordedLabel, recordedCls,
  drvSearch, drvSort, drvPage, drvFiltered, drvPaged, drvColumns,
  capSearch, capFilter, capOptions, capSort, capPage, capFilterCount, capFiltered, capPaged, clearCap, capColumns,
  capLoading, capIsError, capError, capFetching, capRefetch,
} = useIdlingPage();
</script>

<template>
  <div class="space-y-6">
    <PageHeader :description="`Avoidable idling costs, driver idle scores, and truck idle-reduction capability — ${rangeLabel}.`" />

    <!-- SAM-S5: how current the telematics behind this page is, before its numbers are believed.
         Every figure below is an idle_rollup_days row, and that table is only as current as its tier. -->
    <SamsaraFeedLine :feeds="['idle']" />

    <!-- Which window every card + table below reflects (the date picker lives in the tab toolbars). -->
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span class="text-ink-muted">Showing</span>
      <span class="rounded-control bg-surface-muted px-2 py-0.5 font-semibold text-ink">{{ rangeLabel }}</span>
      <!-- How far the data reaches, and that the table's filters don't narrow the cards (design verdict, move 4). -->
      <span v-if="estimate" class="text-xs text-ink-tertiary" data-testid="idle-scope">{{ estimate.scope }}</span>
    </div>

    <!-- Fleet engine-time summary: running = drive + idle, with BOTH idle measures — avoidable (waste on
         trucks that had an alternative) and reducible (what equipping the rest of the fleet would save).
         Each money card carries its own coverage and pricing lines (design verdict, move 4). The dollars are
         plain ink, as on Fuel Costs (Q-FSV15 ruling 2, extended here 2026-10-04): a total says how much, not
         whether it is good news — avoidable idle is a coaching queue and "Needs an APU" an investment case. -->
    <div v-if="fleet" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <BaseCard>
        <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Fleet running time</dt>
        <dd class="mt-1 text-2xl font-bold text-ink">{{ fleet.engineOnH.toLocaleString() }} <span class="text-base font-normal text-ink-tertiary">engine-on h</span></dd>
        <dd class="mt-0.5 text-xs text-ink-tertiary">{{ fleet.driveH.toLocaleString() }} h driving · {{ fleet.idleH.toLocaleString() }} h idling</dd>
      </BaseCard>
      <BaseCard>
        <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Idle share of runtime</dt>
        <dd class="mt-1 text-2xl font-bold text-ink">{{ fleet.idlePct }}%</dd>
        <dd class="mt-0.5 text-xs text-ink-tertiary">of engine-on time was spent idling ({{ fleet.drivePct }}% driving)</dd>
      </BaseCard>
      <BaseCard>
        <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Avoidable idle</dt>
        <dd class="mt-1 text-2xl font-bold text-ink" data-testid="avoidable-usd">{{ usd(fleet.avoidableUsd) }} <span class="text-base font-normal text-ink-tertiary">· {{ fleet.avoidableH.toLocaleString() }} h</span></dd>
        <dd class="mt-0.5 text-xs text-ink-tertiary" data-testid="avoidable-coverage">{{ estimate?.avoidableCoverage }}</dd>
        <dd v-if="estimate?.avoidablePricing" class="mt-0.5 text-xs text-ink-tertiary" data-testid="avoidable-pricing">{{ estimate.avoidablePricing }}</dd>
      </BaseCard>
      <BaseCard>
        <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Needs an APU</dt>
        <dd class="mt-1 text-2xl font-bold text-ink" data-testid="reducible-usd">{{ usd(fleet.reducibleUsd) }} <span class="text-base font-normal text-ink-tertiary">· {{ fleet.reducibleH.toLocaleString() }} h</span></dd>
        <dd class="mt-0.5 text-xs text-ink-tertiary">rest idle an APU or optimized idle would carry — the case for fitting it, not waste to coach</dd>
        <dd class="mt-0.5 text-xs text-ink-tertiary" data-testid="reducible-coverage">{{ estimate?.reducibleCoverage }}</dd>
        <dd v-if="estimate?.reduciblePricing" class="mt-0.5 text-xs text-ink-tertiary" data-testid="reducible-pricing">{{ estimate.reduciblePricing }}</dd>
      </BaseCard>
    </div>

    <!-- Tab strip + the two disclosures. The strip was hand-rolled buttons with no tab semantics and the
         disclosures announced no state; `AppTabs` and `aria-expanded` are what a keyboard and a screen
         reader need (design verdict, E8). A disclosure names its region only while it exists. -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <AppTabs v-model="activeTab" :tabs="tabs" label="Idling views" id-prefix="idling" />
      <div class="flex items-center gap-4">
        <BaseButton
          variant="ghost"
          size="sm"
          :aria-expanded="showConfidence"
          :aria-controls="showConfidence && confidence ? 'idling-completeness' : undefined"
          @click="showConfidence = !showConfidence"
        >
          Data completeness
          <span v-if="confidence && confidence.overall != null" class="font-bold" :class="confTone(confidence.overall)">{{ confidence.overall }}%</span>
          <AppIcon :icon="showConfidence ? ChevronDownIcon : ChevronRightIcon" class="size-4" aria-hidden="true" />
        </BaseButton>
        <BaseButton
          variant="ghost"
          size="sm"
          :aria-expanded="showInfo"
          :aria-controls="showInfo ? 'idling-how-scored' : undefined"
          @click="showInfo = !showInfo"
        >
          How idle is scored
          <AppIcon :icon="showInfo ? ChevronDownIcon : ChevronRightIcon" class="size-4" aria-hidden="true" />
        </BaseButton>
      </div>
    </div>

    <!-- Collapsible explanation + comfort band (was the always-on top blurb) -->
    <div v-if="showInfo" id="idling-how-scored" class="space-y-6">
    <BaseCard padding="sm" class="space-y-3 text-sm">
      <p class="text-ink-secondary">
        <strong>Avoidable idle</strong> is waste we can coach: the truck had an APU or optimized idle recorded on
        its Vehicles page, and the main engine ran while parked anyway — in comfortable weather, with no work being
        done. We don't count short stops, idling to run equipment (PTO), or idling to heat or cool the cab in
        extreme weather. Only avoidable idle affects a driver's score and the wasted-money total.
      </p>
      <p class="text-ink-secondary">
        <strong>Needs an APU</strong> answers a different question: how much rest idle an APU or
        optimized idle <em>would</em> have carried — shown for every truck, including those with no idle-reduction
        equipment. On those trucks the driver wasted nothing, so avoidable is correctly zero; reducible is what
        fitting equipment would be worth. A truck with no equipment recorded yet shows reducible hours and is
        waiting on its Vehicles page entry before it can be scored for avoidable idle.
      </p>
      <p v-if="settings" class="text-ink-secondary">
        <span class="text-ink-muted">Comfortable-weather range (idle outside it counts as weather-excused — heating or cooling the cab):</span>
        <span class="ml-1 font-medium text-ink">{{ settings.comfort_low_f }}–{{ settings.comfort_high_f }}°F</span>
        <span class="ml-1 text-ink-tertiary">· idle ≥ {{ settings.min_idle_minutes }} min scored</span>
        <span v-if="suggestionDiffers" class="ml-2 text-brand-600">
          · learned from your data: <strong>{{ settings.suggested_low_f }}–{{ settings.suggested_high_f }}°F</strong>
          <BaseButton
            type="button"
            :disabled="adoptBand.isPending.value"
            class="ml-1 rounded-control bg-action-primary px-2 py-0.5 text-xs font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-50"
            @click="onAdoptBand"
          >
            {{ adoptBand.isPending.value ? "Adopting…" : "Adopt" }}
          </BaseButton>
          <span class="ml-1 text-ink-tertiary">then re-sync to re-classify</span>
        </span>
      </p>
      <p v-if="fleetOptimizedPct != null" class="text-ink-secondary">
        <span class="text-ink-muted">Optimized-idle adoption:</span>
        <span class="ml-1 font-medium text-ink">{{ fleetOptimizedPct }}%</span>
        <span class="ml-1 text-ink-tertiary">of parked time on APU or optimized idle (learned per truck)</span>
      </p>
    </BaseCard>
    <!-- IE4: the measured idle burn rate beside the configured one (a table carries its own card) -->
    <IdleBurnRatesPanel />
    <!-- IE5: how far the new idle engine is from replacing the figures above (D-IE9) -->
    <IdleEngineParityPanel />
    </div>

    <!-- Data completeness: how complete the inputs behind these numbers are -->
    <BaseCard v-if="showConfidence && confidence" id="idling-completeness" padding="sm" class="space-y-3 text-sm">
      <div class="flex items-center justify-between">
        <p class="font-medium text-ink">Data completeness</p>
        <p v-if="confidence.overall != null" class="text-lg font-bold" :class="confTone(confidence.overall)">{{ confidence.overall }}%</p>
      </div>
      <p class="text-xs text-ink-muted">How complete the inputs behind these numbers are. Raise the low bars to raise your confidence — each note says how.</p>
      <div v-for="m in confidence.metrics" :key="m.key" class="space-y-1">
        <div class="flex items-center justify-between text-xs">
          <span class="text-ink-secondary">{{ m.label }}</span>
          <span class="font-medium tabular-nums" :class="confTone(m.pct)">
            {{ m.total ? m.pct + "%" : "no data yet" }}
            <span class="ml-1 font-normal text-ink-tertiary">({{ m.covered }}/{{ m.total }})</span>
          </span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
          <div class="h-full rounded-full" :class="confBar(m.pct)" :style="{ width: (m.total ? m.pct : 0) + '%' }"></div>
        </div>
        <p class="text-xs text-ink-tertiary">{{ m.note }}</p>
      </div>
    </BaseCard>

    <!-- ── TAB: Trucks — engine-on = drive + idle, avoidable ─────────────────── -->
    <div v-if="activeTab === 'trucks'" id="idling-panel-trucks" role="tabpanel" aria-labelledby="idling-tab-trucks" class="space-y-6">
      <FilterBar
        v-model:search="trkSearch"
        search-placeholder="Search truck…"
        :count="answered.trucks ? trkFiltered.length : null"
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
        :expanded="trkExpanded"
        empty-text="No engine-state data yet — run a Samsara sync from Settings → Data &amp; Sync to populate the idle foundation."
        :row-class="(t) => (t.confident ? '' : 'opacity-60')"
        @sort="trkSort = toggleSort(trkSort, $event)"
        @retry="trkRefetch"
        @row-click="toggleTrk"
      >
        <template #cell-unit="{ row }">
          <span class="flex items-center gap-2">
            <BaseButton
              variant="ghost"
              size="sm"
              :aria-expanded="trkExpanded.has(row.vehicleId)"
              :aria-label="`${trkExpanded.has(row.vehicleId) ? 'Hide' : 'Show'} where truck ${row.unit}'s running time went`"
              @click.stop="toggleTrk(row)"
            >
              <AppIcon :icon="trkExpanded.has(row.vehicleId) ? ChevronDownIcon : ChevronRightIcon" class="size-4" aria-hidden="true" />
            </BaseButton>
            {{ row.unit }}
          </span>
        </template>
        <template #cell-idlePct="{ value }">{{ value }}%</template>
        <template #cell-avoidableUsd="{ value }">{{ usd2(value) }}</template>
        <template #cell-reducibleH="{ row }">{{ row.reducibleH == null ? "—" : row.reducibleH }}</template>
        <template #cell-reducibleUsd="{ row }">{{ row.reducibleUsd == null ? "—" : usd2(row.reducibleUsd) }}</template>
        <template #cell-coveragePct="{ row }">
          <span
            :class="row.confident ? 'text-ink-secondary' : 'text-warning-600'"
            :title="row.confident ? 'Enough data to trust and score' : 'Thin data — excluded from the fleet avoidable total'"
          >
            {{ row.coveragePct }}%<span v-if="!row.confident" class="ml-1 text-xs font-medium">· low</span>
          </span>
        </template>
        <!-- Where the truck's running time went: the split behind its costs, one click away (design verdict, E3). -->
        <template #expanded="{ row }">
          <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6" data-testid="truck-detail">
            <div v-for="d in trkDetail(row)" :key="d.label">
              <dt class="text-xs text-ink-muted">{{ d.label }}</dt>
              <dd class="tabular-nums text-ink">{{ d.value }}</dd>
            </div>
            <div>
              <dt class="text-xs text-ink-muted">Idle capability</dt>
              <dd>
                <span :class="['inline-flex rounded-control px-1.5 py-0.5 text-xs font-semibold', capBadge(row.capability).cls]" title="Learned from the truck's engine on/off pattern">{{ capBadge(row.capability).label }}</span>
              </dd>
            </div>
          </dl>
        </template>
        <template #footer>
          <TablePagination :page="trkPage" :page-size="PAGE_SIZE" :total="trkFiltered.length" @update:page="trkPage = $event" />
        </template>
      </DataTable>
    </div>

    <!-- ── TAB: Drivers ──────────────────────────────────────────────────────── -->
    <div v-else-if="activeTab === 'drivers'" id="idling-panel-drivers" role="tabpanel" aria-labelledby="idling-tab-drivers" class="space-y-6">
      <FilterBar
        v-model:search="drvSearch"
        search-placeholder="Search driver…"
        :count="answered.drivers ? drvFiltered.length : null"
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
          <span class="font-medium" :class="row.driverId === '__unattributed__' ? 'text-ink-tertiary italic' : 'text-ink'">
            {{ row.driverName }}<span v-if="row.driverId === '__unattributed__'" class="ml-1 text-xs font-normal">(no driver assigned by Samsara)</span>
          </span>
        </template>
        <template #cell-score="{ row }">
          <span v-if="row.score != null" class="font-bold" :class="scoreTone(row.score)">{{ row.score }}</span>
          <span v-else class="text-ink-tertiary">—</span>
        </template>
        <template #cell-idlePct="{ value }">{{ value }}%</template>
        <template #cell-avoidableUsd="{ value }">{{ usd2(value) }}</template>
        <template #footer>
          <TablePagination :page="drvPage" :page-size="PAGE_SIZE" :total="drvFiltered.length" @update:page="drvPage = $event" />
        </template>
      </DataTable>
    </div>

    <!-- ── TAB: Truck capability ─────────────────────────────────────────────── -->
    <div v-else id="idling-panel-capability" role="tabpanel" aria-labelledby="idling-tab-capability" class="space-y-6">
      <FilterBar
        v-model:search="capSearch"
        search-placeholder="Search truck or batch…"
        :count="answered.capability ? capFiltered.length : null"
        count-label="trucks"
      >
        <template #filters>
          <FilterSelect v-model="capFilter" label="Long parks" :options="capOptions" />
        </template>
        <template #actions>
          <BaseButton v-if="capFilterCount" variant="ghost" size="sm" @click="clearCap">Clear filters</BaseButton>
        </template>
      </FilterBar>
      <DataTable
        :columns="capColumns"
        :rows="capPaged"
        row-key="unit_number"
        :loading="capLoading"
        :error="capIsError ? (capError instanceof Error ? capError.message : 'Failed to load') : null"
        :retrying="capFetching"
        :sort="capSort"
        empty-text="No trucks match. Recorded equipment is set on the Vehicles page; the long-park columns fill in as trucks park for four hours or more."
        :row-class="(t) => (t.cross_check === 'disagree' ? 'bg-danger-50/40' : '')"
        @sort="capSort = toggleSort(capSort, $event)"
        @retry="capRefetch"
      >
        <template #cell-recorded="{ row }">
          <span :class="['inline-flex rounded-control px-1.5 py-0.5 text-xs font-semibold', recordedCls(row)]" :title="`Recorded: ${sourceLabel(row.equipment_source)}`">{{ recordedLabel(row) }}</span>
          <span v-if="row.has_optimized_idle === true" :class="['ml-1 inline-flex rounded-control px-1.5 py-0.5 text-xs font-semibold', toneClass('success')]" title="OEM optimized idle recorded">Optimized idle</span>
        </template>
        <template #cell-batch="{ value }">{{ value ?? "–" }}</template>
        <template #cell-behaves_like="{ row }">
          <span :class="['inline-flex rounded-control px-1.5 py-0.5 text-xs font-semibold', behavesBadge(row.behaves_like).cls]" :title="`${row.parks} parks of 4 hours or more`">{{ behavesBadge(row.behaves_like).label }}</span>
        </template>
        <template #cell-idling_pct="{ value }">{{ value == null ? "–" : `${value}%` }}</template>
        <template #cell-off_pct="{ value }">{{ value == null ? "–" : `${value}%` }}</template>
        <template #cell-cross_check="{ value }">
          <span class="font-semibold" :class="xcheck(value).cls" :title="xcheck(value).title">{{ xcheck(value).label }}</span>
        </template>
        <template #footer>
          <TablePagination :page="capPage" :page-size="PAGE_SIZE" :total="capFiltered.length" @update:page="capPage = $event" />
        </template>
      </DataTable>
    </div>
  </div>
</template>
