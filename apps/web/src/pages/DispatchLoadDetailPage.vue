<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { isDispatchable, loadBoardState, LOAD_EVENT_LABELS } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import HazmatPanel from "@/features/hazmat/HazmatPanel.vue";
import DispatchLoadDrawer from "@/features/dispatch/DispatchLoadDrawer.vue";
import { dispatchHeadline, smsReasonText } from "@/features/dispatch/useLoadDispatch";
import { useLoadDetailQuery, type DispatchStopDetail } from "@/features/dispatch/useDispatchLoads";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { formatDateTime } from "@/lib/format";

/**
 * One load, as a page (LD2).
 *
 * This replaces the slide-over that `/loads/:id` used to open over the board. A drawer over a list
 * cache cannot deep-link, cannot refresh without fetching every load in the organization, and goes
 * stale whenever the list query does — and dispatch works from this screen all day.
 *
 * It also shows three things the office has never been able to see, all of which were already
 * captured and already stored: the PHOTOS a driver took at each stop, what actually HAPPENED at each
 * stop (arrival, completion, and the free-text explaining a missing bill of lading), and the
 * PROVENANCE strip — who submitted, approved, released, assigned, accepted and delivered, and when.
 *
 * ── READ-ONLY BUT FOR DISPATCH, SINCE LR6 (LOADS-MIRROR-PLAN.md) ─────────────────────────────────
 * Edit, Cancel load, Send back, Submit for approval, Approve, Send to driver, Reassign and the
 * approval checklist all went with their routes: the load is McLeod's and every sync overwrites it
 * (D-LMR2), so an edit or a reassignment here was undone minutes later, and a load reaches its driver
 * by Dispatch (D-LMR5). The provenance strip still shows the stamps a load carries from before.
 */

const route = useRoute();
const session = useSessionStore();
// Every time on this page is on the carrier's clock (LR7): it is read against McLeod's screen, which is
// the office's, and a dispatcher and an auditor elsewhere must see the same appointment.
const { zone } = useOrgTimezone();

const loadId = computed(() => (typeof route.params.id === "string" ? route.params.id : null));
const { data: load, isLoading, isError, error } = useLoadDetailQuery(loadId);

const canDispatch = computed(() => !!load.value && isDispatchable(load.value));
const dispatchOpen = ref(false);
/** The same words the board uses (`loadBoardState`), so a load never reads two ways. */
const boardState = computed(() => (load.value ? loadBoardState(load.value) : null));

// ── formatting ───────────────────────────────────────────────────────────────
function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatDateTime(iso, iso, zone.value);
}
function apptLabel(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return "No appointment window";
  return end ? `${when(start)} → ${when(end)}` : when(start);
}

/** The lifecycle strip. Only stages that actually happened are shown — a blank row teaches nothing. */
const provenance = computed(() => {
  const l = load.value;
  if (!l) return [];
  return [
    { label: "Created", at: l.created_at },
    { label: "Submitted", at: l.submitted_at },
    { label: "Approved", at: l.approved_at },
    { label: "Released", at: l.released_at },
    { label: "Assigned", at: l.assigned_at },
    { label: "Accepted", at: l.accepted_at },
    { label: "Declined", at: l.declined_at },
    { label: "Delivered", at: l.completed_at },
  ].filter((s) => s.at);
});

const STOP_TONE: Record<string, string> = {
  completed: "success",
  arrived: "brand",
  skipped: "warning",
  pending: "neutral",
};
function stopTone(status: string | undefined): string {
  return STOP_TONE[status ?? "pending"] ?? "neutral";
}
/**
 * Photos organised the way dispatch reads them: by the slot that was ASKED for (LD3).
 *
 * A flat row of thumbnails cannot answer the only question that matters — "is the bill of lading
 * there?" — because a stop with three seal photos and no BOL looks busy and is missing the one thing
 * anybody will be asked for. Every required slot gets a group, present or not, and anything the driver
 * captured outside the asked-for slots is grouped separately rather than dropped.
 */
interface SlotGroup {
  slot: string;
  required: boolean;
  photos: DispatchStopDetail["photos"];
}
function slotGroups(stop: DispatchStopDetail): SlotGroup[] {
  const bySlot = new Map<string, DispatchStopDetail["photos"]>();
  for (const photo of stop.photos) {
    bySlot.set(photo.slot, [...(bySlot.get(photo.slot) ?? []), photo]);
  }
  const required = stop.required_photos ?? [];
  const extras = [...bySlot.keys()].filter((slot) => !required.includes(slot)).sort();
  return [
    ...required.map((slot) => ({ slot, required: true, photos: bySlot.get(slot) ?? [] })),
    ...extras.map((slot) => ({ slot, required: false, photos: bySlot.get(slot) ?? [] })),
  ];
}

/** Required slots with nothing captured — what dispatch chases, and only once a stop is finished. */
function outstandingSlots(stop: DispatchStopDetail): string[] {
  if (stop.status !== "completed" && stop.status !== "skipped") return [];
  const captured = new Set(stop.photos.map((p) => p.slot));
  return (stop.required_photos ?? []).filter((slot) => !captured.has(slot));
}

/**
 * A signed URL is signed over a PATH, so it is issued happily for an object that no longer exists —
 * the browser is the first thing that finds out. Marking those here keeps a dead thumbnail from
 * reading as "no photo taken", which is a completely different claim. The nightly reconciler
 * (`storageReconcile.ts`) catches the same condition server-side and flags it as possible evidence loss.
 */
const brokenPhotoIds = ref(new Set<string>());
function markBroken(id: string) {
  brokenPhotoIds.value = new Set([...brokenPhotoIds.value, id]);
}

</script>

<template>
  <div class="space-y-6">
    <PageHeader description="One load — its plan, what the driver actually did, and every step that got it here.">
      <template #actions>
        <BaseButton variant="ghost" size="sm" to="/loads">← Loads</BaseButton>
      </template>
    </PageHeader>

    <p v-if="isLoading" class="text-sm text-ink-muted">Loading…</p>
    <p v-else-if="isError" class="text-sm text-danger-600">
      {{ error instanceof Error ? error.message : "That load could not be loaded." }}
    </p>

    <template v-else-if="load">
      <!-- Summary + action rail -->
      <BaseCard>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-lg font-semibold text-ink">{{ load.ref }}</span>
              <span v-if="boardState" :class="[BADGE_BASE, toneClass(boardState.tone)]" :title="boardState.mcleodWords ?? undefined">
                {{ boardState.label }}
              </span>
              <span v-if="load.hazmat" :class="[BADGE_BASE, toneClass('warning')]">Hazmat</span>
              <span v-if="load.source === 'tms'" :class="[BADGE_BASE, toneClass('info')]">
                {{ load.provider ?? "TMS" }}
              </span>
            </div>
            <p class="mt-1 text-sm text-ink-muted">
              {{ load.equipment ?? "No equipment" }}<span v-if="load.commodity"> · {{ load.commodity }}</span>
              <span v-if="load.total_miles"> · {{ Math.round(load.total_miles) }} mi</span>
            </p>
          </div>

          <div v-if="session.can('dispatch') && canDispatch" class="flex flex-wrap items-center gap-2">
            <BaseButton variant="primary" size="sm" @click="dispatchOpen = true">{{ load.dispatches.length ? "Dispatch again" : "Dispatch" }}</BaseButton>
          </div>
        </div>

        <dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div v-if="load.source === 'tms'"><dt class="text-ink-tertiary">Dispatcher</dt><dd class="text-ink">{{ load.dispatcher_name ?? "—" }}</dd></div>
          <div><dt class="text-ink-tertiary">Driver</dt><dd class="text-ink">{{ load.driver_name ?? "Unassigned" }}</dd></div>
          <div><dt class="text-ink-tertiary">Truck</dt><dd class="text-ink">{{ load.vehicle_unit ?? "—" }}</dd></div>
          <div><dt class="text-ink-tertiary">Trailer</dt><dd class="text-ink">{{ load.trailer_unit ?? "—" }}</dd></div>
          <div v-if="load.external_id"><dt class="text-ink-tertiary">TMS reference</dt><dd class="font-mono text-ink">{{ load.external_id }}</dd></div>
          <div v-if="load.source === 'tms'" class="col-span-2" data-testid="dispatch-state"><dt class="text-ink-tertiary">Dispatch</dt><dd class="text-ink">{{ dispatchHeadline(load.dispatches[0]) }}</dd><dd v-if="load.dispatches[0]?.outcomeReason" class="text-xs text-ink-muted">{{ smsReasonText(load.dispatches[0].outcomeReason) }}</dd></div>
        </dl>

        <p v-if="load.decline_reason" class="mt-3 rounded-surface bg-warning-50 px-4 py-3 text-sm text-warning-800 ring-1 ring-inset ring-warning-200">
          Declined by the driver — &ldquo;{{ load.decline_reason }}&rdquo;
        </p>
        <p v-if="load.cancel_reason" class="mt-3 rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-inset ring-danger-200">
          Cancelled — &ldquo;{{ load.cancel_reason }}&rdquo;
        </p>
      </BaseCard>

      <!-- Provenance: who moved this load, and when -->
      <BaseCard>
        <h2 class="text-sm font-semibold text-ink">Progress</h2>
        <p class="mt-1 text-xs text-ink-muted">Every stage this load has actually reached.</p>
        <dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <div v-for="stage in provenance" :key="stage.label">
            <dt class="text-ink-tertiary">{{ stage.label }}</dt>
            <dd class="text-ink">{{ when(stage.at) }}</dd>
          </div>
        </dl>
      </BaseCard>

      <!-- H-C1: hazmat is a property of THIS load — the record lives here, not on a parallel board. -->
      <HazmatPanel v-if="load.hazmat || load.hazmat_record" :load="load" :can-manage="session.can('dispatch')" />

      <!-- Stops: the plan, and what actually happened at each one -->
      <BaseCard>
        <h2 class="text-sm font-semibold text-ink">Stops</h2>
        <ol class="mt-3 space-y-3">
          <li v-for="stop in load.stops" :key="stop.id" class="rounded-surface border border-edge p-3 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-medium text-ink">
                {{ stop.seq }}. {{ stop.kind === "pickup" ? "Pickup" : "Drop-off" }} — {{ stop.location_name || stop.name || "Unnamed" }}
              </span>
              <div class="flex items-center gap-2">
                <span class="text-xs text-ink-muted">{{ [stop.city, stop.state].filter(Boolean).join(", ") }}</span>
                <span
                  v-if="outstandingSlots(stop).length"
                  :class="[BADGE_BASE, toneClass('warning')]"
                  :title="`Missing: ${outstandingSlots(stop).join(', ')}`"
                >
                  {{ outstandingSlots(stop).length }} photo{{ outstandingSlots(stop).length === 1 ? "" : "s" }} missing
                </span>
                <span :class="[BADGE_BASE, toneClass(stopTone(stop.status)), 'capitalize']">{{ stop.status ?? "pending" }}</span>
              </div>
            </div>
            <p class="mt-0.5 text-xs text-ink-muted">{{ apptLabel(stop.appointment_start, stop.appointment_end) }}</p>
            <!-- LR7: what McLeod saw — its actual arrival and departure, else its ETA — beside the
                 driver app's own times below, never merged into them (Q-LMR2 decides whose counts). -->
            <p v-if="stop.actual_arrival_at || stop.actual_departure_at" class="mt-0.5 text-xs text-ink-secondary" data-testid="mcleod-actual">
              McLeod: <span v-if="stop.actual_arrival_at">arrived {{ when(stop.actual_arrival_at) }}</span><span v-if="stop.actual_arrival_at && stop.actual_departure_at"> · </span><span v-if="stop.actual_departure_at">departed {{ when(stop.actual_departure_at) }}</span>
            </p>
            <p v-else-if="stop.eta_at" class="mt-0.5 text-xs text-ink-secondary" data-testid="mcleod-eta">McLeod ETA {{ when(stop.eta_at) }}</p>
            <p v-if="stop.arrived_at || stop.completed_at" class="mt-0.5 text-xs text-ink-muted">
              <span v-if="stop.arrived_at">Driver arrived {{ when(stop.arrived_at) }}</span>
              <span v-if="stop.arrived_at && stop.completed_at"> · </span>
              <span v-if="stop.completed_at">Finished {{ when(stop.completed_at) }}</span>
            </p>

            <p
              v-if="stop.skip_reason"
              class="mt-2 rounded-surface bg-warning-50 px-3 py-2 text-xs text-warning-800 ring-1 ring-inset ring-warning-200"
            >
              Driver&rsquo;s note — &ldquo;{{ stop.skip_reason }}&rdquo;
            </p>

            <!-- The proof of work, by the slot that was asked for. Captured since 0085; visible for
                 the first time in LD2, and legible for the first time here. -->
            <div v-if="slotGroups(stop).length" class="mt-3 space-y-2">
              <div v-for="group in slotGroups(stop)" :key="group.slot" class="flex flex-wrap items-center gap-2">
                <span
                  :class="[
                    'inline-flex min-w-[5rem] items-center rounded-control px-1.5 py-0.5 text-2xs',
                    group.photos.length
                      ? 'bg-success-50 text-success-700'
                      : 'bg-warning-50 text-warning-700',
                  ]"
                >
                  {{ group.slot }}<span v-if="!group.required" class="pl-1 opacity-70">· extra</span>
                </span>

                <a
                  v-for="photo in group.photos"
                  :key="photo.id"
                  :href="photo.url ?? undefined"
                  target="_blank"
                  rel="noopener"
                  :title="`${photo.slot} · captured ${when(photo.captured_at)}`"
                  class="block"
                >
                  <img
                    v-if="photo.url && !brokenPhotoIds.has(photo.id)"
                    :src="photo.url"
                    :alt="`${photo.slot} photo`"
                    class="size-20 rounded-control object-cover ring-1 ring-edge"
                    @error="markBroken(photo.id)"
                  />
                  <span
                    v-else
                    class="flex size-20 items-center justify-center rounded-control bg-danger-50 px-1 text-center text-2xs text-danger-700 ring-1 ring-danger-200"
                    :title="'The record says this photo exists but the image could not be retrieved.'"
                  >
                    Image missing
                  </span>
                </a>

                <span v-if="!group.photos.length" class="text-xs text-ink-muted">
                  {{ stop.status === "completed" || stop.status === "skipped" ? "Not captured" : "Not captured yet" }}
                </span>
              </div>
            </div>
            <p v-else-if="stop.status === 'completed'" class="mt-2 text-xs text-ink-muted">
              No photos were asked for at this stop.
            </p>
          </li>
          <li v-if="load.stops.length === 0" class="py-2 text-sm text-ink-muted">No stops on this load yet.</li>
        </ol>
      </BaseCard>

      <!-- History -->
      <BaseCard>
        <h2 class="text-sm font-semibold text-ink">History</h2>
        <ol v-if="load.events.length" class="mt-3 space-y-2">
          <li v-for="e in load.events" :key="e.id" class="flex gap-2 text-sm">
            <span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-edge-strong" />
            <div>
              <p class="text-ink">{{ LOAD_EVENT_LABELS[e.kind] ?? e.kind }}</p>
              <p class="text-xs text-ink-muted">
                {{ e.actor_name ?? e.actor_role ?? "System" }} · {{ when(e.occurred_at) }}
                <span v-if="e.payload && e.payload.reason"> · &ldquo;{{ e.payload.reason }}&rdquo;</span>
              </p>
            </div>
          </li>
        </ol>
        <p v-else class="mt-3 text-sm text-ink-muted">No history yet.</p>
      </BaseCard>

      <DispatchLoadDrawer :load="dispatchOpen ? { ...load, last_dispatch: load.dispatches[0] ?? null } : null" @close="dispatchOpen = false" />
    </template>
  </div>
</template>
