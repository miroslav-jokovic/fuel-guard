<script setup lang="ts">
import { AppButton as BaseButton } from "@silvicom/ui";
import { loadBoardState, movedByOther, needsAttention, type DispatchBoardRow, type LoadStatus } from "@silvicom/shared";
import DataTable from "@/components/ui/DataTable.vue";
import type { SortState } from "@/lib/sort";
import { BADGE_BASE, hosStatusBadge, onTimeBadge, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
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
  /** The columns this reader shows (`useTableColumns` over `BOARD_COLUMNS`), in their declared order. */
  columns: DataTableColumn[];
  loading: boolean;
  error: string | null;
  retrying: boolean;
  emptyText: string;
  zone: string;
  /** McLeod logins, to name a load's dispatcher; and which login runs each fleet, for "moved by". */
  dispatchers: ReadonlyArray<{ id: string; name: string | null }>;
  fleetOwner: (code: string | null) => string | null;
  sort: SortState;
}>();
const emit = defineEmits<{ retry: []; open: [row: DispatchBoardRow]; sort: [key: string] }>();

const at = (iso: string | null | undefined) => formatDateTime(iso, "—", props.zone);

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
    :sort="sort"
    embedded
    sticky-header
    pin-first-column
    :nowrap="false"
    :row-class="() => 'cursor-pointer'"
    @row-click="emit('open', $event as DispatchBoardRow)"
    @retry="emit('retry')"
    @sort="emit('sort', $event)"
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
        <!-- The row opens the truck's drawer on a click; the unit number is the same action as a real
             button, so a keyboard reaches it too (contract §5.7: the primary cell is focusable). -->
        <BaseButton variant="link" :aria-label="`Open truck ${row.unitNumber}`" @click.stop="emit('open', row)">
          {{ row.unitNumber }}
        </BaseButton>
      </div>
      <div class="text-xs text-ink-muted">{{ row.inShop ? "In shop" : (row.fleetCode ?? "No fleet") }}</div>
    </template>

    <template #cell-driver="{ row }">
      {{ row.driver?.name ?? row.current?.driverName ?? "—" }}
    </template>

    <template #cell-hos="{ row }">
      <span
        v-if="row.hos"
        :class="legalDriveLeft(row) != null && legalDriveLeft(row)! < BOARD_HOS_LOW_MS ? 'font-medium text-caution-700' : 'text-ink'"
        :title="`Drive ${durationWords(row.hos.driveRemainingMs)} · shift ${durationWords(row.hos.shiftRemainingMs)} · cycle ${durationWords(row.hos.cycleRemainingMs)}`"
      >
        {{ durationWords(legalDriveLeft(row)) }}
      </span>
      <span v-else class="text-ink-tertiary">—</span>
      <div v-if="row.hos" class="mt-0.5">
        <span :class="[BADGE_BASE, toneClass(hosStatusBadge(row.hos.status).tone)]">{{ hosStatusBadge(row.hos.status).label }}</span>
      </div>
    </template>

    <template #cell-now="{ row }">
      <div>{{ row.position?.place ?? "—" }}</div>
      <div class="text-xs" :class="row.flags.noGps ? 'text-caution-700' : 'text-ink-muted'">
        GPS {{ gpsAgeWords(row.position?.ageSeconds) }}<template v-if="row.position?.speedMph"> · <span class="whitespace-nowrap">{{ Math.round(row.position.speedMph) }} mph</span></template>
      </div>
    </template>

    <template #cell-load="{ row }">
      <template v-if="row.current">
        <BaseButton variant="link" :to="{ name: 'load-detail', params: { id: row.current.loadId } }" class="font-medium" @click.stop>
          {{ row.current.ref ?? "Load" }}
        </BaseButton>
        <span class="text-ink-muted"> · {{ loadLabel(row.current) }}</span>
        <div class="text-xs text-ink-muted">{{ row.current.customerName ?? "—" }}</div>
        <div v-if="movedByOther(fleetOwner(row.fleetCode), row.current)" class="text-xs text-ink-muted">
          Moved by {{ dispatcherName(row.current.dispatcherId, dispatchers) }}
        </div>
      </template>
      <!-- A state the dispatcher acts on is a badge; a value that is simply not there is the table's dash. -->
      <span v-else-if="row.inShop" :class="[BADGE_BASE, toneClass('neutral')]">In shop</span>
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
      <span v-else class="text-ink-tertiary">—</span>
    </template>

    <template #cell-onTime="{ row }">
      <span
        v-if="row.current"
        :class="[BADGE_BASE, toneClass(onTimeBadge(row.onTime).tone)]"
        :title="row.eta ? `ETA ${at(row.eta.at)} · ${row.eta.miles} mi by distance at 50 mph${row.eta.restAdded ? ', including a 10-hour reset' : ''}` : 'No ETA: the truck or the stop has no position'"
      >
        {{ onTimeBadge(row.onTime).label }}
      </span>
      <span v-else class="text-ink-tertiary">—</span>
    </template>

    <template #cell-empties="{ row }">
      <template v-if="row.empties && row.current">
        <div>{{ row.empties.place ?? "—" }}</div>
        <div class="whitespace-nowrap text-xs text-ink-muted">{{ at(row.empties.at) }}</div>
      </template>
      <span v-else-if="row.empties">Now</span>
      <span v-else class="text-ink-tertiary">—</span>
    </template>

    <template #cell-next="{ row }">
      <template v-if="row.next">
        <BaseButton variant="link" :to="{ name: 'load-detail', params: { id: row.next.loadId } }" class="font-medium" @click.stop>
          {{ row.next.ref ?? "Load" }}
        </BaseButton>
        <div class="text-xs text-ink-muted">{{ stopPlace(row.next.nextStop) || row.next.customerName }}</div>
      </template>
      <span v-else-if="row.flags.noNextLoad" :class="[BADGE_BASE, toneClass('neutral')]">None</span>
      <span v-else class="text-ink-tertiary">—</span>
    </template>
  </DataTable>
</template>
