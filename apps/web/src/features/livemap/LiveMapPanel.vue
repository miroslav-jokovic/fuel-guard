<script setup lang="ts">
import { computed, ref } from "vue";
import { AppCard as BaseCard, AppCallout } from "@silvicom/ui";
import type { LiveMapVehicle, VehicleMapState } from "@silvicom/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { BADGE_BASE, vehicleStateTone } from "@/lib/badges";
import LiveMapCanvas from "./LiveMapCanvas.vue";
import LiveMapLegend from "./LiveMapLegend.vue";
import LiveMapVehicleDrawer from "./LiveMapVehicleDrawer.vue";
import { useLiveMapBoard } from "./useLiveMapBoard";
import {
  MAP_STATES,
  STATE_LABEL,
  EMPTY_FILTERS,
  filterVehicles,
  formatAge,
  stateCounts,
  type LiveMapFilters,
} from "./liveMapLayer";

/**
 * Where the fleet is (LIVE-MAP-PLAN.md LM8).
 *
 * ── A PANEL RATHER THAN A PAGE, BECAUSE IT IS ABOUT TO HAVE TWO HOMES ────────────────────────────
 * `/live-map` is the work surface; LM-T embeds this same component as the Dashboard's Dispatch tab
 * (D-DW5 — the tab is the glance, the page is the work, and neither substitutes for the other). It
 * is written as a panel now so the second caller is a second call and not a second copy.
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
const board = useLiveMapBoard();

const filters = ref<LiveMapFilters>({ ...EMPTY_FILTERS });
const selectedId = ref<string | null>(null);
const canvas = ref<InstanceType<typeof LiveMapCanvas> | null>(null);

const vehicles = computed<LiveMapVehicle[]>(() => board.data.value?.vehicles ?? []);
const filtered = computed(() => filterVehicles(vehicles.value, filters.value));
const counts = computed(() => stateCounts(vehicles.value));
const selected = computed(() => vehicles.value.find((v) => v.vehicleId === selectedId.value) ?? null);

/**
 * The state filter, with the census in the option labels.
 *
 * ⚠ The dispatcher and load-status filters LM8 first listed are NOT here. `tms_dispatchers` does not
 * exist in this database — it is downstream of the McLeod `VIEW CHANGE TRACKING` grant the carrier
 * has not given — and `loads` holds 0 rows until LM12. An empty dropdown does not read as "not yet";
 * it reads as "this page is broken", and a dispatcher who concluded that would be right.
 */
const stateOptions = computed(() =>
  MAP_STATES.map((state) => ({ value: state, label: `${STATE_LABEL[state]} (${counts.value[state]})` })),
);

const stateFilter = computed<string[]>({
  get: () => [...filters.value.states],
  set: (value) => { filters.value = { ...filters.value, states: value as VehicleMapState[] }; },
});

const COLUMNS: DataTableColumn[] = [
  { key: "unitNumber", label: "Unit", sortable: true, width: "xs" },
  { key: "driver", label: "Driver", sortable: true, width: "md" },
  { key: "state", label: "Status", width: "sm" },
  { key: "speed", label: "Speed", numeric: true, width: "xs" },
  { key: "age", label: "Last fix", numeric: true, width: "sm" },
  { key: "location", label: "Location", width: "lg" },
  { key: "load", label: "Load", width: "md" },
];

function select(vehicle: LiveMapVehicle): void {
  selectedId.value = vehicle.vehicleId;
  canvas.value?.flyTo(vehicle.vehicleId);
}

/**
 * Two different empty boards, said differently.
 *
 * "No trucks match these filters" in front of a dispatcher who has set no filters sends them looking
 * for a filter to clear. An empty board before the collector has stored anything is a waiting state,
 * and naming the thing they are waiting for is the difference between the two.
 */
const emptyText = computed(() =>
  vehicles.value.length === 0
    ? "No truck positions yet. Positions appear within a few minutes of a truck reporting to Samsara."
    : "No trucks match these filters.",
);

const errorMessage = computed(() =>
  board.isError.value ? (board.error.value as Error | null)?.message ?? "Could not read the live map" : "",
);
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
      @update:search="filters = { ...filters, search: $event }"
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
      :columns="COLUMNS"
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
