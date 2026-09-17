<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { MapIcon, XMarkIcon } from "@silvicom/ui/icons";
import type { LiveMapBoard, LiveMapVehicle, VehicleMapState } from "@silvicom/shared";
import { AppSearchField as SearchInput } from "@silvicom/ui";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import ExplainerPanel from "@/components/ui/ExplainerPanel.vue";
import { BADGE_BASE, vehicleStateTone } from "@/lib/badges";
import {
  LIVE_MAP_SORTS,
  MAP_STATES,
  STATE_COLOR_CLASS,
  STATE_LABEL,
  boardSummarySentence,
  engineOnBoundSentence,
  offlineBoundSentence,
  rowMetric,
  sortVehicles,
  type LiveMapSort,
} from "./liveMapLayer";

/**
 * The fleet rail — search, the census, the ordering and the list, down the left of the map (D-DR25).
 *
 * ── WHAT IT REPLACES, AND WHY THREE THINGS BECAME ONE ────────────────────────────────────────────
 * DR5 gave this workspace a "Fleet status" panel in one corner, a "Filters" panel in another, and a
 * fleet DOCK across the bottom that cost 337px when open. Three controls, three positions, three
 * remembered open/closed states — and all three answer one question a dispatcher has: *which truck,
 * and where is it?* Samsara's Fleet Overview Map was researched on 2026-09-16 rather than guessed at,
 * and it puts exactly these three in one left rail where filtering updates the list and the map
 * together. That is what this is.
 *
 * ⚠ **THE CENSUS IS THE FILTER.** The old surface had both: a "Fleet status" panel listing
 * Moving 24 / Stopped 0 / Parked 0 / Offline 0, and a separate Status dropdown whose option labels
 * repeated the same four counts. Two controls for one fact, and the repo's register is explicit that
 * a copy is a workaround with a delay fuse. Here the counts ARE the buttons: pressing Moving filters
 * to moving, pressing it again clears it, and the number beside it is the census it used to restate.
 *
 * ⚠ **THE SORT SELECT IS NOT DECORATION.** The dock's `DataTable` sorted by clicking a column header,
 * and seven columns do not fit in a rail. "Which truck has the oldest fix" is the ordering a
 * dispatcher actually wants, so it survives as an option rather than being quietly dropped with the
 * columns — see `sortVehicles` for the other three and for why unit numbers sort numerically.
 *
 * ⚠ **A ROW IS NOT A TABLE ROW.** Unit, driver, status and where it is, in four lines a person scans
 * down the left of a map. Speed, load and the exact fix age live on the truck card and on
 * `/vehicles/:id`, which is where `LiveMapVehicleFacts`'s own comment already says depth belongs.
 */
const props = defineProps<{
  /** Every truck on the board, before filtering — the census counts all of them. */
  vehicles: readonly LiveMapVehicle[];
  /** …and after, which is what the list shows and what the map is drawing. */
  filtered: readonly LiveMapVehicle[];
  counts: Record<VehicleMapState, number>;
  selectedId: string | null;
  search: string;
  states: readonly string[];
  board: LiveMapBoard | null;
  loading: boolean;
  emptyText: string;
  errorMessage: string;
  pollSeconds: number;
  /** Whether the list and the census are scoped to what the map is showing (D-LM23, item 7). */
  viewportOnly: boolean;
}>();

const emit = defineEmits<{
  (e: "update:search", value: string): void;
  (e: "update:states", value: string[]): void;
  (e: "update:viewportOnly", value: boolean): void;
  (e: "select", vehicle: LiveMapVehicle): void;
  (e: "close"): void;
}>();

/**
 * The ordering is the RAIL's, not the view's.
 *
 * `useLiveMapView` holds what both shapes of this board have to agree on; there is one shape now, but
 * the rule it was written for still holds — the map does not care what order the list is in, so the
 * order belongs to the list. It also means the ordering resets with the rail rather than persisting
 * as a preference nobody asked to keep.
 */
const sort = ref<LiveMapSort>("state");
/**
 * ⚠ `FilterSelect` offers a clear control on every filter, and a sort cannot be cleared — an
 * unordered list is not a thing a reader can want. Clearing therefore means "back to the default
 * ordering" rather than "no ordering", which is what the coercion below says: an empty value from
 * the control lands on `state`, the order the rail opens with.
 */
const sortModel = computed<string>({
  get: () => sort.value,
  set: (value) => { sort.value = (value as LiveMapSort) || "state"; },
});
/**
 * The list, in order, each row carrying the one fact its right-hand slot shows (D-LM20).
 *
 * ⚠ The metric is computed HERE and not in the template. `rowMetric` would otherwise be called twice
 * per row — once for the text and once for the tone — which is four hundred calls a render on this
 * fleet to answer the same question twice.
 */
const rows = computed(() =>
  sortVehicles(props.filtered, sort.value).map((vehicle) => ({ vehicle, metric: rowMetric(vehicle) })),
);

/** Pressing a census button filters to that status; pressing the active one clears it. */
function toggleState(state: VehicleMapState): void {
  const next = props.states.includes(state) ? props.states.filter((s) => s !== state) : [...props.states, state];
  emit("update:states", next as string[]);
}
</script>

<template>
  <aside
    class="flex h-full w-full flex-col border-edge bg-surface lg:w-80 lg:border-r"
    aria-label="Fleet"
  >
    <!-- ── Search, census, ordering ─────────────────────────────────────────────────────────────── -->
    <div class="space-y-3 border-b border-edge-subtle p-3">
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <SearchInput
            :model-value="search"
            placeholder="Unit or driver"
            @update:model-value="emit('update:search', $event)"
          />
        </div>
        <!-- Only below `lg`, where the rail is an overlay over the map rather than a column beside it. -->
        <BaseButton
          variant="ghost"
          size="sm"
          class="shrink-0 lg:hidden"
          aria-label="Close the fleet list"
          @click="emit('close')"
        >
          <AppIcon :icon="XMarkIcon" class="size-4" aria-hidden="true" />
        </BaseButton>
      </div>

      <!--
        The census, which is also the status filter. `aria-pressed` rather than a checkbox group: each
        one is a toggle whose label already carries its count, and a reader who wants the plain
        control still has the same four values in the same order.
      -->
      <div class="grid grid-cols-2 gap-1.5" role="group" aria-label="Filter by status">
        <BaseButton
          v-for="state in MAP_STATES"
          :key="state"
          variant="ghost"
          size="row"
          class="px-2 ring-1 ring-inset"
          :class="states.includes(state) ? 'bg-surface-subtle ring-edge' : 'ring-transparent'"
          :aria-pressed="states.includes(state)"
          @click="toggleState(state)"
        >
          <span class="flex w-full items-center justify-between gap-1.5">
          <span class="flex min-w-0 items-center gap-1.5">
            <!-- `bg-current` so the dot wears the state's own token rather than a second colour map. -->
            <span class="size-2 shrink-0 rounded-full bg-current" :class="STATE_COLOR_CLASS[state]" aria-hidden="true" />
            <span class="truncate font-normal text-ink-secondary">{{ STATE_LABEL[state] }}</span>
          </span>
          <span class="tabular-nums text-ink">{{ counts[state] }}</span>
          </span>
        </BaseButton>
      </div>

      <!--
        ⚠ The same toggle idiom as the census buttons directly above, deliberately — `aria-pressed`,
        ghost, a ring when on. It belongs to the same question ("which trucks am I looking at") and a
        checkbox or a switch here would be a third control language in one 320px column.

        ⚠ The label says what the reader GETS, not what the control is. "Only trucks in view" is the
        list they will have; "Viewport filter" is a name for the mechanism, which is ours and not
        theirs.
      -->
      <BaseButton
        variant="ghost"
        size="row"
        class="px-2 ring-1 ring-inset"
        :class="viewportOnly ? 'bg-surface-subtle ring-edge' : 'ring-transparent'"
        :aria-pressed="viewportOnly"
        @click="emit('update:viewportOnly', !viewportOnly)"
      >
        <span class="flex w-full items-center justify-between gap-1.5">
          <span class="truncate font-normal text-ink-secondary">Only trucks in view</span>
          <AppIcon
            :icon="MapIcon"
            class="size-3.5 shrink-0"
            :class="viewportOnly ? 'text-brand-600' : 'text-ink-tertiary'"
            aria-hidden="true"
          />
        </span>
      </BaseButton>

      <FilterSelect v-model="sortModel" block label="Sort" :options="LIVE_MAP_SORTS" />
    </div>

    <!-- ── The fleet ────────────────────────────────────────────────────────────────────────────── -->
    <div class="min-h-0 flex-1 overflow-y-auto">
      <p v-if="errorMessage" class="p-3 text-sm text-danger-600">{{ errorMessage }}</p>
      <p v-else-if="loading && rows.length === 0" class="p-3 text-sm text-ink-muted">Finding every truck…</p>
      <p v-else-if="rows.length === 0" class="p-3 text-sm text-ink-muted">{{ emptyText }}</p>

      <ul v-else class="divide-y divide-edge-subtle">
        <li v-for="{ vehicle: v, metric } in rows" :key="v.vehicleId">
          <!--
            A row is a button, not a `<tr>` with a click handler: it is the keyboard's way into the
            map, and the canvas cannot be entered by one at all. `aria-current` is what tells a screen
            reader which truck the map is showing, which the ring only tells a sighted reader.
          -->
          <BaseButton
            variant="ghost"
            size="row"
            class="rounded-none"
            :class="selectedId === v.vehicleId ? 'bg-surface-subtle' : ''"
            :aria-current="selectedId === v.vehicleId ? 'true' : undefined"
            @click="emit('select', v)"
          >
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex items-center gap-2">
                <span class="font-medium text-ink">{{ v.unitNumber }}</span>
                <span :class="[BADGE_BASE, vehicleStateTone(v.state)]">{{ STATE_LABEL[v.state] }}</span>
                <!--
                  D-LM20: the speed while the feed is keeping up, the fix age the moment it is not.
                  `rowMetric` decides which and says why; the two are styled apart because they are
                  different KINDS of fact — a speed is the truck's, an age is ours, and a reader
                  scanning two hundred rows for the one that has gone quiet should not have to read
                  the units to find it.
                -->
                <span
                  class="ml-auto shrink-0 text-2xs tabular-nums"
                  :class="metric.kind === 'speed' ? 'text-ink-secondary' : 'text-ink-tertiary'"
                >{{ metric.text }}</span>
              </span>
              <span class="truncate text-xs" :class="v.driver ? 'text-ink-secondary' : 'text-ink-muted'">
                {{ v.driver?.name ?? "Unassigned" }}
              </span>
              <span class="truncate text-xs text-ink-muted">
                {{ v.position.formattedLocation ?? "Location not resolved" }}
              </span>
            </span>
          </BaseButton>
        </li>
      </ul>
    </div>

    <!--
      ── ONE LINE, OPENING ONTO WHAT USED TO BE ON SCREEN ALL DAY (`Q-LM19`, the owner's item 6) ────
      The foot was a four-line scope paragraph, "171 of 171 shown", and the cadence. It is now the
      one sentence a dispatcher asked for — `boardSummarySentence`, which carries D-LM18's disclosure
      as the clause it ends in and D-LM9b's cadence derived from the poll.

      ⚠ The disclosure is NOT dismissible and this does not make it so. `<details>` hides the
      REFERENCE material behind it — `scopeReason`'s account of the missing McLeod grant, and the two
      bound sentences — while the summary itself, which is where the disclosure lives, is on screen
      open or shut. D-LM18 forbids switching the disclosure off; it does not require the reason for
      it to be read every day.

      ⚠ The two bound sentences had NO renderer at all until this. `offlineBoundSentence` and
      `engineOnBoundSentence` were written for DR5's legend, D-DR25's rail consolidation dropped the
      legend, and both survived as exports with tests and no call site — D-LM9b's own text, gone from
      the page for a fortnight without a gate able to say so. They read the numbers off `bounds`, so
      the day a threshold is retuned the sentence follows it (LM6).
    -->
    <div v-if="board" class="shrink-0 border-t border-edge-subtle px-3 py-2">
      <ExplainerPanel
        variant="inline"
        :summary="boardSummarySentence({
          shown: filtered.length,
          total: vehicles.length,
          scope: board.scope,
          pollSeconds,
        })"
      >
        <p>{{ board.scopeReason }}</p>
        <p>
          <span class="font-medium text-ink">{{ STATE_LABEL.offline }}</span>
          · {{ offlineBoundSentence(board.bounds) }}
        </p>
        <p>
          <span class="font-medium text-ink">{{ STATE_LABEL.stopped }}</span>
          · {{ engineOnBoundSentence(board.bounds) }}
        </p>
      </ExplainerPanel>
    </div>
  </aside>
</template>
