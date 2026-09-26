<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  TRAVEL_MODES,
  TRAVEL_MODE_LABELS,
  formatDisplayDateTime,
  type ApplicantTravel,
  type TravelMode,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppInput as BaseInput, AppDateTimeField, AppFormField as FormField, AppSelect } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useApplicantTravelQuery, useBookTravel, useCancelTravel } from "@/features/recruitment/useApplicantTravel";

/**
 * The applicant's trip to the office — D-AW7 (APPLICATION-FLOW-V2-PLAN §7, C2b2).
 *
 * ── REFUSED UNTIL SCREENING IS DONE, AND THE PANEL SAYS SO BEFORE THE SERVER DOES ─────────────
 * Q-HM5: *"we will not even bring him if this not green."* The API refuses a booking while any step
 * before travel is open (`TRAVEL_REFUSES_WITHOUT`), and the checklist row is blocked on exactly that
 * list — so while the row is blocked the form is not offered, and the drawer's own "Needs:" line above
 * names what it waits for. The server's refusal is still read and shown if a race gets past this.
 *
 * ── THE CARRIER'S CLOCK ───────────────────────────────────────────────────────────────────────
 * Times are typed as the itinerary shows them and read on the CARRIER's clock (`carrierWallTimeSchema`),
 * never the browser's, so the form names that zone; the list shows every time on the same clock.
 */
const props = defineProps<{
  driverId: string;
  /** The checklist row is blocked: a step before travel is still open, and the API would refuse. */
  blocked: boolean;
}>();

const session = useSessionStore();
const toast = useToastStore();
const driverId = computed(() => props.driverId);
const travelQ = useApplicantTravelQuery(driverId);
const book = useBookTravel();
const cancel = useCancelTravel();

const canBook = computed(() => session.can("recruitment"));
const zone = computed(() => travelQ.data.value?.timeZone ?? null);

/** "Central Daylight Time" — the zone's own name, for a form that means the carrier's clock. */
const zoneName = computed(() => {
  if (!zone.value) return "the carrier's time";
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone.value, timeZoneName: "long" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? zone.value;
});

const trips = computed<ApplicantTravel[]>(() => travelQ.data.value?.trips ?? []);
const live = computed(() => trips.value.find((t) => t.cancelledAt === null) ?? null);
const cancelled = computed(() => trips.value.filter((t) => t.cancelledAt !== null));

const MODE_OPTIONS = TRAVEL_MODES.map((m) => ({ value: m, label: TRAVEL_MODE_LABELS[m] }));

const form = reactive({ mode: "air" as TravelMode, departAt: "", arriveAt: "", confirmationRef: "" });
const changing = ref(false);
const showForm = computed(() => canBook.value && !props.blocked && (!live.value || changing.value));
const ready = computed(() => Boolean(form.departAt) && Boolean(form.arriveAt));

const at = (instant: string) => formatDisplayDateTime(instant, undefined, zone.value ?? undefined);

async function save(): Promise<void> {
  try {
    await book.mutateAsync({
      driverId: props.driverId,
      booking: {
        mode: form.mode,
        depart_at: form.departAt,
        arrive_at: form.arriveAt,
        confirmation_ref: form.confirmationRef.trim() || null,
      },
    });
    toast.success("Trip recorded", live.value ? "It replaces the earlier booking." : undefined);
    Object.assign(form, { mode: "air", departAt: "", arriveAt: "", confirmationRef: "" });
    changing.value = false;
  } catch (e) {
    toast.error("Could not record the trip", e instanceof Error ? e.message : undefined);
  }
}

async function cancelLive(): Promise<void> {
  if (!live.value) return;
  try {
    await cancel.mutateAsync({ driverId: props.driverId, travelId: live.value.id });
    toast.success("Trip cancelled");
  } catch (e) {
    toast.error("Could not cancel the trip", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <p class="text-sm font-medium text-ink">Booked</p>
      <p v-if="travelQ.isLoading.value" class="mt-1 text-xs text-ink-muted">Loading…</p>
      <p v-else-if="travelQ.error.value" class="mt-1 text-xs text-danger-700">The trips could not be loaded.</p>
      <p v-else-if="!live" class="mt-1 text-xs text-ink-muted">No trip booked.</p>
      <div v-else class="mt-2 space-y-1">
        <p class="text-xs">
          <span class="font-medium text-ink">{{ TRAVEL_MODE_LABELS[live.mode] }}</span>
          <span class="text-ink-secondary"> · leaves {{ at(live.departAt) }} · arrives {{ at(live.arriveAt) }}</span>
        </p>
        <p v-if="live.confirmationRef" class="text-2xs text-ink-secondary">
          Confirmation <span class="font-mono">{{ live.confirmationRef }}</span>
        </p>
        <div v-if="canBook && !changing" class="flex gap-2 pt-2">
          <BaseButton size="sm" @click="changing = true">Change the trip</BaseButton>
          <BaseButton size="sm" variant="ghost" :disabled="cancel.isPending.value" @click="cancelLive">
            Cancel it
          </BaseButton>
        </div>
      </div>
    </div>

    <p v-if="blocked" class="text-xs text-ink-secondary">
      Travel is booked once everything before the office day is done. The line above names what is
      still open.
    </p>

    <div v-if="showForm" class="space-y-4">
      <p class="text-xs text-ink-secondary">Times are {{ zoneName }}, as the office reads them.</p>
      <FormField v-slot="{ id }" label="How they travel">
        <AppSelect :id="id" v-model="form.mode" :options="MODE_OPTIONS" />
      </FormField>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="Leaves">
          <AppDateTimeField :id="id" v-model="form.departAt" />
        </FormField>
        <FormField v-slot="{ id }" label="Arrives">
          <AppDateTimeField :id="id" v-model="form.arriveAt" />
        </FormField>
      </div>
      <FormField v-slot="{ id }" label="Confirmation" hint="The booking reference, if there is one. Optional.">
        <BaseInput :id="id" v-model="form.confirmationRef" placeholder="Optional" />
      </FormField>
      <div class="flex gap-2">
        <BaseButton size="sm" variant="primary" :disabled="!ready || book.isPending.value" @click="save">
          {{ live ? "Replace the trip" : "Record the trip" }}
        </BaseButton>
        <BaseButton v-if="changing" size="sm" variant="ghost" @click="changing = false">Keep the current one</BaseButton>
      </div>
    </div>

    <div v-if="cancelled.length">
      <p class="text-sm font-medium text-ink">Earlier bookings</p>
      <ul class="mt-2 space-y-1">
        <li v-for="t in cancelled" :key="t.id" class="text-2xs text-ink-secondary">
          {{ TRAVEL_MODE_LABELS[t.mode] }} · leaves {{ at(t.departAt) }} · cancelled {{ at(t.cancelledAt!) }}
        </li>
      </ul>
    </div>
  </div>
</template>
