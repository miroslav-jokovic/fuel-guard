<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  DEFAULT_ORG_TIMEZONE,
  MEDSTOP_GO_BY_TIME,
  MEDSTOP_NOTIFY_BY,
  MEDSTOP_HEADER_ORDER_REASONS,
  MEDSTOP_NOTIFY_BY_LABEL,
  MEDSTOP_ORDER_MAX_DAYS_AHEAD,
  MEDSTOP_ORDER_REASON_LABEL,
  formatDisplayDate,
  formatDisplayWallTime,
  medstopDefaultGoBy,
  medstopOrderIsObserved,
  shiftDay,
  todayInZone,
  type MedstopNotifyBy,
  type MedstopOrderInput,
  type MedstopOrderPreview,
  type MedstopOrderReason,
  type MedstopOrderService,
  type MedstopSite,
} from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCallout,
  AppCombobox,
  AppDateField,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppRadioGroup,
  AppSegmentedControl,
  AppSelect,
  AppSwitch,
} from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { FactList, type Fact } from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import { searchSites, useOrderContext, useOrderPreview, usePlaceOrder } from "@/composables/useMedstopOrder";

/**
 * "Order a test" (MEDSTOP-PLAN.md §7A.4, UX3/UX4) — one drawer, three entry points: Safety's page
 * header (a working driver, any reason that header offers), a random selection (reason and test
 * fixed, the selection is the seed), and the hiring drawer's drug-test step (UX4: pre-employment, the
 * applicant fixed — Med-Stop's APPLICANT-roster id is the seed; the test may be drug or alcohol).
 * Lives outside `features/` because Safety and recruitment both open it.
 *
 * Every order is billed and real (there is no Med-Stop test host), so it is two steps on purpose:
 * **Review order** asks the api to build the exact payload and shows it; **Place order** sends the
 * same inputs, which the api rebuilds with the same function. Any change after the review clears it.
 * What the review must say, because the owner ruled it (answer 5): Med-Stop will not text or e-mail
 * the driver — its notices go to the office.
 *
 * MSO1 (§7A.21, D-MSO2): the day and time are a **"Go by"** deadline, not an appointment — the office's
 * own orders are collected a median 2.2 h before the time they name, which clusters at 4 pm. So it
 * defaults to the next business day at 4 pm on the CARRIER's clock (the api's `today` and zone, never
 * the laptop's), and the hiring step's site search starts at the applicant's Part 1 home ZIP.
 */
export type OrderSeed =
  | { kind: "selection"; selectionId: string; medstopId: string; name: string; service: MedstopOrderService }
  | { kind: "applicant"; medstopId: string; name: string; zip?: string | null; locationId?: string | null }
  // MSO3 (D-MSO4): a negative-dilute drug result's recollection — its own reason, its person; drug only.
  | { kind: "recollection"; testId: string; medstopId: string; name: string; reason: MedstopOrderReason; collectedOn: string | null; zip?: string | null };
const props = defineProps<{ open: boolean; seed: OrderSeed | null }>();
const emit = defineEmits<{ close: []; placed: [] }>();

const toast = useToastStore();
const context = useOrderContext(computed(() => props.open));
const preview = useOrderPreview();
const place = usePlaceOrder();

// The carrier's today once the api answers; until then the column's own default zone, only so the
// field is never empty — the "Go by" below is re-set from the api's answer as soon as it lands.
const today = computed(() => context.data.value?.today ?? todayInZone(new Date(), DEFAULT_ORG_TIMEZONE));
const medstopId = ref("");
const service = ref<MedstopOrderService>("drug");
const reason = ref<MedstopOrderReason>("POST-ACCIDENT");
const requestDate = ref<string | null>(medstopDefaultGoBy(today.value).requestDate);
const requestTime = ref(MEDSTOP_GO_BY_TIME);
const goByTouched = ref(false);
// MSO3 (D-MSO4): off by default; the office decides. Shown only on a recollection — observation outside
// §40.67's cases is not the employer's to choose, and the api refuses it anywhere else.
const observedChoice = ref(false);
// Declared before the seed's watch, which runs at once and may search (`find` reads it).
const recollection = computed(() => (props.seed?.kind === "recollection" ? props.seed : null));
const notifyBy = ref<MedstopNotifyBy>("PHONE CALL");
const zip = ref("");
const sites = ref<MedstopSite[]>([]);
const near = ref<string | null>(null);
const siteId = ref("");
const searching = ref(false);
const reviewed = ref<MedstopOrderPreview | null>(null);

watch(
  () => [props.open, props.seed] as const,
  ([open, seed]) => {
    if (!open) return;
    medstopId.value = seed?.medstopId ?? "";
    service.value = seed?.kind === "selection" ? seed.service : "drug";
    reason.value = seed?.kind === "selection" ? "RANDOM" : seed?.kind === "applicant" ? "PRE-EMPLOYMENT" : seed?.kind === "recollection" ? seed.reason : "POST-ACCIDENT";
    zip.value = seed?.kind === "applicant" || seed?.kind === "recollection" ? (seed.zip ?? "") : "";
    observedChoice.value = false;
    sites.value = [];
    siteId.value = "";
    near.value = null;
    reviewed.value = null;
    goByTouched.value = false;
    setGoBy();
    // MSO2 "Order again" (D-MSO3): filled from the closed order — its ZIP searched and its site picked when
    // Med-Stop still offers it. Only once ordering is known to be on; a refused search just leaves the list empty.
    if (seed?.kind === "applicant" && seed.locationId && /^\d{5}$/.test(zip.value)) void reorderFrom(seed.locationId);
  },
  { immediate: true },
);

async function reorderFrom(locationId: string): Promise<void> {
  await find("zip");
  if (sites.value.some((s) => s.id === locationId)) siteId.value = locationId;
}

function setGoBy(): void {
  const goBy = context.data.value?.goBy ?? medstopDefaultGoBy(today.value);
  requestDate.value = goBy.requestDate;
  requestTime.value = goBy.requestTime;
}
// The api's carrier-clock default arrives after the drawer opens; it wins until the office edits the field.
watch(() => context.data.value?.goBy, () => {
  if (props.open && !goByTouched.value) setGoBy();
});

const people = computed(() => context.data.value?.people ?? []);
const person = computed(() => people.value.find((p) => p.medstopId === medstopId.value) ?? null);
const off = computed(() => context.data.value !== undefined && (!context.data.value.enabled || !context.data.value.contactSet));
const reasonOptions = MEDSTOP_HEADER_ORDER_REASONS.map((r) => ({ value: r, label: MEDSTOP_ORDER_REASON_LABEL[r] }));
const applicant = computed(() => props.seed?.kind === "applicant" || recollection.value?.reason === "PRE-EMPLOYMENT");
const title = computed(() =>
  props.seed?.kind === "selection" ? `Random selection · ${props.seed.name}`
  : props.seed?.kind === "applicant" ? `Pre-employment · ${props.seed.name}`
  : props.seed?.kind === "recollection" ? `Recollection · ${props.seed.name}`
  : "Drug or alcohol test through Med-Stop",
);
const notifyOptions = MEDSTOP_NOTIFY_BY.map((n) => ({ value: n, label: MEDSTOP_NOTIFY_BY_LABEL[n] }));
const serviceOptions = [{ value: "drug", label: "Drug" }, { value: "alcohol", label: "Alcohol" }];
const siteOptions = computed(() =>
  sites.value.map((s) => ({
    value: s.id,
    label: s.name,
    description: [s.address, [s.city, s.state].filter(Boolean).join(", "), s.distance, s.booked ? `${s.booked} booked then` : null].filter(Boolean).join(" · "),
  })),
);

const input = computed((): MedstopOrderInput | null =>
  medstopId.value && siteId.value && requestDate.value && /^\d{2}:\d{2}$/.test(requestTime.value)
    ? {
        medstopId: medstopId.value,
        service: service.value,
        reason: reason.value,
        ...(props.seed?.kind === "selection" ? { selectionId: props.seed.selectionId } : {}),
        ...(recollection.value ? { recollectionOf: recollection.value.testId, observed: observedChoice.value } : {}),
        locationId: siteId.value,
        requestDate: requestDate.value,
        requestTime: requestTime.value,
        notifyBy: notifyBy.value,
      }
    : null,
);
// A review describes one exact order; change anything and it no longer does.
watch(input, () => (reviewed.value = null), { deep: true });
// The sites found were for one test, reason and person: an observed drug test only lists sites with an
// observer of the donor's gender (UX5d), so a search for anything else no longer applies.
const observed = computed(() => medstopOrderIsObserved({ reason: reason.value, service: service.value, observed: observedChoice.value }));
watch([service, reason, medstopId, observedChoice], () => {
  sites.value = [];
  siteId.value = "";
  near.value = null;
});

async function find(by: "zip" | "truck"): Promise<void> {
  if (!requestDate.value) return;
  searching.value = true;
  try {
    const base = {
      service: service.value, reason: reason.value, requestDate: requestDate.value, requestTime: requestTime.value,
      ...(medstopId.value ? { medstopId: medstopId.value } : {}),
      ...(recollection.value && observedChoice.value ? { observed: true } : {}),
    };
    const found = await searchSites(by === "zip" ? { ...base, zip: zip.value.trim() } : { ...base, driverId: person.value!.driverId });
    sites.value = found.sites;
    near.value = by === "truck" ? (found.near ?? "the truck's last position") : `ZIP ${zip.value.trim()}`;
    siteId.value = found.sites[0]?.id ?? "";
  } catch (e) {
    toast.error("Could not search for sites", e instanceof Error ? e.message : undefined);
  } finally {
    searching.value = false;
  }
}

async function review(): Promise<void> {
  if (!input.value) return;
  try {
    reviewed.value = await preview.mutateAsync(input.value);
  } catch (e) {
    toast.error("Cannot order this test", e instanceof Error ? e.message : undefined);
  }
}

async function confirm(): Promise<void> {
  if (!input.value || !reviewed.value) return;
  try {
    const placed = await place.mutateAsync(input.value);
    const name = reviewed.value.person.name;
    if (placed.appointment === "filled")
      toast.success("Test ordered", `Med-Stop request ${placed.requestId} for ${name}. The step's appointment now holds the site, the deadline and the code — text it to the applicant from there.`);
    else if (placed.appointment)
      toast.success("Test ordered", `Med-Stop request ${placed.requestId} for ${name}. Med-Stop's site details could not be copied into the appointment, so write it in the step before texting the applicant.`);
    else toast.success("Test ordered", `Med-Stop request ${placed.requestId} for ${name}. It is listed under In progress.`);
    emit("placed");
    emit("close");
  } catch (e) {
    toast.error("The order was not placed", e instanceof Error ? e.message : undefined);
  }
}

const site = computed(() => sites.value.find((s) => s.id === siteId.value) ?? null);
// What Med-Stop will receive, in the office's words — every line read off the api's own payload.
const reviewFacts = computed((): Fact[] => {
  const r = reviewed.value;
  if (!r) return [];
  const p = r.payload;
  return [
    { label: applicant.value ? "Applicant" : "Driver", value: r.person.name },
    // An observed order says so, and says nothing more: the donor's gender is Med-Stop's, never shown here (Q-MSUX10).
    { label: "Test", value: `${p.category === "TD" ? "Drug" : "Alcohol"} · ${MEDSTOP_ORDER_REASON_LABEL[p.reason]} · DOT, ${p.observed === "Y" ? "observed (same-gender observer)" : "unobserved"}` },
    ...(recollection.value
      ? [{ label: "Recollects", value: `The negative-dilute drug test${recollection.value.collectedOn ? ` collected ${formatDisplayDate(recollection.value.collectedOn)}` : ""}` }]
      : []),
    { label: "Go by", value: formatDisplayWallTime(`${p.requestdate}T${p.requesttime}`) },
    { label: "Where", value: site.value ? `${site.value.name}${site.value.city ? `, ${site.value.city}` : ""}` : p.locationid },
    { label: "Paid by", value: "Billed to the company's Med-Stop credit" },
    { label: "Notices", value: `Med-Stop will not text or e-mail the ${applicant.value ? "applicant" : "driver"}. Its notices go to ${p.toemail} and ${p.tosms}.` },
  ];
});
</script>

<template>
  <SlideOver :open="open" title="Order a test" :description="title" @close="emit('close')">
    <div class="space-y-5 text-sm">
      <AppCallout v-if="off" tone="caution">
        {{ context.data.value?.enabled ? "Add the office's e-mail and phone" : "Ordering is switched off" }} under Settings › Med-Stop integration before ordering. Every order is billed and real.
      </AppCallout>

      <FormField v-if="!seed" v-slot="{ id }" label="Driver" hint="Drivers on Med-Stop's roster, matched by licence or date of birth.">
        <AppCombobox :id="id" v-model="medstopId" :options="people.map((p) => ({ value: p.medstopId, label: p.name }))" placeholder="Search a name" :loading="context.isLoading.value" :disabled="off" />
      </FormField>

      <AppSegmentedControl v-model="service" :options="serviceOptions" label="Test" :disabled="seed?.kind === 'selection' || seed?.kind === 'recollection' || off" />

      <div v-if="recollection" class="flex items-start justify-between gap-4 rounded-surface border border-edge p-3">
        <div>
          <p class="font-medium text-ink">Observed collection</p>
          <p class="text-xs text-ink-muted">
            Off unless you choose it. On, a same-gender observer watches the collection — what 49 CFR 40.197(b)(1) requires when the MRO directs an observed recollection.
          </p>
        </div>
        <AppSwitch v-model="observedChoice" label="Observed collection" :disabled="off" />
      </div>

      <FormField v-if="!seed" v-slot="{ id }" label="Reason" hint="Return-to-duty and follow-up drug tests are observed by a same-gender observer (49 CFR 40.67), so pick the driver before searching for a site.">
        <AppSelect :id="id" v-model="reason" :options="reasonOptions" :disabled="off" />
      </FormField>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="Go by">
          <AppDateField
            :id="id"
            v-model="requestDate"
            :min-date="today"
            :max-date="shiftDay(today, MEDSTOP_ORDER_MAX_DAYS_AHEAD)"
            :disabled="off"
            @update:model-value="goByTouched = true"
          />
        </FormField>
        <FormField v-slot="{ id }" label="Time">
          <BaseInput :id="id" v-model="requestTime" type="time" :disabled="off" @update:model-value="goByTouched = true" />
        </FormField>
      </div>
      <p class="-mt-3 text-xs text-ink-muted">{{ applicant ? "The applicant" : "The driver" }} may go any time before this. Times are the carrier's clock.</p>

      <div class="space-y-2">
        <div class="flex items-end gap-2">
          <FormField v-slot="{ id }" label="Collection site near ZIP" class="flex-1">
            <BaseInput :id="id" v-model="zip" inputmode="numeric" maxlength="5" placeholder="60601" :disabled="off" />
          </FormField>
          <BaseButton :disabled="off || searching || !/^\d{5}$/.test(zip.trim()) || (observed && !medstopId)" @click="find('zip')">Search</BaseButton>
          <BaseButton v-if="!applicant" :disabled="off || searching || !person" @click="find('truck')">Near the truck</BaseButton>
        </div>
        <p v-if="near" class="text-xs text-ink-muted">{{ sites.length }} {{ sites.length === 1 ? "site" : "sites" }} near {{ near }}, Med-Stop's own first.</p>
        <AppRadioGroup v-if="sites.length" v-model="siteId" :options="siteOptions" legend="Collection site" />
      </div>

      <FormField v-slot="{ id }" :label="applicant ? 'How the applicant was told to go' : 'How the driver was told to go'">
        <AppSelect :id="id" v-model="notifyBy" :options="notifyOptions" :disabled="off" />
      </FormField>

      <section v-if="reviewed" class="space-y-2 rounded-surface bg-surface-muted p-4" aria-label="The order Med-Stop will receive">
        <h3 class="text-sm font-semibold text-ink">Check the order</h3>
        <FactList :facts="reviewFacts" layout="rows" />
      </section>
    </div>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton :disabled="place.isPending.value" @click="emit('close')">Cancel</BaseButton>
        <BaseButton v-if="!reviewed" variant="primary" :disabled="off || !input || preview.isPending.value" @click="review">
          {{ preview.isPending.value ? "Checking…" : "Review order" }}
        </BaseButton>
        <BaseButton v-else variant="primary" :disabled="place.isPending.value" @click="confirm">
          {{ place.isPending.value ? "Ordering…" : "Place order" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
