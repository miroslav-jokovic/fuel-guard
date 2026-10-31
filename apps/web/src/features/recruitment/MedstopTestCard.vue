<script setup lang="ts">
import { computed } from "vue";
import { MEDSTOP_OUTCOME_LABELS, MEDSTOP_PORTAL_URL, canOrderDrugTests } from "@silvicom/shared";
import { AppButton as BaseButton, QueryState } from "@silvicom/ui";
import { useMedstopTestsQuery } from "@/features/recruitment/useApplicantScreening";
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
const emit = defineEmits<{ order: [medstopId: string] }>();
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
            · ordered{{ o.requestedOn ? ` ${formatDate(o.requestedOn)}` : "" }}, not collected yet
          </li>
          <li v-for="t in data.tests" :key="t.testId" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-secondary">
            <span class="font-medium text-ink">{{ kindText(t.kind) }}</span>
            <span v-if="t.reason">{{ reasonText(t.reason) }}</span>
            <span v-if="t.collectedOn">collected {{ formatDate(t.collectedOn) }}</span>
            <span>· {{ t.stage }}</span>
            <span v-if="t.expectedOn">· result expected by {{ formatDate(t.expectedOn) }}</span>
            <span v-if="t.outcome && t.outcome !== 'pending'" :class="[BADGE_BASE, medstopOutcomeTone(t.outcome)]">{{ MEDSTOP_OUTCOME_LABELS[t.outcome] }}</span>
          </li>
        </ul>
        <BaseButton v-if="canOrder && data.applicantMedstopId" size="sm" class="mt-1" @click="emit('order', data.applicantMedstopId)">
          Order pre-employment test
        </BaseButton>
      </template>
    </QueryState>
  </div>
</template>
