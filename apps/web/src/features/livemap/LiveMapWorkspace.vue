<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { TruckIcon } from "@silvicom/ui/icons";
import type { LiveMapVehicle } from "@silvicom/shared";
import { type MapBounds } from "./liveMapLayer";
import { boardSummarySentence } from "./liveMapWords";
import LiveMapCanvas from "./LiveMapCanvas.vue";
import LiveMapFloatingPanel from "./LiveMapFloatingPanel.vue";
import LiveMapRail from "./LiveMapRail.vue";
import LiveMapVehicleFacts from "./LiveMapVehicleFacts.vue";
import { useLiveMapView } from "./useLiveMapView";
import { LIVE_MAP_POLL_MS } from "./useLiveMapBoard";

/**
 * The map IS the page (D-DR5, DESIGN-REFRESH-2026-09.md §4), with the fleet down its left (D-DR25).
 *
 * ── A WORKSPACE, NOT A DOCUMENT ──────────────────────────────────────────────────────────────────
 * `/live-map` was a vertical report: a callout, a filter bar, a map inside a card, a 199-row table
 * beneath it. The map was a FIGURE in that report, about 28rem tall however large the screen. Comp
 * (7) inverts it — the map fills what the shell leaves — and D-DR24 then made this the Dashboard's
 * Dispatch tab rather than a page of its own, so `tabIsWorkspace` is what makes the space available
 * and this file is what spends it.
 *
 * ── THE RAIL REPLACED THREE CONTROLS, AND THAT IS THE POINT OF IT (D-DR25) ───────────────────────
 * DR5 left this surface with a "Fleet status" panel in one corner, a "Filters" panel in another, and
 * a fleet dock across the bottom that cost 337px when open — three positions and three remembered
 * open/closed states for one question: which truck, and where. Samsara's Fleet Overview Map, read on
 * 2026-09-16 rather than guessed at, puts search, filters and the asset list in a single left rail
 * with the map beside it. `LiveMapRail` is that, and the corners it emptied are why maplibre's own
 * zoom control could have stayed where it was — though D-DR21's rail is better placed anyway.
 *
 * ⚠ **THE RAIL IS A FLEX SIBLING OF THE MAP, NOT AN OVERLAY** — the same call D-DR7 made for the
 * dock, and for the same reason: a truck underneath a 320px panel is a truck the dispatcher cannot
 * see, and markers carry no unit number to find it by. Below `lg` there is no room for both, so
 * there the rail becomes an overlay a button opens — on a phone the choice is not "both" but "which".
 *
 * ⚠ The rail stays MOUNTED at every width. The canvas is a surface a screen reader cannot enter, so
 * the list is the only keyboard route to a truck; the small-screen toggle is `v-show`, never `v-if`.
 *
 * ── WHERE THE SCOPE SENTENCE WENT, AND WHY IT KEEPS MOVING ───────────────────────────────────────
 * D-LM18 requires the board to say out loud that it is fleet-wide — "a dispatcher who believes they
 * are seeing only their own trucks will read an empty column as 'nothing of mine is late'". It was
 * an `AppCallout` in the document, then the dock bar, and it is now the foot of the rail. A callout
 * floating over a map is either dismissible, which lets the disclosure be switched off, or not,
 * which is a panel lying about being a panel. The rail's foot is neither: always on screen, never
 * closable, still read from the RESPONSE so it stops appearing by itself when the scope becomes real.
 *
 * ⚠ `Q-LM19` (2026-09-17) changed its SHAPE and not its standing. The disclosure is no longer a
 * paragraph under the count — it is the clause the count ends in, "171 trucks **in the fleet**",
 * composed once by `boardSummarySentence` and rendered in both places the board can be read from.
 * The paragraph it replaced still exists and is one click away in the foot's own disclosure; what
 * went is a four-line block of reference material sitting on a dispatcher's screen every day.
 */
const {
  board,
  filters,
  selectedId,
  vehicles,
  viewport,
  filtered,
  counts,
  selected,
  stateFilter,
  emptyText,
  errorMessage,
  setSearch,
} = useLiveMapView();

/**
 * ── THE FRESHNESS SENTENCE IS DERIVED, NOT TYPED ─────────────────────────────────────────────────
 * D-LM9b stacks three intervals — the vendor's ping, the collector tier and this poll — and the
 * browser only owns the last one. It is read from `LIVE_MAP_POLL_MS` so that the day somebody
 * retunes the poll, the sentence on the page changes with it instead of quietly becoming false.
 */
const pollSeconds = Math.round(LIVE_MAP_POLL_MS / 1000);

const canvas = ref<InstanceType<typeof LiveMapCanvas> | null>(null);

/**
 * Whether the rail is showing BELOW `lg`, where it covers the map instead of standing beside it.
 *
 * ⚠ Not remembered, and D-DR6's localStorage panel memory went with the panels it remembered. A
 * stored "closed" meant a dispatcher opening this surface weeks later to a map with no way visible to
 * find a truck by number; the overlay is a gesture, not a preference, and it closes on selection.
 */
const railOpen = ref(false);

/**
 * The owner's item 7 (D-LM23), as a REQUEST the canvas answers rather than a rectangle held here.
 *
 * `viewportOnly` is what the reader pressed; `latestBounds` is the last thing the map said it could
 * see. The view's `viewport` is the two combined, so there is exactly one value deciding both the
 * rail's scope and its census, and no way for "the filter is on" to be true while "which rectangle"
 * is still unknown.
 */
const viewportOnly = ref(false);
let latestBounds: MapBounds | null = null;

function onViewport(bounds: MapBounds): void {
  latestBounds = bounds;
  if (viewportOnly.value) viewport.value = bounds;
}

watch(viewportOnly, (on) => {
  // ⚠ Switching ON uses the bounds the canvas has ALREADY reported, rather than waiting for the next
  // `moveend`. Over a still map there is no next one, so the filter would appear to do nothing until
  // the reader happened to pan — and they would reasonably conclude it was broken.
  viewport.value = on ? latestBounds : null;
});

function select(vehicle: LiveMapVehicle): void {
  selectedId.value = vehicle.vehicleId;
  canvas.value?.flyTo(vehicle.vehicleId);
  railOpen.value = false;
}

/** The rail's width is part of the map's box at `lg`, so the canvas has to re-measure when it moves. */
const railVisible = computed(() => railOpen.value);
watch(railVisible, async () => {
  await nextTick();
  canvas.value?.resize();
});
</script>

<template>
  <div class="flex h-full flex-col lg:flex-row">
    <!--
      ⚠ `hidden lg:flex` plus an absolutely positioned copy below `lg` would be two rails to keep in
      step. It is ONE rail: a column at `lg`, and the same element pinned over the map below it.
    -->
    <div
      class="absolute inset-0 z-sticky-lead lg:relative lg:inset-auto lg:z-auto lg:block lg:shrink-0"
      :class="railOpen ? 'block' : 'hidden lg:block'"
    >
      <LiveMapRail
        :vehicles="vehicles"
        :filtered="filtered"
        :counts="counts"
        :selected-id="selectedId"
        :search="filters.search"
        :states="stateFilter"
        :board="board.data.value ?? null"
        :loading="board.isLoading.value"
        :empty-text="emptyText"
        :error-message="errorMessage"
        :poll-seconds="pollSeconds"
        :viewport-only="viewportOnly"
        @update:search="setSearch($event)"
        @update:states="stateFilter = $event"
        @update:viewport-only="viewportOnly = $event"
        @select="select"
        @close="railOpen = false"
      />
    </div>

    <!-- ── The map, and the one thing still floating on it ──────────────────────────────────────── -->
    <div class="relative min-h-0 flex-1">
      <LiveMapCanvas
        v-if="board.data.value"
        ref="canvas"
        fit="fill"
        :vehicles="filtered"
        :generated-at="board.data.value.generatedAt"
        :selected-id="selectedId"
        @select="selectedId = $event"
        @viewport="onViewport"
      />
      <div v-else class="flex h-full items-center justify-center bg-surface-muted">
        <p class="text-sm text-ink-muted">
          {{ errorMessage || "Finding every truck…" }}
        </p>
      </div>

      <!--
        Below `lg` the rail is closed by default, so something has to open it — and the scope
        sentence has to stand beside it rather than travel inside the rail.

        ⚠ D-LM18 is the reason for the second half. The disclosure that this board is FLEET-WIDE has
        to be on screen wherever the board is, and on a phone the rail is shut most of the time: a
        sentence only visible behind a button is a sentence a dispatcher can go a whole shift without
        reading, which is exactly the misreading D-LM18 exists to prevent. At `lg` the rail is always
        on screen and carries it, so this copy is `lg:hidden` rather than a second permanent one.

        ⚠ TOP and not bottom, for two measured reasons rather than taste. (1) The bottom of this
        canvas is spoken for: HERE's attribution sits there and D-DR21's control rail is vertically
        centred on the right — a bar at `bottom-3` overlapped the attribution by 78×22 and the rail
        by 166×32 at 390px. (2) `AppShell` sizes `<main>` at `100dvh - 4rem`, which does not count
        the ENVIRONMENT BANNER above the shell, so the document scrolls by exactly that banner's
        height and anything pinned to the bottom edge goes under the fold: 28px at 1512 and **64px at
        390, where the banner wraps to two lines**. That is DR5 follow-up 2, known and still open —
        and it is the banner alone, not this tab's strip, which is inside `<main>` and takes its
        height from the same box the map does. The top edge is free at every width now that the rail
        has taken the Fleet status panel with it.
      -->
      <div class="absolute inset-x-3 top-3 z-sticky flex items-center gap-2 lg:hidden">
        <BaseButton
          variant="secondary"
          size="sm"
          class="shrink-0 shadow-overlay"
          :aria-expanded="railOpen"
          @click="railOpen = true"
        >
          <AppIcon :icon="TruckIcon" class="size-4" aria-hidden="true" />
          Fleet
          <span class="font-normal tabular-nums text-ink-secondary">{{ filtered.length }}</span>
        </BaseButton>
        <!--
          ⚠ `Q-LM19`: this used to be `scopeReason`, and `truncate` was quietly eating most of it.
          Measured in the browser at 390px, the width this copy exists for: the paragraph wanted
          **720px of text in a 244px pill — 34% of it visible**, so two thirds of the disclosure was
          never read by the reader it was put there for. It now carries the SAME sentence as the
          rail's foot, from the same function, and that sentence measures 244px — it fits exactly,
          with nothing clipped.

          ⚠ No `<details>` here, on purpose: this pill sits ON the map over a truck, and a
          disclosure that expanded would cover the thing it is describing. Below `lg` the reason is
          one tap further away, behind the Fleet button — which is the same place the rail's own
          list lives at this width.
        -->
        <p
          v-if="board.data.value"
          class="min-w-0 flex-1 truncate rounded-control bg-surface/90 px-2 py-1 text-2xs text-ink-secondary shadow-overlay"
        >
          {{
            boardSummarySentence({
              shown: filtered.length,
              total: vehicles.length,
              scope: board.data.value.scope,
              pollSeconds,
            })
          }}
        </p>
      </div>

      <!--
        The selected truck. Still a floating panel rather than the drawer the owner ruled out, and
        still not one of the remembered ones: it is present because a truck is selected, so its
        dismiss clears the SELECTION rather than storing a preference. Otherwise a dispatcher who
        closed it once would click a truck on some later day and get nothing back.
      -->
      <LiveMapFloatingPanel
        v-if="selected"
        :title="`Unit ${selected.unitNumber}`"
        corner="top-right"
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
        <!-- `board.data.value` is non-null here: `selected` resolves against the board, so there is
             no card without one. -->
        <LiveMapVehicleFacts :vehicle="selected" :board="board.data.value!" density="compact" />
      </LiveMapFloatingPanel>
    </div>
  </div>
</template>
