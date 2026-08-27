<script setup lang="ts">
import { computed, ref } from "vue";
import {
  AppButton as BaseButton,
  AppCallout,
  AppCard as BaseCard,
  AppCheckbox,
  AppDateField,
  AppFormField as FormField,
  AppSelect,
  AppTextarea,
} from "@silvicom/ui";
import {
  APPLICANT_DISPOSITIONS,
  APPLICANT_DISPOSITION_LABELS,
  currentDisposition,
  isCarrierDecision,
  rolesThatManage,
  type ApplicantDispositionOutcome,
} from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useDispositionsQuery, useRecordDisposition } from "@/features/recruitment/useDispositions";

/**
 * Why an application ended without a hire (0238).
 *
 * ── WHY IT SITS UNDER "APPLICATION" AND NOT "EMPLOYMENT" ──────────────────────────────────────
 * The Application tab is the recruiter's act of ASKING — `ApplicationInviteCard` mints the link that
 * starts one. This is the act that ends it. U6's cut was by who does the work, and the same person
 * does both of these; Employment holds the §391.21(b)(10) history and the §391.23 investigation of
 * it, which is a different job.
 *
 * ── WHY THERE IS NO "HIRED" OPTION HERE ───────────────────────────────────────────────────────
 * Hiring is `HireDrawer`'s act and `drivers.status` already records it. Offering it as an outcome
 * would give the product two ways to hire somebody, one of which files no evidence and starts no
 * qualification file. The three options are the ways an application ends WITHOUT a hire.
 *
 * ⚠ **No edit affordance, deliberately.** 0238 refuses UPDATE of the content (AD010). A carrier that
 * declines somebody and changes its mind records a SECOND decision; the history is the point,
 * because "we said no on the 3rd and yes on the 9th" is a true account and one mutable row erases
 * half of it.
 */
const props = defineProps<{ driverId: string; driverStatus: string }>();

const session = useSessionStore();
const toast = useToastStore();
const dispositionsQ = useDispositionsQuery(computed(() => props.driverId));
const record = useRecordDisposition();

/** Recruitment manage — the same population that can send the invitation this decision ends. */
const canDecide = computed(() => {
  const role = session.role;
  return Boolean(role) && rolesThatManage("recruitment").includes(role!);
});

/**
 * ⚠ Hidden for a driver who is not an applicant, matching the endpoint's own refusal. Ending an
 * employment is a termination — its own date, its own retention clock — and it is not this control.
 */
const applies = computed(() => props.driverStatus === "applicant");

const current = computed(() => currentDisposition(dispositionsQ.data.value ?? []));

const OUTCOMES = APPLICANT_DISPOSITIONS.map((value) => ({
  value,
  label: APPLICANT_DISPOSITION_LABELS[value],
}));

const open = ref(false);
const outcome = ref<ApplicantDispositionOutcome>("declined");
const decidedOn = ref("");
const reason = ref("");
const restedOnReport = ref(false);

function reset(): void {
  outcome.value = "declined";
  decidedOn.value = "";
  reason.value = "";
  restedOnReport.value = false;
}

const ready = computed(() => Boolean(decidedOn.value));

async function submit(): Promise<void> {
  try {
    await record.mutateAsync({
      driver_id: props.driverId,
      outcome: outcome.value,
      decided_on: decidedOn.value,
      reason: reason.value.trim() || null,
      rested_on_consumer_report: restedOnReport.value,
    });
    toast.success("Decision recorded", `${APPLICANT_DISPOSITION_LABELS[outcome.value]} on ${decidedOn.value}.`);
    open.value = false;
    reset();
  } catch (e) {
    toast.error("Could not record the decision", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <BaseCard v-if="applies">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h3 class="text-sm font-semibold text-ink">How this application ended</h3>
        <p class="mt-1 max-w-2xl text-sm text-ink-muted">
          If this person is not being hired, record why. Hiring them is the other button — this is
          for the applications that stop.
        </p>
      </div>
      <BaseButton v-if="canDecide" class="shrink-0" @click="open = true">Record a decision</BaseButton>
    </div>

    <p v-if="dispositionsQ.isLoading.value" class="mt-4 text-sm text-ink-muted">Loading…</p>
    <p v-else-if="!current" class="mt-4 text-sm text-ink-muted">
      Still open. Nothing has been decided about this application.
    </p>
    <ul v-else class="mt-4 space-y-2">
      <li
        v-for="(d, i) in dispositionsQ.data.value"
        :key="d.id"
        class="rounded-surface bg-surface-muted p-3"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <p class="text-sm font-medium text-ink">
            {{ APPLICANT_DISPOSITION_LABELS[d.outcome] }} on {{ d.decided_on }}
          </p>
          <!-- Newest first, so the top row is the answer that stands. A change of mind is a new row. -->
          <span v-if="i === 0" class="text-xs text-ink-muted">Current</span>
        </div>
        <p v-if="d.reason" class="mt-1 text-sm text-ink-secondary">{{ d.reason }}</p>
        <!-- ⚠ Shown because it is the fact somebody will need later, and it is only knowable now. -->
        <p v-if="d.rested_on_consumer_report" class="mt-1 text-xs text-ink-muted">
          A report the carrier paid for was part of this decision.
        </p>
      </li>
    </ul>

    <SlideOver :open="open" title="Record a decision" @close="open = false">
      <div class="space-y-5">
        <FormField v-slot="{ id }" label="What happened">
          <AppSelect :id="id" v-model="outcome" :options="OUTCOMES" />
        </FormField>

        <FormField v-slot="{ id }" label="Date of the decision">
          <AppDateField :id="id" v-model="decidedOn" />
        </FormField>

        <FormField
          v-slot="{ id }"
          label="Why"
          hint="Optional, and in your own words. Nobody outside recruitment reads this."
        >
          <AppTextarea :id="id" v-model="reason" :rows="3" />
        </FormField>

        <!--
          ⚠ Asked of the person deciding, not derived from the file. "Is there a bought report on
          this driver" and "did a bought report contribute to this decision" are different questions,
          and only the second one matters. Nothing acts on the answer yet; it is captured because it
          is knowable today and a guess tomorrow.
        -->
        <div v-if="isCarrierDecision(outcome)">
          <AppCheckbox v-model="restedOnReport">
            A report we paid for — a PSP record or a driving record — was part of why
          </AppCheckbox>
        </div>

        <AppCallout v-if="isCarrierDecision(outcome) && restedOnReport" tone="info">
          Recorded, and nothing is sent. Notifying an applicant when a bought report costs them the
          job is a separate piece of work that has not been built.
        </AppCallout>
      </div>

      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="secondary" @click="open = false">Cancel</BaseButton>
          <BaseButton variant="primary" :disabled="!ready || record.isPending.value" @click="submit">
            {{ record.isPending.value ? "Recording…" : "Record" }}
          </BaseButton>
        </div>
      </template>
    </SlideOver>
  </BaseCard>
</template>
