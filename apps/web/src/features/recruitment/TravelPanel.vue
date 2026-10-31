<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  TRAVEL_MODES,
  TRAVEL_MODE_LABELS,
  formatDisplayDateTime,
  hiringStep,
  travelWarnings,
  type ApplicantTravel,
  type TravelMode,
} from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCallout,
  AppInput as BaseInput,
  AppDateTimeField,
  AppFormField as FormField,
  AppSelect,
  QueryState,
} from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useApplicantTravelQuery, useBookTravel, useCancelTravel } from "@/features/recruitment/useApplicantTravel";
import { useApplicantChecklistQuery } from "@/features/recruitment/useApplicantChecklist";

/**
 * The applicant's trip to the office — D-AW7 (APPLICATION-FLOW-V2-PLAN §7, C2b2).
 *
 * ── BOOKED WHENEVER THE OFFICE CHOOSES, WITH WHAT IS STILL OPEN SAID FIRST (§9 P4) ────────────
 * Until 2026-10-31 the API refused a booking while any step before travel was open (Q-HM5) and this
 * form was hidden. HIRING-WORKFLOW-AUDIT §2 (G2) measured that as preference, so the form is always
 * offered and a caution names what is still open — `travelWarnings`, the fold the API reads too.
 *
 * ── THE CARRIER'S CLOCK ───────────────────────────────────────────────────────────────────────
 * Times are typed as the itinerary shows them and read on the CARRIER's clock (`carrierWallTimeSchema`),
 * never the browser's, so the form names that zone; the list shows every time on the same clock.
 */
const props = defineProps<{ driverId: string }>();

const session = useSessionStore();
const toast = useToastStore();
const driverId = computed(() => props.driverId);
const travelQ = useApplicantTravelQuery(driverId);
const checklistQ = useApplicantChecklistQuery(driverId);
/** "PSP report, Drug test result" — the steps before travel still open, in the checklist's order. */
const stillOpen = computed(() =>
  checklistQ.data.value ? travelWarnings(checklistQ.data.value).map((k) => hiringStep(k).label) : [],
);
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
const showForm = computed(() => canBook.value && (!live.value || changing.value));
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
      <h3 class="text-sm font-semibold text-ink">Booked</h3>
      <div class="mt-1">
        <QueryState
          :loading="travelQ.isLoading.value"
          :error="travelQ.isError.value ? travelQ.error.value : null"
          :retrying="travelQ.isFetching.value"
          loading-text="Loading the trips…"
          error-text="Could not load the trips."
          compact
          @retry="travelQ.refetch()"
        >
          <p v-if="!live" class="text-xs text-ink-muted">No trip booked.</p>
          <div v-else class="mt-1 space-y-1">
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
        </QueryState>
      </div>
    </div>

    <AppCallout v-if="showForm && stillOpen.length" tone="caution" data-testid="travel-still-open">
      Still open: {{ stillOpen.join(", ") }}. You can book the trip anyway.
    </AppCallout>

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
      <h3 class="text-sm font-semibold text-ink">Earlier bookings</h3>
      <ul class="mt-2 space-y-1">
        <li v-for="t in cancelled" :key="t.id" class="text-2xs text-ink-secondary">
          {{ TRAVEL_MODE_LABELS[t.mode] }} · leaves {{ at(t.departAt) }} · cancelled {{ at(t.cancelledAt!) }}
        </li>
      </ul>
    </div>
  </div>
</template>
