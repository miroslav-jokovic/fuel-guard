<script setup lang="ts">
import { ref, computed } from "vue";
import {
  approvalChecklist,
  canTransition,
  isTerminal,
  LOAD_STATUS_LABELS,
  type AssignLoadRequest,
} from "@fuelguard/shared";
import FormField from "@/components/ui/FormField.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import ComboSelect from "@/components/ui/ComboSelect.vue";
import type { DispatchLoad, LoadAction } from "./useDispatchLoads";

/**
 * The load detail + action rail. The lifecycle is `draft → needs approval → approved → sent to driver`;
 * each button is gated by the SAME state machine the API trigger enforces (`canTransition`), and Approve
 * is additionally gated by the shared `approvalChecklist` so an operator sees exactly what's missing.
 */

const props = defineProps<{
  load: DispatchLoad;
  drivers: { id: string; full_name: string }[];
  vehicles: { id: string; unit_number: string }[];
  trailers: { id: string; unit_number: string }[];
  busy: boolean;
  canManage: boolean;
}>();

const emit = defineEmits<{
  transition: [action: LoadAction, reason?: string];
  assign: [body: AssignLoadRequest];
  edit: [];
}>();

const checklist = computed(() => approvalChecklist(props.load));
const statusLabel = computed(() => LOAD_STATUS_LABELS[props.load.status]);

const canSubmit = computed(() => canTransition(props.load.status, "pending_approval"));
const canApprove = computed(
  () => canTransition(props.load.status, "approved") && checklist.value.canApprove,
);
const showApprove = computed(() => canTransition(props.load.status, "approved"));
const canReject = computed(
  () => props.load.status === "pending_approval" && canTransition(props.load.status, "draft"),
);
const canRelease = computed(() => canTransition(props.load.status, "offered"));
const canCancel = computed(() => canTransition(props.load.status, "canceled"));
const editable = computed(() => props.load.status === "draft" || props.load.status === "pending_approval");
const canReassign = computed(() => !isTerminal(props.load.status) && props.load.status !== "delivered");

// Reject / cancel demand a reason — surfaced as an inline confirm rather than a native prompt.
const reasonFor = ref<"reject" | "cancel" | null>(null);
const reasonText = ref("");
function openReason(action: "reject" | "cancel") {
  reasonFor.value = action;
  reasonText.value = "";
}
function confirmReason() {
  const action = reasonFor.value;
  if (!action || !reasonText.value.trim()) return;
  emit("transition", action, reasonText.value.trim());
  reasonFor.value = null;
}

// Reassignment.
const assignOpen = ref(false);
const assignDriver = ref(props.load.driver_id ?? "");
const assignVehicle = ref(props.load.vehicle_id ?? "");
const assignTrailer = ref(props.load.trailer_id ?? "");
const driverOptions = computed(() => props.drivers.map((d) => ({ value: d.id, label: d.full_name })));
const vehicleOptions = computed(() => [
  { value: "", label: "— None —" },
  ...props.vehicles.map((v) => ({ value: v.id, label: v.unit_number })),
]);
const trailerOptions = computed(() => [
  { value: "", label: "— None —" },
  ...props.trailers.map((t) => ({ value: t.id, label: t.unit_number })),
]);
function confirmAssign() {
  if (!assignDriver.value) return;
  emit("assign", {
    driver_id: assignDriver.value,
    vehicle_id: assignVehicle.value || null,
    trailer_id: assignTrailer.value || null,
  });
  assignOpen.value = false;
}

function apptLabel(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return "No appointment window";
  const fmt = (s: string) => {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };
  return end ? `${fmt(start)} → ${fmt(end)}` : fmt(start);
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex-1 space-y-6 overflow-y-auto px-1">
      <!-- Summary -->
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-lg font-semibold text-ink">{{ load.ref }}</span>
            <span class="inline-flex items-center rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink-secondary">
              {{ statusLabel }}
            </span>
            <span v-if="load.hazmat" class="inline-flex items-center rounded-full bg-warning-50 px-2.5 py-0.5 text-xs font-medium text-warning-700">
              Hazmat
            </span>
          </div>
          <p class="mt-1 text-sm text-ink-muted">
            {{ load.equipment ?? "No equipment" }}<span v-if="load.commodity"> · {{ load.commodity }}</span>
            <span v-if="load.total_miles"> · {{ Math.round(load.total_miles) }} mi</span>
          </p>
        </div>
        <BaseButton v-if="editable && canManage" type="button" variant="secondary" size="sm" @click="emit('edit')">Edit</BaseButton>
      </div>

      <!-- Assignment -->
      <div class="rounded-lg border border-edge p-3 text-sm">
        <div class="grid grid-cols-3 gap-3">
          <div>
            <p class="text-xs text-ink-muted">Driver</p>
            <p class="font-medium text-ink">{{ load.driver_name ?? "Unassigned" }}</p>
          </div>
          <div>
            <p class="text-xs text-ink-muted">Truck</p>
            <p class="font-medium text-ink">{{ load.vehicle_unit ?? "—" }}</p>
          </div>
          <div>
            <p class="text-xs text-ink-muted">Trailer</p>
            <p class="font-medium text-ink">{{ load.trailer_unit ?? "—" }}</p>
          </div>
        </div>
        <div v-if="canReassign && canManage" class="mt-3">
          <BaseButton v-if="!assignOpen" type="button" variant="ghost" size="sm" @click="assignOpen = true">
            Reassign…
          </BaseButton>
          <div v-else class="space-y-2">
            <FormField label="Driver" v-slot="{ id }">
              <ComboSelect :id="id" v-model="assignDriver" :options="driverOptions" placeholder="Search drivers…" />
            </FormField>
            <div class="grid grid-cols-2 gap-2">
              <FormField label="Truck" v-slot="{ id }">
                <ComboSelect :id="id" v-model="assignVehicle" :options="vehicleOptions" />
              </FormField>
              <FormField label="Trailer" v-slot="{ id }">
                <ComboSelect :id="id" v-model="assignTrailer" :options="trailerOptions" />
              </FormField>
            </div>
            <div class="flex justify-end gap-2">
              <BaseButton type="button" variant="ghost" size="sm" @click="assignOpen = false">Cancel</BaseButton>
              <BaseButton type="button" variant="primary" size="sm" :disabled="busy || !assignDriver" @click="confirmAssign">
                Assign
              </BaseButton>
            </div>
          </div>
        </div>
      </div>

      <!-- Approval checklist -->
      <div v-if="showApprove || canSubmit">
        <h3 class="mb-2 text-sm font-semibold text-ink">Approval checklist</h3>
        <ul class="space-y-1.5 text-sm">
          <li v-for="c in checklist.checks" :key="c.id" class="flex items-start gap-2">
            <span :class="c.passed ? 'text-success-600' : c.required ? 'text-danger-600' : 'text-warning-600'">
              {{ c.passed ? "✓" : c.required ? "✕" : "!" }}
            </span>
            <span :class="c.passed ? 'text-ink-muted' : 'text-ink'">
              {{ c.label }}<span v-if="!c.passed && c.detail" class="text-ink-muted"> — {{ c.detail }}</span>
            </span>
          </li>
        </ul>
      </div>

      <!-- Stops -->
      <div>
        <h3 class="mb-2 text-sm font-semibold text-ink">Stops</h3>
        <ol class="space-y-2">
          <li v-for="stop in load.stops" :key="stop.id ?? stop.seq" class="rounded-lg border border-edge p-3 text-sm">
            <div class="flex items-center justify-between">
              <span class="font-medium text-ink">
                {{ stop.seq }}. {{ stop.kind === "pickup" ? "Pickup" : "Drop-off" }} — {{ stop.name || "Unnamed" }}
              </span>
              <span class="text-xs text-ink-muted">{{ [stop.city, stop.state].filter(Boolean).join(", ") }}</span>
            </div>
            <p class="mt-0.5 text-xs text-ink-muted">{{ apptLabel(stop.appointment_start, stop.appointment_end) }}</p>
            <div v-if="(stop.required_photos ?? []).length" class="mt-1.5 flex flex-wrap gap-1">
              <span
                v-for="p in stop.required_photos"
                :key="p"
                class="inline-flex items-center rounded bg-surface-muted px-1.5 py-0.5 text-[11px] text-ink-secondary"
              >
                {{ p }}
              </span>
            </div>
          </li>
        </ol>
      </div>
    </div>

    <!-- Action rail -->
    <div v-if="canManage" class="mt-4 space-y-3 border-t border-edge pt-4">
      <div v-if="reasonFor" class="space-y-2">
        <FormField :label="reasonFor === 'reject' ? 'Reason for sending back' : 'Reason for cancelling'" required v-slot="{ id }">
          <BaseInput :id="id" v-model="reasonText" placeholder="Required — the driver / auditor will see this" />
        </FormField>
        <div class="flex justify-end gap-2">
          <BaseButton type="button" variant="ghost" size="sm" @click="reasonFor = null">Cancel</BaseButton>
          <BaseButton type="button" variant="danger" size="sm" :disabled="busy || !reasonText.trim()" @click="confirmReason">
            Confirm {{ reasonFor }}
          </BaseButton>
        </div>
      </div>

      <div v-else class="flex flex-wrap justify-end gap-2">
        <BaseButton v-if="canCancel" type="button" variant="ghost" size="sm" :disabled="busy" @click="openReason('cancel')">
          Cancel load
        </BaseButton>
        <BaseButton v-if="canReject" type="button" variant="soft" size="sm" :disabled="busy" @click="openReason('reject')">
          Send back
        </BaseButton>
        <BaseButton v-if="canSubmit" type="button" variant="primary" size="sm" :disabled="busy" @click="emit('transition', 'submit')">
          Submit for approval
        </BaseButton>
        <BaseButton
          v-if="showApprove"
          type="button"
          variant="primary"
          size="sm"
          :disabled="busy || !canApprove"
          @click="emit('transition', 'approve')"
        >
          Approve
        </BaseButton>
        <BaseButton v-if="canRelease" type="button" variant="primary" size="sm" :disabled="busy" @click="emit('transition', 'release')">
          Send to driver
        </BaseButton>
      </div>
      <p v-if="showApprove && !canApprove && !reasonFor" class="text-right text-xs text-ink-muted">
        Resolve the ✕ items above to approve.
      </p>
    </div>
  </div>
</template>
