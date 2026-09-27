<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { formatDisplayDateTime, type DrugTestAppointment } from "@silvicom/shared";
import { AppButton as BaseButton, AppInput as BaseInput, AppDateTimeField, AppFormField as FormField } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import {
  useArrangeDrugTest,
  useCancelDrugTest,
  useDrugTestAppointmentsQuery,
} from "@/features/recruitment/useApplicantScreening";

/**
 * Where and when the applicant goes for the drug test — D-AW6 (APPLICATION-FLOW-V2-PLAN §6.3, C2b3).
 *
 * ── AN ARRANGEMENT, NOT THE RESULT ────────────────────────────────────────────────────────────
 * The office books the collection with its TPA and writes the site and window down here. It never
 * ticks the row: the result, recorded above, is the §382.301 fact. So this sits under the result's
 * form, and disappears once the result is in — nothing is left to arrange.
 *
 * ⚠ Not sent to the driver from here yet. That text goes through the SMS outbox (C2d); until then the
 * office tells the driver, and the panel says so rather than offering a send that would drop the text
 * in quiet hours (A-11).
 *
 * Times are the CARRIER's clock (`carrierWallTimeSchema`), as `TravelPanel` reads them.
 */
const props = defineProps<{ driverId: string; done: boolean }>();

const session = useSessionStore();
const toast = useToastStore();
const driverId = computed(() => props.driverId);
const listQ = useDrugTestAppointmentsQuery(driverId);
const arrange = useArrangeDrugTest();
const cancel = useCancelDrugTest();

const canArrange = computed(() => session.can("recruitment"));
const zone = computed(() => listQ.data.value?.timeZone ?? null);
const zoneName = computed(() => {
  if (!zone.value) return "the carrier's time";
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone.value, timeZoneName: "long" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? zone.value;
});

const all = computed<DrugTestAppointment[]>(() => listQ.data.value?.appointments ?? []);
const live = computed(() => all.value.find((a) => a.cancelledAt === null) ?? null);
const earlier = computed(() => all.value.filter((a) => a.cancelledAt !== null));

const blank = () => ({ siteName: "", siteAddress: "", sitePhone: "", windowStart: "", windowEnd: "", donorReference: "" });
const form = reactive(blank());
const changing = ref(false);
const showForm = computed(() => canArrange.value && !props.done && (!live.value || changing.value));
const ready = computed(() => Boolean(form.siteName.trim() && form.siteAddress.trim() && form.windowStart));

const at = (instant: string) => formatDisplayDateTime(instant, undefined, zone.value ?? undefined);

async function save(): Promise<void> {
  try {
    await arrange.mutateAsync({
      driverId: props.driverId,
      booking: {
        site_name: form.siteName.trim(),
        site_address: form.siteAddress.trim(),
        site_phone: form.sitePhone.trim() || null,
        window_start: form.windowStart,
        window_end: form.windowEnd || null,
        donor_reference: form.donorReference.trim() || null,
      },
    });
    toast.success("Appointment recorded", live.value ? "It replaces the earlier one." : undefined);
    Object.assign(form, blank());
    changing.value = false;
  } catch (e) {
    toast.error("Could not record the appointment", e instanceof Error ? e.message : undefined);
  }
}

async function cancelLive(): Promise<void> {
  if (!live.value) return;
  try {
    await cancel.mutateAsync({ driverId: props.driverId, appointmentId: live.value.id });
    toast.success("Appointment cancelled");
  } catch (e) {
    toast.error("Could not cancel the appointment", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div v-if="!done || live" class="space-y-6 border-t border-edge pt-6">
    <div>
      <p class="text-sm font-medium text-ink">Appointment</p>
      <p v-if="listQ.isLoading.value" class="mt-1 text-xs text-ink-muted">Loading…</p>
      <p v-else-if="listQ.error.value" class="mt-1 text-xs text-danger-700">The appointments could not be loaded.</p>
      <p v-else-if="!live" class="mt-1 text-xs text-ink-muted">None arranged.</p>
      <div v-else class="mt-2 space-y-1">
        <p class="text-xs">
          <span class="font-medium text-ink">{{ live.siteName }}</span>
          <span class="text-ink-secondary"> · {{ live.siteAddress }}</span>
          <span v-if="live.sitePhone" class="text-ink-secondary"> · {{ live.sitePhone }}</span>
        </p>
        <p class="text-2xs text-ink-secondary">
          From {{ at(live.windowStart) }}<template v-if="live.windowEnd"> to {{ at(live.windowEnd) }}</template>
          <template v-if="live.donorReference"> · reference <span class="font-mono">{{ live.donorReference }}</span></template>
        </p>
        <p class="text-2xs text-ink-muted">Tell the driver where and when; sending it from here comes with text messages.</p>
        <div v-if="canArrange && !changing && !done" class="flex gap-2 pt-2">
          <BaseButton size="sm" @click="changing = true">Change it</BaseButton>
          <BaseButton size="sm" variant="ghost" :disabled="cancel.isPending.value" @click="cancelLive">Cancel it</BaseButton>
        </div>
      </div>
    </div>

    <div v-if="showForm" class="space-y-4">
      <p class="text-xs text-ink-secondary">Times are {{ zoneName }}, as the office reads them.</p>
      <FormField v-slot="{ id }" label="Collection site">
        <BaseInput :id="id" v-model="form.siteName" />
      </FormField>
      <FormField v-slot="{ id }" label="Address">
        <BaseInput :id="id" v-model="form.siteAddress" />
      </FormField>
      <FormField v-slot="{ id }" label="Site phone" hint="Optional.">
        <BaseInput :id="id" v-model="form.sitePhone" placeholder="Optional" />
      </FormField>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="From">
          <AppDateTimeField :id="id" v-model="form.windowStart" />
        </FormField>
        <FormField v-slot="{ id }" label="Until" hint="Optional.">
          <AppDateTimeField :id="id" v-model="form.windowEnd" />
        </FormField>
      </div>
      <FormField v-slot="{ id }" label="Donor or registration number" hint="What the site asks the driver for. Optional.">
        <BaseInput :id="id" v-model="form.donorReference" placeholder="Optional" />
      </FormField>
      <div class="flex gap-2">
        <BaseButton size="sm" variant="primary" :disabled="!ready || arrange.isPending.value" @click="save">
          {{ live ? "Replace the appointment" : "Record the appointment" }}
        </BaseButton>
        <BaseButton v-if="changing" size="sm" variant="ghost" @click="changing = false">Keep the current one</BaseButton>
      </div>
    </div>

    <div v-if="earlier.length">
      <p class="text-sm font-medium text-ink">Earlier appointments</p>
      <ul class="mt-2 space-y-1">
        <li v-for="a in earlier" :key="a.id" class="text-2xs text-ink-secondary">
          {{ a.siteName }} · {{ at(a.windowStart) }} · cancelled {{ at(a.cancelledAt!) }}
        </li>
      </ul>
    </div>
  </div>
</template>
