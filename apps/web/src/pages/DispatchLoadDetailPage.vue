<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  approvalChecklist,
  canTransition,
  isTerminal,
  LOAD_EVENT_LABELS,
  type AssignLoadRequest,
} from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppFormField as FormField } from "@silvicom/ui";
import { AppCombobox as ComboSelect } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import DispatchLoadFormPage from "@/pages/DispatchLoadFormPage.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useDriversQuery } from "@/composables/useDrivers";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/composables/useTrailers";
import HazmatPanel from "@/features/hazmat/HazmatPanel.vue";
import {
  statusLabel,
  useAssignLoad,
  useLoadDetailQuery,
  useTransitionLoad,
  useUpdateLoad,
  type DispatchStopDetail,
  type LoadAction,
} from "@/features/dispatch/useDispatchLoads";

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
 */

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const toast = useToastStore();

const loadId = computed(() => (typeof route.params.id === "string" ? route.params.id : null));
const { data: load, isLoading, isError, error } = useLoadDetailQuery(loadId);

const { data: drivers } = useDriversQuery();
const { data: vehicles } = useVehiclesQuery();
const { data: trailers } = useTrailersQuery();

const transitionLoad = useTransitionLoad();
const assignLoad = useAssignLoad();
const updateLoad = useUpdateLoad();
const busy = computed(
  () => transitionLoad.isPending.value || assignLoad.isPending.value || updateLoad.isPending.value,
);

// ── lifecycle gates — the same state machine the database trigger enforces ────
const checklist = computed(() => (load.value ? approvalChecklist(load.value) : null));
const canSubmit = computed(() => !!load.value && canTransition(load.value.status, "pending_approval"));
const showApprove = computed(() => !!load.value && canTransition(load.value.status, "approved"));
const canApprove = computed(() => showApprove.value && !!checklist.value?.canApprove);
const canReject = computed(() => load.value?.status === "pending_approval");
const canRelease = computed(() => !!load.value && canTransition(load.value.status, "offered"));
const canCancel = computed(() => !!load.value && canTransition(load.value.status, "canceled"));
const editable = computed(
  () => load.value?.status === "draft" || load.value?.status === "pending_approval",
);
const canReassign = computed(() => !!load.value && !isTerminal(load.value.status));

// ── formatting ───────────────────────────────────────────────────────────────
function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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

// ── actions ──────────────────────────────────────────────────────────────────
const reasonFor = ref<"reject" | "cancel" | null>(null);
const reasonText = ref("");
function openReason(action: "reject" | "cancel") {
  reasonFor.value = action;
  reasonText.value = "";
}

async function runTransition(action: LoadAction, reason?: string) {
  if (!load.value || !session.can("dispatch")) return;
  try {
    await transitionLoad.mutateAsync({ id: load.value.id, action, reason });
    toast.success(`${load.value.ref} updated`);
    reasonFor.value = null;
  } catch (e) {
    toast.error("That step is not available", e instanceof Error ? e.message : undefined);
  }
}
function confirmReason() {
  const action = reasonFor.value;
  if (!action || !reasonText.value.trim()) return;
  void runTransition(action, reasonText.value.trim());
}

const assignOpen = ref(false);
const assignDriver = ref("");
const assignVehicle = ref("");
const assignTrailer = ref("");
const driverOptions = computed(() =>
  (drivers.value ?? []).map((d) => ({ value: d.id, label: d.full_name })),
);
const vehicleOptions = computed(() => [
  { value: "", label: "— None —" },
  ...(vehicles.value ?? []).map((v) => ({ value: v.id, label: v.unit_number })),
]);
const trailerOptions = computed(() => [
  { value: "", label: "— None —" },
  ...(trailers.value ?? []).map((t) => ({ value: t.id, label: t.unit_number })),
]);
function openAssign() {
  if (!load.value) return;
  assignDriver.value = load.value.driver_id ?? "";
  assignVehicle.value = load.value.vehicle_id ?? "";
  assignTrailer.value = load.value.trailer_id ?? "";
  assignOpen.value = true;
}
async function confirmAssign() {
  if (!load.value || !assignDriver.value) return;
  const body: AssignLoadRequest = {
    driver_id: assignDriver.value,
    vehicle_id: assignVehicle.value || null,
    trailer_id: assignTrailer.value || null,
  };
  try {
    await assignLoad.mutateAsync({ id: load.value.id, body });
    toast.success(`${load.value.ref} reassigned`);
    assignOpen.value = false;
  } catch (e) {
    toast.error("Could not reassign this load", e instanceof Error ? e.message : undefined);
  }
}

// ── edit ─────────────────────────────────────────────────────────────────────
const editOpen = computed(() => route.query.edit === "1");
function openEdit() {
  if (session.can("dispatch")) void router.replace({ query: { ...route.query, edit: "1" } });
}
function closeEdit() {
  const { edit: _edit, ...rest } = route.query;
  void router.replace({ query: rest });
}
async function onEditSubmit(body: Parameters<typeof updateLoad.mutateAsync>[0]["body"]) {
  if (!load.value) return;
  try {
    await updateLoad.mutateAsync({ id: load.value.id, body });
    toast.success(`${load.value.ref} saved`);
    closeEdit();
  } catch (e) {
    toast.error("Could not save this load", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="One load — its plan, what the driver actually did, and every step that got it here.">
      <template #actions>
        <BaseButton v-if="editable && session.can('dispatch')" variant="secondary" size="sm" @click="openEdit">Edit</BaseButton>
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
              <span :class="[BADGE_BASE, toneClass(load.status === 'canceled' ? 'neutral' : 'brand')]">
                {{ statusLabel(load.status) }}
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

          <div v-if="session.can('dispatch') && !reasonFor" class="flex flex-wrap items-center gap-2">
            <BaseButton v-if="canCancel" variant="ghost" size="sm" :disabled="busy" @click="openReason('cancel')">Cancel load</BaseButton>
            <BaseButton v-if="canReject" variant="soft" size="sm" :disabled="busy" @click="openReason('reject')">Send back</BaseButton>
            <BaseButton v-if="canSubmit" variant="primary" size="sm" :disabled="busy" @click="runTransition('submit')">Submit for approval</BaseButton>
            <BaseButton v-if="showApprove" variant="primary" size="sm" :disabled="busy || !canApprove" @click="runTransition('approve')">Approve</BaseButton>
            <BaseButton v-if="canRelease" variant="primary" size="sm" :disabled="busy" @click="runTransition('release')">Send to driver</BaseButton>
          </div>
        </div>

        <div v-if="reasonFor" class="mt-3 space-y-2">
          <FormField v-slot="{ id }" :label="reasonFor === 'reject' ? 'Reason for sending back' : 'Reason for cancelling'" required>
            <BaseInput :id="id" v-model="reasonText" placeholder="Required — the driver and any auditor will see this" />
          </FormField>
          <div class="flex justify-end gap-2">
            <BaseButton variant="ghost" size="sm" @click="reasonFor = null">Cancel</BaseButton>
            <BaseButton variant="danger" size="sm" :disabled="busy || !reasonText.trim()" @click="confirmReason">
              Confirm {{ reasonFor }}
            </BaseButton>
          </div>
        </div>
        <p v-if="showApprove && !canApprove && !reasonFor" class="mt-2 text-xs text-ink-muted">
          Resolve the ✕ items in the checklist below to approve.
        </p>

        <dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div><dt class="text-ink-tertiary">Driver</dt><dd class="text-ink">{{ load.driver_name ?? "Unassigned" }}</dd></div>
          <div><dt class="text-ink-tertiary">Truck</dt><dd class="text-ink">{{ load.vehicle_unit ?? "—" }}</dd></div>
          <div><dt class="text-ink-tertiary">Trailer</dt><dd class="text-ink">{{ load.trailer_unit ?? "—" }}</dd></div>
          <div v-if="load.external_id"><dt class="text-ink-tertiary">TMS reference</dt><dd class="font-mono text-ink">{{ load.external_id }}</dd></div>
        </dl>

        <div v-if="canReassign && session.can('dispatch')" class="mt-3">
          <BaseButton v-if="!assignOpen" variant="ghost" size="sm" @click="openAssign">Reassign…</BaseButton>
          <div v-else class="space-y-2">
            <FormField v-slot="{ id }" label="Driver">
              <ComboSelect :id="id" v-model="assignDriver" :options="driverOptions" placeholder="Search drivers…" />
            </FormField>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <FormField v-slot="{ id }" label="Truck">
                <ComboSelect :id="id" v-model="assignVehicle" :options="vehicleOptions" />
              </FormField>
              <FormField v-slot="{ id }" label="Trailer">
                <ComboSelect :id="id" v-model="assignTrailer" :options="trailerOptions" />
              </FormField>
            </div>
            <div class="flex justify-end gap-2">
              <BaseButton variant="ghost" size="sm" @click="assignOpen = false">Cancel</BaseButton>
              <BaseButton variant="primary" size="sm" :disabled="busy || !assignDriver" @click="confirmAssign">Assign</BaseButton>
            </div>
          </div>
        </div>

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

      <!-- Approval checklist -->
      <BaseCard v-if="checklist && (showApprove || canSubmit)">
        <h2 class="text-sm font-semibold text-ink">Approval checklist</h2>
        <ul class="mt-3 space-y-1.5 text-sm">
          <li v-for="c in checklist.checks" :key="c.id" class="flex items-start gap-2">
            <span :class="c.passed ? 'text-success-600' : c.required ? 'text-danger-600' : 'text-warning-600'">
              {{ c.passed ? "✓" : c.required ? "✕" : "!" }}
            </span>
            <span :class="c.passed ? 'text-ink-muted' : 'text-ink'">
              {{ c.label }}<span v-if="!c.passed && c.detail" class="text-ink-muted"> — {{ c.detail }}</span>
            </span>
          </li>
        </ul>
      </BaseCard>

      <!-- Stops: the plan, and what actually happened at each one -->
      <BaseCard>
        <h2 class="text-sm font-semibold text-ink">Stops</h2>
        <ol class="mt-3 space-y-3">
          <li v-for="stop in load.stops" :key="stop.id" class="rounded-surface border border-edge p-3 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-medium text-ink">
                {{ stop.seq }}. {{ stop.kind === "pickup" ? "Pickup" : "Drop-off" }} — {{ stop.name || "Unnamed" }}
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
            <p v-if="stop.arrived_at || stop.completed_at" class="mt-0.5 text-xs text-ink-muted">
              <span v-if="stop.arrived_at">Arrived {{ when(stop.arrived_at) }}</span>
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

      <SlideOver :open="editOpen" :title="`Edit ${load.ref}`" @close="closeEdit">
        <DispatchLoadFormPage
          v-if="editOpen"
          :load="load"
          :drivers="(drivers ?? []).map((d) => ({ id: d.id, full_name: d.full_name }))"
          :vehicles="(vehicles ?? []).map((v) => ({ id: v.id, unit_number: v.unit_number }))"
          :trailers="(trailers ?? []).map((t) => ({ id: t.id, unit_number: t.unit_number }))"
          :saving="busy"
          @submit="onEditSubmit"
          @cancel="closeEdit"
        />
      </SlideOver>
    </template>
  </div>
</template>
