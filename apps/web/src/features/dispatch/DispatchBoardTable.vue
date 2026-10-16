<script setup lang="ts">
import {
  AppButton as BaseButton,
  DataTable,
  TablePagination,
  type SortState,
  type DataTableColumn,
} from "@silvicom/ui";
import { loadBoardState, movedByOther, needsAttention, type DispatchBoardRow, type LoadStatus } from "@silvicom/shared";
import { BADGE_BASE, hosStatusBadge, onTimeBadge, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import {
  availablePlace,
  availableTone,
  dispatcherName,
  durationWords,
  gpsAgeWords,
  legalDriveLeft,
  milesLeftWords,
  POOL_FLEET,
  stopPlace,
  warningWords,
} from "./dispatchBoardView";
import { BOARD_HOS_LOW_MS } from "@silvicom/shared";

/**
 * The dispatch board's table (DISPATCH-BOARD-V2-PLAN D-DBV1): one row per truck, read left to right the
 * way the dispatchers' own board reads — who, whose, when and where it is free, how far it still has to
 * drive, its state. The v1 board's live columns (HOS, Now, Current load, Next stop, Next load) are still
 * drawn here when the reader turns them on. Every verdict (on time, the flags, the availability) arrived
 * from the server; this only draws. Times are on the CARRIER's clock (`zone`), never the viewer's.
 *
 * It pages (D-US8): 197 active trucks were one table on 2026-10-13, and the owner named this board as
 * the list nobody could get to the bottom of. Filtering, sorting and slicing stay with the page, which
 * owns the URL (`?page=`); this draws the pager in the table's own footer, as `DriverRosterTable` does.
 */
const props = defineProps<{
  /** The current page of rows — already filtered, sorted and sliced by the page. */
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
  /** The board's own clock (`generatedAt`), so Available's colour is judged when the ETAs were made. */
  now: Date;
  page: number;
  pageSize: number;
  /** Total rows behind the pagination, i.e. the filtered count, not `rows.length`. */
  total: number;
}>();
const emit = defineEmits<{ retry: []; open: [row: DispatchBoardRow]; sort: [key: string]; "update:page": [page: number] }>();

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
      <div class="text-xs text-ink-muted">{{ row.current?.trailerUnit ? `Trailer ${row.current.trailerUnit}` : "No trailer" }}</div>
    </template>

    <template #cell-dispatcher="{ row }">
      <div>{{ row.fleetCode === POOL_FLEET ? "Pool" : (row.fleetCode ?? "—") }}</div>
      <div v-if="movedByOther(fleetOwner(row.fleetCode), row.current)" class="text-xs text-ink-muted">
        Moved by {{ dispatcherName(row.current!.dispatcherId, dispatchers) }}
      </div>
    </template>

    <template #cell-available="{ row }">
      <span v-if="row.inShop" :class="[BADGE_BASE, toneClass('neutral')]">In shop</span>
      <template v-else-if="row.available?.at">
        <span :class="[BADGE_BASE, toneClass(availableTone(row, now)), 'whitespace-nowrap']">
          {{ row.current ? at(row.available.at) : "Now" }}
        </span>
        <div v-if="row.available.basis === 'eta'" class="text-xs text-ink-muted">by our ETA, after the appointment</div>
      </template>
      <span v-else class="text-ink-tertiary">—</span>
    </template>

    <template #cell-availableIn="{ row }">
      {{ availablePlace(row) || "—" }}
    </template>

    <template #cell-milesLeft="{ row }">
      <span :title="row.milesLeft != null ? 'Estimated road miles to the final delivery, through every stop still to make' : undefined">
        {{ row.current ? milesLeftWords(row.milesLeft) : "—" }}
      </span>
    </template>

    <template #cell-status="{ row }">
      <span v-if="row.inShop" :class="[BADGE_BASE, toneClass('neutral')]">In shop</span>
      <template v-else-if="row.current">
        <span
          :class="[BADGE_BASE, toneClass(onTimeBadge(row.onTime).tone)]"
          :title="row.eta ? `ETA ${at(row.eta.at)} · ${row.eta.miles} mi by distance at 50 mph${row.eta.restAdded ? ', including a 10-hour reset' : ''}` : 'No ETA: the truck or the stop has no position'"
        >
          {{ onTimeBadge(row.onTime).label }}
        </span>
        <div class="text-xs text-ink-muted">
          <BaseButton variant="link" :to="{ name: 'load-detail', params: { id: row.current.loadId } }" class="text-xs" @click.stop>
            {{ row.current.ref ?? "Load" }}
          </BaseButton>
          <template v-if="row.next"> · next {{ row.next.ref ?? "load" }}</template>
        </div>
      </template>
      <template v-else>
        <span :class="[BADGE_BASE, toneClass('warning')]">Empty</span>
        <div v-if="row.next" class="text-xs text-ink-muted">next {{ row.next.ref ?? "load" }}</div>
      </template>
    </template>

    <template #cell-warnings="{ row }">
      <!-- Only what is due shows, as the dispatchers' board does it; nothing due is the table's dash.
           The chips wrap, unlike Available's: "Trailer annual overdue 10/01/2026" is wider than the
           column, and unwrapped it ran past the table's edge at 1440 px (browser pass, 2026-10-16). -->
      <div v-if="row.warnings.length" class="flex flex-col items-start gap-0.5">
        <span
          v-for="(w, i) in row.warnings"
          :key="i"
          :class="[BADGE_BASE, toneClass(w.verdict === 'overdue' ? 'danger' : 'warning')]"
        >
          {{ warningWords(w) }}
        </span>
      </div>
      <span v-else class="text-ink-tertiary">—</span>
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

    <template #footer>
      <TablePagination
        :page="props.page"
        :page-size="props.pageSize"
        :total="props.total"
        :loading="retrying"
        @update:page="emit('update:page', $event)"
      />
    </template>
  </DataTable>
</template>
