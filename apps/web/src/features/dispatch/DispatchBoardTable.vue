<script setup lang="ts">
import { RouterLink } from "vue-router";
import { loadBoardState, movedByOther, needsAttention, type DispatchBoardRow, type LoadStatus } from "@silvicom/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, hosStatusBadge, onTimeBadge, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import { dispatcherName, durationWords, gpsAgeWords, legalDriveLeft, stopPlace } from "./dispatchBoardView";
import { BOARD_HOS_LOW_MS } from "@silvicom/shared";

/**
 * The dispatch board's table (DISPATCH-BOARD-PLAN §5): one row per truck, the columns a long-haul
 * planner reads left to right — who, how long they can drive, where, what, when it arrives, when it
 * empties, what is next. Every verdict on it (on time, the flags) arrived from the server; this only
 * draws. Times are on the CARRIER's clock (`zone`), never the viewer's, like the Loads page.
 */
const props = defineProps<{
  rows: DispatchBoardRow[];
  loading: boolean;
  error: string | null;
  retrying: boolean;
  emptyText: string;
  zone: string;
  /** McLeod logins, to name a load's dispatcher; and which login runs each fleet, for "moved by". */
  dispatchers: ReadonlyArray<{ id: string; name: string | null }>;
  fleetOwner: (code: string | null) => string | null;
}>();
const emit = defineEmits<{ retry: [] }>();

const at = (iso: string | null | undefined) => formatDateTime(iso, "—", props.zone);

/**
 * Widths are budgeted to fit the table's 1104 px at a 1440 px screen with the sidebar open — measured
 * 2026-10-10 in the browser, when the first cut (every column at its content's natural width, no
 * wrapping) came to 1664 px and pushed On time, Empties and Next load off the right edge: the three
 * columns the board exists for (§5) were the three nobody saw without scrolling. Every cell is
 * already a two-line stack, so cells wrap (`:nowrap="false"`) rather than widen — except a timestamp, which breaks
 * only between "by" and its date, never inside "10:59 AM" — and the attention
 * dot rides in front of the unit number (still the row's left edge) instead of spending a 4rem column
 * on an 8 px dot. Narrower screens scroll with the truck pinned, as §5 asks.
 */
const columns: DataTableColumn[] = [
  { key: "unit", label: "Truck", width: "sm", cellClass: "font-medium text-ink" },
  { key: "driver", label: "Driver", width: "md" },
  { key: "hos", label: "Drive left", width: "sm" },
  { key: "now", label: "Now", width: "md" },
  { key: "load", label: "Current load", width: "md" },
  { key: "nextStop", label: "Next stop", width: "md" },
  { key: "onTime", label: "On time", width: "sm" },
  { key: "empties", label: "Empties", width: "md" },
  { key: "next", label: "Next load", width: "sm" },
];

const loadLabel = (l: NonNullable<DispatchBoardRow["current"]>) =>
  loadBoardState({ status: l.status as LoadStatus, source: l.source ?? "", external_status: l.externalStatus }).label;
</script>

<template>
  <DataTable
    :columns="columns"
    :rows="rows"
    row-key="vehicleId"
    :loading="loading"
    :error="error"
    :retrying="retrying"
    :empty-text="emptyText"
    embedded
    sticky-header
    pin-first-column
    :nowrap="false"
    @retry="emit('retry')"
  >
    <template #cell-unit="{ row }">
      <div class="flex items-center gap-1.5">
        <span
          v-if="needsAttention(row.flags)"
          class="inline-block size-2 shrink-0 rounded-full bg-danger-600"
          role="img"
          aria-label="Needs attention"
          title="Needs attention"
        />
        {{ row.unitNumber }}
      </div>
      <div class="text-xs text-ink-muted">{{ row.inShop ? "In shop" : (row.fleetCode ?? "No fleet") }}</div>
    </template>

    <template #cell-driver="{ row }">
      <div>{{ row.driver?.name ?? row.current?.driverName ?? "—" }}</div>
      <span v-if="row.hos" :class="[BADGE_BASE, toneClass(hosStatusBadge(row.hos.status).tone)]">
        {{ hosStatusBadge(row.hos.status).label }}
      </span>
    </template>

    <template #cell-hos="{ row }">
      <span
        v-if="row.hos"
        :class="legalDriveLeft(row) != null && legalDriveLeft(row)! < BOARD_HOS_LOW_MS ? 'font-medium text-caution-700' : 'text-ink'"
        :title="`Drive ${durationWords(row.hos.driveRemainingMs)} · shift ${durationWords(row.hos.shiftRemainingMs)} · cycle ${durationWords(row.hos.cycleRemainingMs)}`"
      >
        {{ durationWords(legalDriveLeft(row)) }}
      </span>
      <span v-else class="text-ink-muted">—</span>
    </template>

    <template #cell-now="{ row }">
      <div>{{ row.position?.place ?? "—" }}</div>
      <div class="text-xs" :class="row.flags.noGps ? 'text-caution-700' : 'text-ink-muted'">
        GPS {{ gpsAgeWords(row.position?.ageSeconds) }}<template v-if="row.position?.speedMph"> · <span class="whitespace-nowrap">{{ Math.round(row.position.speedMph) }} mph</span></template>
      </div>
    </template>

    <template #cell-load="{ row }">
      <template v-if="row.current">
        <RouterLink :to="{ name: 'load-detail', params: { id: row.current.loadId } }" class="font-medium text-brand-700 hover:underline">
          {{ row.current.ref ?? "Load" }}
        </RouterLink>
        <span class="text-ink-muted"> · {{ loadLabel(row.current) }}</span>
        <div class="text-xs text-ink-muted">{{ row.current.customerName ?? "—" }}</div>
        <div v-if="movedByOther(fleetOwner(row.fleetCode), row.current)" class="text-xs text-ink-muted">
          Moved by {{ dispatcherName(row.current.dispatcherId, dispatchers) }}
        </div>
      </template>
      <span v-else-if="row.inShop" class="text-ink-muted">In the shop</span>
      <span v-else :class="[BADGE_BASE, toneClass('warning')]">Empty</span>
    </template>

    <template #cell-nextStop="{ row }">
      <template v-if="row.current?.nextStop">
        <div>{{ stopPlace(row.current.nextStop) }}</div>
        <div class="text-xs text-ink-muted">
          {{ row.current.nextStop.kind === "pickup" ? "Pickup" : "Delivery" }} by
          <span class="whitespace-nowrap">{{ at(row.current.nextStop.appointmentEnd ?? row.current.nextStop.appointmentStart) }}</span>
        </div>
      </template>
      <span v-else class="text-ink-muted">—</span>
    </template>

    <template #cell-onTime="{ row }">
      <span
        v-if="row.current"
        :class="[BADGE_BASE, toneClass(onTimeBadge(row.onTime).tone)]"
        :title="row.eta ? `ETA ${at(row.eta.at)} · ${row.eta.miles} mi by distance at 50 mph${row.eta.restAdded ? ', including a 10-hour reset' : ''}` : 'No ETA: the truck or the stop has no position'"
      >
        {{ onTimeBadge(row.onTime).label }}
      </span>
    </template>

    <template #cell-empties="{ row }">
      <template v-if="row.empties && row.current">
        <div>{{ row.empties.place ?? "—" }}</div>
        <div class="whitespace-nowrap text-xs text-ink-muted">{{ at(row.empties.at) }}</div>
      </template>
      <span v-else-if="row.empties" class="text-ink-muted">Now</span>
      <span v-else class="text-ink-muted">—</span>
    </template>

    <template #cell-next="{ row }">
      <template v-if="row.next">
        <RouterLink :to="{ name: 'load-detail', params: { id: row.next.loadId } }" class="font-medium text-brand-700 hover:underline">
          {{ row.next.ref ?? "Load" }}
        </RouterLink>
        <div class="text-xs text-ink-muted">{{ stopPlace(row.next.nextStop) || row.next.customerName }}</div>
      </template>
      <span v-else-if="row.flags.noNextLoad" :class="[BADGE_BASE, toneClass('neutral')]">None</span>
      <span v-else class="text-ink-muted">—</span>
    </template>
  </DataTable>
</template>
