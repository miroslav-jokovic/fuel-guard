<script setup lang="ts">
import { formatDateTime } from "@/lib/format";
import { loadStopName, milesLeftWords } from "./dispatchBoardView";
import type { DispatchStop } from "./useDispatchLoads";

/**
 * The Loads page's Pickup and Delivery cells: the place, its city, and when.
 *
 * DBV7 (DISPATCH-BOARD-V2-PLAN §3.2, Q-DBV6): the Delivery cell carries what the board shows for the same
 * load, so the two pages give one answer. Its appointment always shows — an arrival is printed beneath it,
 * never in its place, because the board judges Available against that appointment — and, for the load a
 * truck is hauling now, the board's miles left. Those miles are READ off the board row (`loadsOnBoard`),
 * never computed here: the chain runs from the truck's GPS fix, which this list does not have.
 */
const props = defineProps<{
  stop: DispatchStop | null;
  end: "pickup" | "delivery";
  /** Stops beyond the pickup and the final delivery, counted under Delivery. */
  extra: number;
  total: number;
  /** The board's miles left for this load; null when no truck hauls it now, or the board has no figure. */
  milesLeft: number | null;
  zone: string;
}>();

const at = (iso: string | null | undefined) => formatDateTime(iso, "—", props.zone);
const city = (s: DispatchStop) => [s.city, s.state].filter(Boolean).join(", ");
</script>

<template>
  <div v-if="stop" class="min-w-0">
    <p class="truncate text-ink" :title="loadStopName(stop)">{{ loadStopName(stop) || "Unnamed stop" }}</p>
    <p class="truncate text-xs text-ink-muted">{{ city(stop) }}</p>
    <!-- Both on the carrier's clock. A pickup's arrival replaces its appointment: once there, the
         appointment no longer decides anything on this page. -->
    <p v-if="end === 'pickup' && stop.actual_arrival_at" class="text-xs tabular-nums text-ink-secondary">Arrived {{ at(stop.actual_arrival_at) }}</p>
    <template v-else>
      <p class="text-xs tabular-nums text-ink-muted">{{ stop.appointment_start ? `Appt ${at(stop.appointment_start)}` : "No appointment" }}</p>
      <p v-if="stop.actual_arrival_at" class="text-xs tabular-nums text-ink-secondary">Arrived {{ at(stop.actual_arrival_at) }}</p>
      <p
        v-else-if="end === 'delivery' && milesLeft != null"
        class="text-xs tabular-nums text-ink-secondary"
        title="Estimated road miles to the final delivery, through every stop still to make — the board's figure"
      >
        {{ milesLeftWords(milesLeft) }} left
      </p>
    </template>
    <p v-if="end === 'delivery' && extra" class="text-xs text-ink-secondary" :title="`${total} stops in all`">
      +{{ extra }} more {{ extra === 1 ? "stop" : "stops" }}
    </p>
  </div>
  <span v-else class="text-ink-tertiary">—</span>
</template>
