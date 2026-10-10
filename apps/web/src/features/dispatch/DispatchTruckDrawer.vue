<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { DispatchBoardRow } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import { useLoadRoute } from "@/composables/useLoadRoute";
import { BADGE_BASE, hosStatusBadge, onTimeBadge, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import { dispatcherName, durationWords, legalDriveLeft, stopPlace } from "./dispatchBoardView";
import { useLoadDetailQuery, type DispatchStopDetail } from "./useDispatchLoads";

/**
 * One truck's detail, opened from its board row (DISPATCH-BOARD-PLAN DB6, D-DB2 research item 7: "the
 * board never navigates away"). Everything the row compresses into a cell, at full length: the current
 * load's stops with what happened at each, the four HOS clocks, the route, and the way out to the load,
 * the truck and the driver.
 *
 * ── WHAT IS FETCHED, AND WHEN ────────────────────────────────────────────────────────────────────
 * The row already holds the clocks and our ETA, so those draw at once. The stops and the route are read
 * only while the drawer is open, for the one load in it: the board polls every minute for every truck,
 * and the route is a HERE call on a cold cache plus a fuel plan (useLoadRoute) — per row it would be
 * two hundred of them a minute. The stops come from the load page's own reader (`GET /api/dispatch/
 * loads/:id`), so the drawer and the load page cannot describe one stop two ways.
 *
 * ── TWO ETAS, AND WHICH ONE COUNTS (D-DB4) ───────────────────────────────────────────────────────
 * Our ETA (distance at a planning speed, plus a reset when the drive clock runs out) is the one the
 * on-time verdict uses, and it is shown with its basis. McLeod's `eta_at` is typed by a person — 36 of
 * them were more than six hours in the past on 2026-10-09 — so it appears per stop as a reference,
 * labelled as McLeod's, and never decides anything.
 *
 * ⚠ No "open on the map" link yet: the map takes no truck from the URL (its selection is local state
 * in `useLiveMapView`), so a link could only open the map with nothing selected. That deep link is the
 * next step (plan §10, 2026-10-10), not a half-link here.
 */
const props = defineProps<{
  row: DispatchBoardRow | null;
  zone: string;
  dispatchers: ReadonlyArray<{ id: string; name: string | null }>;
}>();
const emit = defineEmits<{ close: [] }>();

const at = (iso: string | null | undefined) => formatDateTime(iso, "—", props.zone);

const loadId = computed(() => props.row?.current?.loadId ?? null);
const detail = useLoadDetailQuery(loadId);
const route = useLoadRoute(loadId);

const stops = computed<DispatchStopDetail[]>(() => [...(detail.data.value?.stops ?? [])].sort((a, b) => a.seq - b.seq));

/** What happened at a stop, McLeod's record first (LR7) and the driver app's beside it. */
function arrivedAt(s: DispatchStopDetail): string | null {
  return s.actual_arrival_at ?? s.arrived_at ?? null;
}
function apptWindow(s: DispatchStopDetail): string {
  if (!s.appointment_start) return "No appointment window";
  return s.appointment_end ? `${at(s.appointment_start)} → ${at(s.appointment_end)}` : at(s.appointment_start);
}

const clocks = computed(() => {
  const h = props.row?.hos;
  if (!h) return [];
  return [
    { label: "Drive", ms: h.driveRemainingMs },
    { label: "Shift", ms: h.shiftRemainingMs },
    { label: "Cycle", ms: h.cycleRemainingMs },
    { label: "Until break", ms: h.breakRemainingMs },
  ];
});

const routeSummary = computed(() => {
  const r = route.data.value;
  if (!r) return null;
  const ahead = Math.max(0, r.distanceMiles - r.coveredMiles);
  return {
    line: `${Math.round(r.distanceMiles)} mi pickup to delivery · ${Math.round(ahead)} mi still ahead · about ${durationWords(r.durationHours * 3_600_000)} of driving`,
    offRoute: !r.truckOnRoute && r.offRouteMiles != null ? `The truck is ${Math.round(r.offRouteMiles)} mi off this route.` : null,
    fuel: r.fuelStops[0] ?? null,
    fuelNote: r.fuelNote,
    hazmatNotApplied: r.hazmatNotApplied,
  };
});

const title = computed(() => (props.row ? `Truck ${props.row.unitNumber}` : "Truck"));
const description = computed(() => {
  const r = props.row;
  if (!r) return undefined;
  const who = r.driver?.name ?? r.current?.driverName ?? "No driver";
  return [who, r.inShop ? "In shop" : (r.fleetCode ?? "No fleet")].join(" · ");
});
</script>

<template>
  <SlideOver :open="row !== null" :title="title" :description="description" @close="emit('close')">
    <div v-if="row" class="space-y-6">
      <section aria-labelledby="truck-hos-heading" class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <h3 id="truck-hos-heading" class="text-sm font-semibold text-ink">Hours of service</h3>
          <span v-if="row.hos" :class="[BADGE_BASE, toneClass(hosStatusBadge(row.hos.status).tone)]">
            {{ hosStatusBadge(row.hos.status).label }}
          </span>
        </div>
        <template v-if="row.hos">
          <dl class="grid grid-cols-4 gap-3" data-testid="truck-hos-clocks">
            <div v-for="c in clocks" :key="c.label">
              <dt class="text-xs text-ink-muted">{{ c.label }}</dt>
              <dd class="font-medium text-ink tabular-nums">{{ durationWords(c.ms) }}</dd>
            </div>
          </dl>
          <p class="text-xs text-ink-muted">
            {{ durationWords(legalDriveLeft(row)) }} of legal driving left, whichever clock runs out first. As of {{ at(row.hos.fetchedAt) }}.
          </p>
        </template>
        <p v-else class="text-sm text-ink-muted">No HOS clocks for this driver yet. Samsara reports them every five minutes.</p>
      </section>

      <section aria-labelledby="truck-load-heading" class="space-y-2">
        <h3 id="truck-load-heading" class="text-sm font-semibold text-ink">Current load</h3>
        <p v-if="!row.current" class="text-sm text-ink-muted">
          {{ row.inShop ? "In the shop, no load." : "Empty, no load on this truck." }}
        </p>
        <template v-else>
          <p class="text-sm">
            <RouterLink :to="{ name: 'load-detail', params: { id: row.current.loadId } }" class="font-medium text-brand-700 hover:underline">
              {{ row.current.ref ?? "Load" }}
            </RouterLink>
            <span class="text-ink-muted"> · {{ row.current.customerName ?? "No customer" }}</span>
          </p>
          <p v-if="row.current.dispatcherId" class="text-xs text-ink-muted">
            Dispatched by {{ dispatcherName(row.current.dispatcherId, dispatchers) }}
          </p>
          <div class="flex flex-wrap items-center gap-2 text-sm" data-testid="truck-our-eta">
            <span :class="[BADGE_BASE, toneClass(onTimeBadge(row.onTime).tone)]">{{ onTimeBadge(row.onTime).label }}</span>
            <span v-if="row.eta" class="text-ink">
              Our ETA to {{ stopPlace(row.current.nextStop) || "the next stop" }}: {{ at(row.eta.at) }}
            </span>
            <span v-else class="text-ink-muted">No ETA: the truck or the stop has no position.</span>
          </div>
          <p v-if="row.eta" class="text-xs text-ink-muted">
            {{ row.eta.miles }} mi by distance at 50 mph{{ row.eta.restAdded ? ", including a 10-hour reset" : "" }}.
          </p>
        </template>
      </section>

      <section v-if="row.current" aria-labelledby="truck-stops-heading" class="space-y-2">
        <h3 id="truck-stops-heading" class="text-sm font-semibold text-ink">Stops</h3>
        <p v-if="detail.isLoading.value" class="text-sm text-ink-muted">Loading the stops…</p>
        <p v-else-if="detail.isError.value" class="text-sm text-danger-600">
          {{ detail.error.value instanceof Error ? detail.error.value.message : "Could not load the stops." }}
        </p>
        <ol v-else class="space-y-3" data-testid="truck-stops">
          <li v-for="s in stops" :key="s.id" class="border-l-2 pl-3 text-sm" :class="arrivedAt(s) ? 'border-edge' : 'border-brand-600'">
            <div class="font-medium text-ink">
              {{ s.kind === "pickup" ? "Pickup" : "Delivery" }} · {{ s.location_name || s.name || "Unnamed" }}
            </div>
            <div class="text-xs text-ink-muted">{{ [s.city, s.state].filter(Boolean).join(", ") }}</div>
            <div class="text-xs text-ink-muted">{{ apptWindow(s) }}</div>
            <div v-if="arrivedAt(s)" class="text-xs text-ink-secondary">Arrived {{ at(arrivedAt(s)) }}</div>
            <div v-else-if="s.eta_at" class="text-xs text-ink-muted" data-testid="truck-mcleod-eta">
              McLeod ETA {{ at(s.eta_at) }} (typed in McLeod, for reference)
            </div>
          </li>
        </ol>
      </section>

      <section v-if="row.current" aria-labelledby="truck-route-heading" class="space-y-2">
        <h3 id="truck-route-heading" class="text-sm font-semibold text-ink">Route</h3>
        <p v-if="route.isLoading.value" class="text-sm text-ink-muted">Planning the route…</p>
        <p v-else-if="route.isError.value" class="text-sm text-ink-muted">
          {{ route.error.value instanceof Error ? route.error.value.message : "Could not draw this route" }}
        </p>
        <template v-else-if="routeSummary">
          <p class="text-sm text-ink" data-testid="truck-route-summary">{{ routeSummary.line }}</p>
          <p v-if="routeSummary.offRoute" class="text-xs text-caution-700">{{ routeSummary.offRoute }}</p>
          <p v-if="routeSummary.fuel" class="text-xs text-ink-muted">
            Next fuel stop: {{ routeSummary.fuel.name ?? routeSummary.fuel.brand ?? "Fuel stop" }},
            {{ [routeSummary.fuel.city, routeSummary.fuel.state].filter(Boolean).join(", ") }}, {{ Math.round(routeSummary.fuel.milesAhead) }} mi ahead
          </p>
          <p v-else-if="routeSummary.fuelNote" class="text-xs text-ink-muted">{{ routeSummary.fuelNote }}</p>
          <p v-if="routeSummary.hazmatNotApplied" class="text-xs text-caution-700">
            Routed without hazmat restrictions: no cleared hazmat record for this load yet.
          </p>
        </template>
      </section>

      <section aria-labelledby="truck-next-heading" class="space-y-1">
        <h3 id="truck-next-heading" class="text-sm font-semibold text-ink">Next load</h3>
        <p v-if="row.next" class="text-sm">
          <RouterLink :to="{ name: 'load-detail', params: { id: row.next.loadId } }" class="font-medium text-brand-700 hover:underline">
            {{ row.next.ref ?? "Load" }}
          </RouterLink>
          <span class="text-ink-muted"> · {{ stopPlace(row.next.nextStop) || row.next.customerName || "—" }}</span>
        </p>
        <p v-else class="text-sm text-ink-muted">None planned behind the current load.</p>
        <p v-if="row.empties?.place" class="text-xs text-ink-muted">Empties in {{ row.empties.place }} at {{ at(row.empties.at) }}.</p>
      </section>
    </div>

    <template #footer>
      <nav v-if="row" aria-label="Open" class="flex flex-wrap items-center justify-end gap-4 text-sm font-medium">
        <RouterLink :to="{ name: 'vehicle-detail', params: { id: row.vehicleId } }" class="text-brand-700 hover:underline">Truck page</RouterLink>
        <RouterLink v-if="row.driver" :to="{ name: 'driver-detail', params: { id: row.driver.id } }" class="text-brand-700 hover:underline">
          Driver page
        </RouterLink>
        <RouterLink v-if="row.current" :to="{ name: 'load-detail', params: { id: row.current.loadId } }" class="text-brand-700 hover:underline">
          Load page
        </RouterLink>
      </nav>
    </template>
  </SlideOver>
</template>
