<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  HOME_TIME_DISPOSITION_LABELS,
  homeTimeReturnRefusal,
  homeTimeStartRefusal,
  type HomeTimeChange,
  type HomeTimeDisposition,
  type HomeTimeMark,
  type HomeTimePeriod,
  type HomeTimeSettings,
} from "@silvicom/shared";
import { AppCallout, AppDateTimeField, AppFormField as FormField, AppRadioGroup } from "@silvicom/ui";
import { fromWallTime, toWallTime } from "./homeTimeView";

/**
 * The home-time form (HOME-TIME-PLAN §3.3): when the driver leaves, when he is due back, and where the
 * truck is. One form for marking a new period and for changing a live one; the drawer owns the buttons
 * (D-US5b), so Save stays on screen however the drawer scrolls.
 *
 * ── THE CLOCK IS THE CARRIER'S ──────────────────────────────────────────────────────────────────
 * The date-time field speaks a wall time with no zone. It is read and written on the carrier's clock
 * (`zone`), so a return typed as 08:00 is 08:00 at the office whoever types it and wherever.
 *
 * ── WHAT IT CHECKS, AND WITH WHAT ───────────────────────────────────────────────────────────────
 * The same two rules the API applies (`homeTimeStartRefusal`, `homeTimeReturnRefusal`), so the form
 * says "that return time has passed" without a round trip and cannot disagree with the server about
 * it. On a change, only a time that MOVED is judged: an overdue period keeps its passed return while
 * somebody sends the truck back to the yard.
 *
 * No note field (D-HT20): the drawer links to the driver's notes instead.
 */
const props = defineProps<{
  /** The live period being changed; absent when marking a new one. */
  period?: HomeTimePeriod | null;
  driverId: string;
  /** The truck the roster pairs this driver to, for a new period; null when he has none. */
  vehicleId: string | null;
  unitNumber: string | null;
  /** This driver's answer last time, pre-selected on a new period (plan §3.3). */
  lastDisposition?: HomeTimeDisposition | null;
  /** When the truck empties, if it is carrying a load: the start a dispatcher planning ahead means. */
  leavesHint?: string | null;
  settings: HomeTimeSettings;
  zone: string;
}>();
const emit = defineEmits<{ mark: [input: HomeTimeMark]; change: [input: HomeTimeChange] }>();

const now = new Date();
const hasTruck = computed(() => (props.period ? props.period.disposition !== "no_truck" : props.vehicleId !== null));

/**
 * Returns starts EMPTY on a new period. The plan's "08:00 prefilled" needs a default time on the shared
 * date-time picker, which has none, and a prefilled date would be a guess a dispatcher could save
 * without noticing — a wrong promise is worse than one more click.
 */
const form = reactive({
  leaves: props.period ? toWallTime(props.period.startAt, props.zone) : toWallTime(props.leavesHint ?? now.toISOString(), props.zone),
  returns: props.period ? toWallTime(props.period.expectedReturnAt, props.zone) : "",
  truck: (props.period
    ? props.period.disposition
    : hasTruck.value
      ? (props.lastDisposition && props.lastDisposition !== "no_truck" ? props.lastDisposition : "")
      : "no_truck") as HomeTimeDisposition | "",
});
const errors = ref<{ leaves?: string; returns?: string; truck?: string }>({});

const TRUCK_OPTIONS = (["with_driver", "at_yard"] as const).map((value) => ({ value, label: HOME_TIME_DISPOSITION_LABELS[value] }));

/** Days the truck would be at the driver's home, when that is past the carrier's limit; else null. */
const overLimitDays = computed<number | null>(() => {
  if (form.truck !== "with_driver") return null;
  const start = fromWallTime(form.leaves, props.zone);
  const back = fromWallTime(form.returns, props.zone);
  if (!start || !back) return null;
  const days = (Date.parse(back) - Date.parse(start)) / 86_400_000;
  return days > props.settings.truckLimitDays ? Math.floor(days) : null;
});

function onSubmit(): void {
  const startAt = fromWallTime(form.leaves, props.zone);
  const expectedReturnAt = fromWallTime(form.returns, props.zone);
  const found: typeof errors.value = {};
  if (!startAt) found.leaves = "Enter when the driver leaves";
  if (!expectedReturnAt) found.returns = "Enter when the driver is due back";
  if (hasTruck.value && form.truck === "") found.truck = "Say where the truck is";
  if (startAt && expectedReturnAt) {
    const at = new Date();
    const startMoved = !props.period || Date.parse(startAt) !== Date.parse(props.period.startAt);
    const returnMoved = !props.period || Date.parse(expectedReturnAt) !== Date.parse(props.period.expectedReturnAt);
    if (Date.parse(expectedReturnAt) <= Date.parse(startAt)) found.returns = "The return must be after the start";
    else {
      const start = startMoved ? homeTimeStartRefusal(startAt, at) : null;
      const back = returnMoved ? homeTimeReturnRefusal(expectedReturnAt, at) : null;
      if (start) found.leaves = start;
      if (back) found.returns = back;
    }
  }
  errors.value = found;
  if (Object.keys(found).length > 0 || !startAt || !expectedReturnAt) return;

  if (!props.period) {
    const disposition = (hasTruck.value ? form.truck : "no_truck") as HomeTimeDisposition;
    emit("mark", { driverId: props.driverId, startAt, expectedReturnAt, disposition, vehicleId: hasTruck.value ? props.vehicleId : null });
    return;
  }
  // Only what moved is sent: the API changes exactly what it is given and audits exactly that.
  const change: HomeTimeChange = {};
  if (Date.parse(startAt) !== Date.parse(props.period.startAt)) change.startAt = startAt;
  if (Date.parse(expectedReturnAt) !== Date.parse(props.period.expectedReturnAt)) change.expectedReturnAt = expectedReturnAt;
  if (hasTruck.value && form.truck !== "" && form.truck !== "no_truck" && form.truck !== props.period.disposition) change.disposition = form.truck;
  emit("change", change);
}

</script>

<template>
  <form id="home-time-form" class="space-y-4" data-testid="home-time-form" @submit.prevent="onSubmit">
    <FormField v-slot="{ id }" label="Leaves" :error="errors.leaves">
      <AppDateTimeField :id="id" v-model="form.leaves" :invalid="!!errors.leaves" />
    </FormField>
    <FormField v-slot="{ id }" label="Returns" :error="errors.returns" hint="When the driver is due back and can take a load.">
      <AppDateTimeField :id="id" v-model="form.returns" :invalid="!!errors.returns" />
    </FormField>
    <div v-if="hasTruck" class="space-y-1">
      <AppRadioGroup
        v-model="form.truck"
        :legend="unitNumber ? `Truck ${unitNumber}` : 'The truck'"
        :options="TRUCK_OPTIONS"
      />
      <p v-if="errors.truck" class="text-xs text-danger-700" role="alert">{{ errors.truck }}</p>
    </div>
    <!-- Said before Save, and it does not stop the save: the office may have agreed to it. -->
    <AppCallout v-if="overLimitDays !== null" tone="warning" data-testid="home-time-over-limit">
      The truck would be at the driver's home for {{ overLimitDays }} days. The limit is
      {{ settings.truckLimitDays }} days, so the "Truck at home too long" alert will go out.
    </AppCallout>
  </form>
</template>
