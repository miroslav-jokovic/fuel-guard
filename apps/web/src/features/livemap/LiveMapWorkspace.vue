<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { AppButton as BaseButton, AppIcon, AppSearchField as SearchInput } from "@silvicom/ui";
import { ChevronDownIcon, ChevronUpIcon } from "@silvicom/ui/icons";
import type { LiveMapVehicle, VehicleMapState } from "@silvicom/shared";
import DataTable from "@/components/ui/DataTable.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { BADGE_BASE, vehicleStateTone } from "@/lib/badges";
import LiveMapCanvas from "./LiveMapCanvas.vue";
import LiveMapFloatingPanel from "./LiveMapFloatingPanel.vue";
import LiveMapLegend from "./LiveMapLegend.vue";
import LiveMapVehicleFacts from "./LiveMapVehicleFacts.vue";
import { useLiveMapView, LIVE_MAP_COLUMNS } from "./useLiveMapView";
import { LIVE_MAP_POLL_MS } from "./useLiveMapBoard";
import { LIVE_MAP_PANELS, useLiveMapPanels } from "./liveMapPanels";
import { STATE_LABEL, formatAge } from "./liveMapLayer";

/**
 * The map IS the page (D-DR5, DESIGN-REFRESH-2026-09.md §4).
 *
 * ── A WORKSPACE, NOT A DOCUMENT ──────────────────────────────────────────────────────────────────
 * `/live-map` was a vertical report: a callout, a filter bar, a map inside a card, a 199-row table
 * beneath it. The map was a FIGURE in that report, about 28rem tall however large the screen. Comp
 * (7) inverts it — the map fills what the shell leaves, and everything else floats on top of it with
 * its own dismiss control. `meta.fullBleed` on the route is what makes the space available; this
 * file is what spends it.
 *
 * ── THE DOCK IS A SIBLING OF THE MAP, NOT AN OVERLAY ─────────────────────────────────────────────
 * D-DR7 keeps the fleet list and makes it a dock. It is laid out as a flex sibling rather than a
 * sheet over the canvas, which is worth a sentence because it looks like the harder choice: a truck
 * hidden underneath a 288px overlay is a truck the dispatcher cannot see, and the whole argument for
 * the table is that markers carry no unit number. Shrinking the map instead keeps every marker on
 * screen. The cost is one `resize()` call, because a WebGL canvas does not notice its own box
 * changing — see `LiveMapCanvas.resize`.
 *
 * ⚠ The table stays MOUNTED when the dock is collapsed. The map canvas is a surface a screen reader
 * cannot enter, so the table is the only keyboard route to a truck; `v-show` keeps it reachable,
 * `v-if` would delete it. That is D-DR7's warning applied, and it is why the collapsed dock is a
 * hidden box rather than an absent one.
 *
 * ── WHERE THE SCOPE SENTENCE WENT, AND WHY IT MOVED ──────────────────────────────────────────────
 * D-LM18 requires the board to say out loud that it is fleet-wide — "a dispatcher who believes they
 * are seeing only their own trucks will read an empty column as 'nothing of mine is late'". In the
 * document form that was an `AppCallout` at the top. A callout floating over a map is either a
 * dismissible panel, which would let the disclosure be switched off, or an undismissible one, which
 * is a panel that lies about being a panel. So it moved into the dock bar: always on screen, never
 * closable, still read from the response so it stops appearing by itself on the day the scope
 * becomes real.
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

/**
 * ── THE FRESHNESS SENTENCE IS DERIVED, NOT TYPED ─────────────────────────────────────────────────
 * D-LM9b stacks three intervals — the vendor's ping, the collector tier and this poll — and the
 * browser only owns the last one. It is read from `LIVE_MAP_POLL_MS` so that the day somebody
 * retunes the poll, the sentence on the page changes with it instead of quietly becoming false. It
 * used to sit in the page's `PageHeader`; DR5 removed that header, so it moved to the dock bar
 * rather than being dropped — it is a property of the data, and this is where the data reports on
 * itself.
 */
const pollSeconds = Math.round(LIVE_MAP_POLL_MS / 1000);

const panels = useLiveMapPanels();
const canvas = ref<InstanceType<typeof LiveMapCanvas> | null>(null);

function select(vehicle: LiveMapVehicle): void {
  selectedId.value = vehicle.vehicleId;
  canvas.value?.flyTo(vehicle.vehicleId);
}

/**
 * Opening or closing the dock changes the map's height, and maplibre's own `trackResize` watches the
 * WINDOW, which has not changed. `nextTick` so the new height is laid out before the map is asked to
 * measure it.
 */
watch(
  () => panels.isPanelOpen("fleet"),
  async () => {
    await nextTick();
    canvas.value?.resize();
  },
);
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- ── The map, and everything floating on it ──────────────────────────────────────────────── -->
    <div class="relative min-h-0 flex-1">
      <LiveMapCanvas
        v-if="board.data.value"
        ref="canvas"
        fit="fill"
        :vehicles="filtered"
        :generated-at="board.data.value.generatedAt"
        :selected-id="selectedId"
        @select="selectedId = $event"
      />
      <div v-else class="flex h-full items-center justify-center bg-surface-muted">
        <p class="text-sm text-ink-muted">
          {{ errorMessage || "Finding every truck…" }}
        </p>
      </div>

      <!--
        ⚠ THE PANEL LAYER IS A COLUMN ON A PHONE AND A SET OF CORNERS ON A DESK.
        Measured at 390px: the two top panels at their desktop widths overlap by 193px, and no
        trimming fixes that (256 + 288 does not fit in 390). Below `sm` this box is a scrolling
        flex column and each panel is `static` inside it; at `sm` and up it becomes a full-size
        layer and every panel takes its own corner. `inset-3` gives the column its gutter; `sm:inset-0`
        hands the corners back their own `sm:left-3` / `sm:top-3`.
      -->
      <div
        class="pointer-events-none absolute inset-3 z-sticky flex flex-col gap-2 overflow-y-auto sm:inset-0 sm:block sm:overflow-visible"
      >
        <LiveMapFloatingPanel
          :title="LIVE_MAP_PANELS.status.title"
          corner="top-left"
          :open="panels.isPanelOpen('status')"
          width="sm:w-64"
          @update:open="panels.toggle('status')"
        >
          <LiveMapLegend
            v-if="board.data.value"
            layout="stacked"
            :counts="counts"
            :bounds="board.data.value.bounds"
          />
          <p v-else class="text-xs text-ink-muted">The census appears once the board has loaded.</p>
        </LiveMapFloatingPanel>

        <LiveMapFloatingPanel
          :title="LIVE_MAP_PANELS.filters.title"
          corner="top-right"
          :open="panels.isPanelOpen('filters')"
          width="sm:w-72"
          @update:open="panels.toggle('filters')"
        >
          <!--
          ⚠ NOT `FilterBar`, and the reason is D-DR17's lesson arriving a second time. `FilterBar` is
          the page TOOLBAR: it lays its search out at `lg:w-64 lg:shrink-0` beside a wrapping row of
          triggers, and those are VIEWPORT breakpoints. Inside a 288px floating panel on a 1512px
          screen every one of them fires, so the bar lays itself out for a full-width page inside a
          column a fifth that wide and grows a horizontal scrollbar — measured, 2026-09-16.

          A wider panel would only move the number. So the panel composes the same two shared
          primitives `FilterBar` itself composes, stacked: this is the toolbar's contents at the
          grain that fits, not a second copy of a control. The result count is not repeated here
          because the dock bar below already carries it.
        -->
          <div class="space-y-2">
            <SearchInput
              :model-value="filters.search"
              placeholder="Unit or driver"
              @update:model-value="setSearch($event)"
            />
            <FilterSelect v-model="stateFilter" multiple label="Status" :options="stateOptions" />
          </div>
        </LiveMapFloatingPanel>

        <!--
        The selected truck, in the same primitive as the other panels but NOT one of the remembered
        ones (`liveMapPanels.ts` says why): it is present because a truck is selected, so it is
        always `open` and its dismiss clears the SELECTION rather than storing a preference.
        Otherwise a dispatcher who closed it once would click a truck on some later day and get
        nothing back. The pill carries the unit number, so the dismiss control is labelled with the
        thing it dismisses.
      -->
        <LiveMapFloatingPanel
          v-if="selected"
          :title="`Unit ${selected.unitNumber}`"
          corner="bottom-left"
          :open="true"
          width="sm:w-80"
          @update:open="selectedId = null"
        >
          <p
            class="mb-2 truncate text-xs"
            :class="selected.driver ? 'text-ink-secondary' : 'text-ink-muted'"
          >
            {{ selected.driver?.name ?? "No driver assigned" }}
          </p>
          <LiveMapVehicleFacts :vehicle="selected" density="compact" />
        </LiveMapFloatingPanel>
      </div>
    </div>

    <!-- ── The fleet dock (D-DR7) ──────────────────────────────────────────────────────────────── -->
    <div class="shrink-0 border-t border-edge bg-surface">
      <div class="flex items-center gap-3 px-4 py-2">
        <BaseButton
          variant="ghost"
          size="sm"
          class="shrink-0 text-ink"
          :aria-expanded="panels.isPanelOpen('fleet')"
          aria-controls="live-map-fleet-list"
          @click="panels.toggle('fleet')"
        >
          <AppIcon
            :icon="panels.isPanelOpen('fleet') ? ChevronDownIcon : ChevronUpIcon"
            class="size-4"
            aria-hidden="true"
          />
          {{ LIVE_MAP_PANELS.fleet.title }}
          <span class="font-normal tabular-nums text-ink-secondary">{{ filtered.length }}</span>
        </BaseButton>
        <!--
          D-LM18, required rather than decorative, and never dismissible — see the file header for
          why it is a status line here instead of the callout the document form uses. The sentence
          comes from the response, so it stops appearing by itself on the day the scope becomes real.
        -->
        <p
          v-if="board.data.value && board.data.value.scope === 'all'"
          class="min-w-0 flex-1 truncate text-xs text-ink-secondary"
          :title="board.data.value.scopeReason"
        >
          {{ board.data.value.scopeReason }}
        </p>
        <p class="ml-auto hidden shrink-0 text-xs text-ink-tertiary sm:block">
          Positions refresh every {{ pollSeconds }} seconds while this tab is open.
        </p>
      </div>

      <div
        v-show="panels.isPanelOpen('fleet')"
        id="live-map-fleet-list"
        class="h-72 overflow-hidden border-t border-edge-subtle"
      >
        <!--
          `fill` because this dock is a fixed 18rem band, not a page. See the prop's own comment: the
          default ceiling is `70vh`, which is more than twice this box on a laptop, and the rows past
          it would be clipped rather than scrollable.
        -->
        <DataTable
          fill
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
            <span :class="row.driver ? 'text-ink' : 'text-ink-muted'">{{
              row.driver?.name ?? "Unassigned"
            }}</span>
          </template>
          <template #cell-state="{ row }">
            <span :class="[BADGE_BASE, vehicleStateTone(row.state)]">{{
              STATE_LABEL[row.state as VehicleMapState]
            }}</span>
          </template>
          <template #cell-speed="{ row }">
            {{ row.position.speedMph == null ? "—" : `${Math.round(row.position.speedMph)} mph` }}
          </template>
          <!-- D-LM10: the age of the fix, per truck, never hidden behind the marker. -->
          <template #cell-age="{ row }">{{ formatAge(row.ageSeconds) }}</template>
          <template #cell-location="{ row }">{{ row.position.formattedLocation ?? "—" }}</template>
          <template #cell-load="{ row }">
            <span :class="row.load ? 'text-ink' : 'text-ink-muted'">{{
              row.load?.ref ?? "No load"
            }}</span>
          </template>
        </DataTable>
      </div>
    </div>
  </div>
</template>
