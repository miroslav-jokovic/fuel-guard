<script setup lang="ts">
import { computed } from "vue";
import { MEDSTOP_OUTCOME_LABELS } from "@silvicom/shared";
import QueryState from "@/components/ui/QueryState.vue";
import { useMedstopTestsQuery } from "@/features/recruitment/useApplicantScreening";
import { BADGE_BASE, medstopOutcomeTone } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * The drug-test step, as Med-Stop sees it (MEDSTOP-PLAN.md §6 F-4, MS2c): an order waiting for the
 * applicant, then the test moving collected → at the lab → with the MRO → reported, and the day the
 * result is due (p90 of the measured 93 hours, so a result later than that is worth a call).
 *
 * ⚠ The result shows only when the API sent one. For a recruiter it never does (§382.401(a),
 * `canReadTestingRecords`): they see "Result reported" and the step itself — a verified negative
 * files the record and the step ticks; anything else is the DER's to act on.
 */
const props = defineProps<{ driverId: string }>();
const q = useMedstopTestsQuery(computed(() => props.driverId));
const data = computed(() => q.data.value);

const reasonText = (reason: string | null) => (reason ? reason.toLowerCase() : "");
const kindText = (kind: string) => (kind === "drug" ? "Drug test" : kind === "alcohol" ? "Alcohol test" : "Medical exam");
</script>

<template>
  <div v-if="q.isLoading.value || q.isError.value || data?.connected" class="space-y-2 border-t border-edge pt-6">
    <p class="text-sm font-medium text-ink">Med-Stop</p>
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
        <p v-if="!data.matched" class="text-xs text-ink-muted">
          Med-Stop has no record matched to this applicant by licence or date of birth yet. It appears here once Med-Stop's roster and this file agree.
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
      </template>
    </QueryState>
  </div>
</template>
