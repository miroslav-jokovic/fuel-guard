<script setup lang="ts">
import { computed } from "vue";
import { MEDSTOP_CLOSE_LABEL, MEDSTOP_OUTCOME_LABELS, MEDSTOP_PORTAL_URL, canOrderDrugTests, formatDisplayWallTime, type MedstopCloseStatus } from "@silvicom/shared";
import { AppButton as BaseButton, QueryState } from "@silvicom/ui";
import { useDrugTestAppointmentsQuery, useMedstopTestsQuery } from "@/features/recruitment/useApplicantScreening";
import { BADGE_BASE, medstopOutcomeTone } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import { useSessionStore } from "@/stores/session";

/**
 * The drug-test step, as Med-Stop sees it (MEDSTOP-PLAN.md §6 F-4, MS2c): an order waiting for the
 * applicant, then the test moving collected → at the lab → with the MRO → reported, and the day the
 * result is due (p90 of the measured 93 hours, so a result later than that is worth a call).
 *
 * ⚠ The result shows only when the API sent one. For a recruiter it never does (§382.401(a),
 * `canReadTestingRecords`): they see "Result reported" and the step itself — a verified negative
 * files the record and the step ticks; anything else is the DER's to act on.
 *
 * UX4 (§7A.5): **Order pre-employment test**, for the order roles (D-MSUX1 — the recruiter included;
 * ordering is not reading), when Med-Stop holds this person on its APPLICANT roster. The card EMITS
 * the Med-Stop id and the page opens the order drawer: this card sits inside the step's SlideOver,
 * and a drawer inside a drawer is a focus trap inside a focus trap. When Med-Stop does not hold them,
 * the step says so and links to Med-Stop.
 *
 * UX5c (D-MS1): once Part 1 is complete, the hourly Med-Stop job creates the applicant there itself.
 * Until the next read shows them on Med-Stop's roster, the step says what that attempt came to — a
 * refusal in Med-Stop's own words, or "did not answer" — so the office knows whether to add them by hand.
 */
const props = defineProps<{ driverId: string }>();
const emit = defineEmits<{
  order: [order: { medstopId: string; zip: string | null }];
  // MSO2 (D-MSO3): the page opens the close drawer — this card sits inside the step's SlideOver.
  closeOrder: [request: { requestId: string; status: MedstopCloseStatus }];
  // MSO3 (D-MSO4): a negative-dilute result's recollection — the page opens the order drawer seeded with it.
  recollect: [test: { testId: string; medstopId: string; collectedOn: string | null; zip: string | null }];
}>();
const session = useSessionStore();
const canOrder = computed(() => canOrderDrugTests(session.role));
const q = useMedstopTestsQuery(computed(() => props.driverId));
const data = computed(() => q.data.value);

const reasonText = (reason: string | null) => (reason ? reason.toLowerCase() : "");
const createText = computed(() => {
  const c = data.value?.applicantCreate;
  if (!c || data.value?.matched) return null;
  if (c.outcome === "created") return "Added to Med-Stop from Part 1. It shows here after Med-Stop's next read, within the hour.";
  if (c.outcome === "unknown") return c.message ?? "Med-Stop did not answer when this applicant was sent. Check Med-Stop before adding them.";
  return `Med-Stop did not accept this applicant from Part 1: ${c.message ?? "no reason given"}. Add them in Med-Stop yourself.`;
});
// MSO1 (D-MSO2, gap G5): while Med-Stop holds an open DRUG order the step shows that order, not the
// Order button — Med-Stop refuses a second open order for the same test, so the office would fill the
// whole drawer only to be refused at Review. Its address, code and the text to the applicant are the
// appointment's, which the order filled (`DrugTestPanel`, just above this card).
const openDrug = computed(() => data.value?.orders.find((o) => o.kind === "drug") ?? null);
// The same query the appointment panel reads (one cache entry): an order placed by hand in Med-Stop's
// portal filled nothing, and the line under it must not say it did.
const appointments = useDrugTestAppointmentsQuery(computed(() => props.driverId));
const appointmentLive = computed(() => (appointments.data.value?.appointments ?? []).some((a) => a.cancelledAt === null));
const kindText = (kind: string) => (kind === "drug" ? "Drug test" : kind === "alcohol" ? "Alcohol test" : "Medical exam");
</script>

<template>
  <div v-if="q.isLoading.value || q.isError.value || data?.connected" class="space-y-2 border-t border-edge pt-6">
    <h3 class="text-sm font-semibold text-ink">Med-Stop</h3>
    <QueryState
      :loading="q.isLoading.value"
      :error="q.isError.value ? q.error.value : null"
      :retrying="q.isFetching.value"
      loading-text="Loading Med-Stop…"
      error-text="Could not load Med-Stop's tests."
      compact
      @retry="q.refetch()"
    >
      <template v-if="data">
        <p v-if="createText" class="text-xs text-ink-secondary">{{ createText }}</p>
        <p v-else-if="!data.matched" class="text-xs text-ink-muted">
          Med-Stop has no record matched to this applicant by licence or date of birth yet. It appears here once Med-Stop's roster and this file agree.
          <template v-if="canOrder">
            Add this applicant in Med-Stop first, then order the pre-employment test here.
            <a :href="MEDSTOP_PORTAL_URL" target="_blank" rel="noopener noreferrer" class="text-link hover:text-link-hover">Open Med-Stop</a>
          </template>
        </p>
        <p v-else-if="data.orders.length === 0 && data.tests.length === 0" class="text-xs text-ink-muted">
          No test ordered in Med-Stop yet.
        </p>
        <ul v-else class="space-y-2 text-xs">
          <li v-for="o in data.orders" :key="o.requestId" class="text-ink-secondary">
            <span class="font-medium text-ink">{{ kindText(o.kind) }}</span>
            <template v-if="o.reason"> · {{ reasonText(o.reason) }}</template>
            <template v-if="o.site"> · {{ o.site }}</template>
            <template v-if="o.goBy"> · go by {{ formatDisplayWallTime(o.goBy) }}</template>
            <template v-else-if="o.requestedOn"> · ordered {{ formatDate(o.requestedOn) }}</template>
            · not collected yet
          </li>
          <li v-for="t in data.tests" :key="t.testId" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-secondary">
            <span class="font-medium text-ink">{{ kindText(t.kind) }}</span>
            <span v-if="t.reason">{{ reasonText(t.reason) }}</span>
            <span v-if="t.collectedOn">collected {{ formatDate(t.collectedOn) }}</span>
            <span>· {{ t.stage }}</span>
            <span v-if="t.expectedOn">· result expected by {{ formatDate(t.expectedOn) }}</span>
            <span v-if="t.outcome && t.outcome !== 'pending'" :class="[BADGE_BASE, medstopOutcomeTone(t.outcome)]">{{ MEDSTOP_OUTCOME_LABELS[t.outcome] }}</span>
            <!-- MSO3: only a reader of results is SENT an outcome (personTests.ts), so only they see this. -->
            <BaseButton
              v-if="canOrder && t.outcome === 'negative_dilute' && t.kind === 'drug' && data.applicantMedstopId && !openDrug"
              size="sm"
              variant="link"
              @click="emit('recollect', { testId: t.testId, medstopId: data.applicantMedstopId, collectedOn: t.collectedOn, zip: data.homeZip })"
            >
              Order a recollection
            </BaseButton>
          </li>
        </ul>
        <p v-if="openDrug" class="text-2xs text-ink-muted">
          {{ appointmentLive
            ? "The appointment above holds where to go and the code. Text it to the applicant from there."
            : "Write where to go in the appointment above, then text it to the applicant." }}
        </p>
        <!-- MSO2 (D-MSO3): one order in three is cancelled, and Med-Stop refuses a second open order — so the
             step closes this one itself, reviewed, and then the Order button comes back. -->
        <div v-if="openDrug && canOrder" class="flex flex-wrap gap-2 pt-1">
          <BaseButton size="sm" @click="emit('closeOrder', { requestId: openDrug.requestId, status: 'NO SHOW' })">{{ MEDSTOP_CLOSE_LABEL["NO SHOW"] }}</BaseButton>
          <BaseButton size="sm" variant="ghost" @click="emit('closeOrder', { requestId: openDrug.requestId, status: 'CANCELED' })">{{ MEDSTOP_CLOSE_LABEL.CANCELED }}</BaseButton>
        </div>
        <BaseButton
          v-else-if="canOrder && data.applicantMedstopId"
          size="sm"
          class="mt-1"
          @click="emit('order', { medstopId: data.applicantMedstopId, zip: data.homeZip })"
        >
          Order pre-employment test
        </BaseButton>
      </template>
    </QueryState>
  </div>
</template>
