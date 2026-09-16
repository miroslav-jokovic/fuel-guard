<script setup lang="ts">
import { ref } from "vue";
import { AppCard as BaseCard, AppCallout } from "@silvicom/ui";
import type { LiveMapVehicle, VehicleMapState } from "@silvicom/shared";
import DataTable from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { BADGE_BASE, vehicleStateTone } from "@/lib/badges";
import LiveMapCanvas from "./LiveMapCanvas.vue";
import LiveMapLegend from "./LiveMapLegend.vue";
import LiveMapVehicleDrawer from "./LiveMapVehicleDrawer.vue";
import { useLiveMapView, LIVE_MAP_COLUMNS } from "./useLiveMapView";
import { STATE_LABEL, formatAge } from "./liveMapLayer";

/**
 * Where the fleet is (LIVE-MAP-PLAN.md LM8).
 *
 * ── IT IS NOW THE DASHBOARD'S READING OF THE BOARD, AND ONLY THAT (D-DR5) ────────────────────────
 * It was both: `/live-map` rendered it and LM-T embeds it as the Dashboard's Dispatch tab (D-DW5 —
 * the tab is the glance, the page is the work, and neither substitutes for the other). DR5 gave the
 * PAGE a second shape — a full-bleed workspace with floating panels, `LiveMapWorkspace.vue` — and
 * the widget kept this one, because floating panels over a card inside a dashboard grid would be a
 * workspace in a 400px box.
 *
 * ⚠ The two shapes share their STATE, not their markup: `useLiveMapView` holds the filters, the
 * selection, the census and the two different empty sentences, so there is one answer to each of
 * those and not two that can drift. Do not re-derive any of them here.
 *
 * ── THE MAP AND THE TABLE ARE ONE SURFACE, NOT A MAP WITH A LIST UNDER IT ────────────────────────
 * The markers carry no unit number and cannot: a maplibre `text-field` needs the style to declare a
 * `glyphs` endpoint, and this product's style is one raster source pointed at our own authenticated
 * tile proxy. Rather than send users to a third party for fonts, the table beneath is where a truck
 * is identified, sorted and searched — and it is also the accessible reading of a canvas that
 * screen readers cannot enter.
 *
 * ── NO PAGINATION, DELIBERATELY ──────────────────────────────────────────────────────────────────
 * 199 rows that rewrite themselves every five seconds. A page-2 that reshuffled under the reader on
 * every poll would be worse than a scroll, and `DataTable` already scrolls its own body with the
 * header pinned. If this fleet ever reached a size where that stopped being true, the endpoint's
 * `truncated` flag is the honest place to notice it.
 */
const {
  board,
  filters,
  selectedId,
  counts,
  filtered,
  selected,
  stateFilter,
  stateOptions,
  emptyText,
  errorMessage,
  setSearch,
} = useLiveMapView();

const canvas = ref<InstanceType<typeof LiveMapCanvas> | null>(null);

function select(vehicle: LiveMapVehicle): void {
  selectedId.value = vehicle.vehicleId;
  canvas.value?.flyTo(vehicle.vehicleId);
}
</script>

<template>
  <div class="space-y-4">
    <!--
      ⚠ REQUIRED, not decorative (D-LM18). The board is fleet-wide because McLeod has not granted the
      dispatcher on each load, and a dispatcher who believes they are seeing only their own trucks
      will read an empty column as "nothing of mine is late". Saying so out loud is the difference
      between a limitation and a lie. The sentence comes from the response, so it stops appearing by
      itself on the day the scope becomes real.
    -->
    <AppCallout v-if="board.data.value && board.data.value.scope === 'all'" tone="info">
      {{ board.data.value.scopeReason }}
    </AppCallout>

    <FilterBar
      :search="filters.search"
      search-placeholder="Unit or driver"
      :count="filtered.length"
      count-label="trucks"
      @update:search="setSearch($event)"
    >
      <template #filters>
        <FilterSelect v-model="stateFilter" multiple label="Status" :options="stateOptions" />
      </template>
    </FilterBar>

    <BaseCard v-if="board.data.value" padding="none">
      <LiveMapCanvas
        ref="canvas"
        :vehicles="filtered"
        :generated-at="board.data.value.generatedAt"
        :selected-id="selectedId"
        @select="selectedId = $event"
      />
      <LiveMapLegend :counts="counts" :bounds="board.data.value.bounds" />
    </BaseCard>

    <DataTable
      :columns="LIVE_MAP_COLUMNS"
      :rows="filtered"
      row-key="vehicleId"
      :loading="board.isLoading.value"
      :error="errorMessage"
      :retrying="board.isFetching.value"
      :empty-text="emptyText"
      @row-click="select"
      @retry="board.refetch()"
    >
      <template #cell-driver="{ row }">
        <span :class="row.driver ? 'text-ink' : 'text-ink-muted'">{{ row.driver?.name ?? "Unassigned" }}</span>
      </template>
      <template #cell-state="{ row }">
        <span :class="[BADGE_BASE, vehicleStateTone(row.state)]">{{ STATE_LABEL[row.state as VehicleMapState] }}</span>
      </template>
      <template #cell-speed="{ row }">
        {{ row.position.speedMph == null ? "—" : `${Math.round(row.position.speedMph)} mph` }}
      </template>
      <!-- D-LM10: the age of the fix, per truck, never hidden behind the marker. -->
      <template #cell-age="{ row }">{{ formatAge(row.ageSeconds) }}</template>
      <template #cell-location="{ row }">{{ row.position.formattedLocation ?? "—" }}</template>
      <template #cell-load="{ row }">
        <span :class="row.load ? 'text-ink' : 'text-ink-muted'">{{ row.load?.ref ?? "No load" }}</span>
      </template>
    </DataTable>

    <LiveMapVehicleDrawer :vehicle="selected" @close="selectedId = null" />
  </div>
</template>
