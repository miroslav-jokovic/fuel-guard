<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  VERIFICATION_OUTCOMES,
  VERIFICATION_OUTCOME_LABELS,
  VERIFICATION_QUESTIONS,
  VERIFICATION_QUESTION_LABELS,
  formatDisplayDateTime,
  type VerifiableEmployer,
  type VerificationOutcome,
  type VerificationQuestion,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppInput as BaseInput, AppDateTimeField, AppFormField as FormField, AppSelect } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useEmployerCallsQuery, useRecordEmployerCall } from "@/features/recruitment/useApplicantScreening";

/**
 * Previous employers verified by phone BEFORE the application is filed — D-AW8, AW12
 * (APPLICATION-FLOW-V2-PLAN §6.5, C2b3).
 *
 * ── WHY THIS SITS ABOVE THE INQUIRY LIST, AND STOPS AT FILING ─────────────────────────────────
 * The inquiry list below is §391.23's record, and each of its rows names an employment row that exists
 * only once the application is filed. The office rings employers weeks earlier. So a call is recorded
 * here against the applicant's own entry, and filing copies every call into that list — after which
 * this panel only shows what was copied, and a new call goes on the list itself.
 *
 * ⚠ The employers are the applicant's draft entries, read by the server; this panel never names one
 * itself. An entry typed before entries carried a stable reference has none, and is shown as such:
 * a call cannot be filed against it before filing.
 *
 * Times are the CARRIER's clock (`carrierWallTimeSchema`), as `TravelPanel` reads them.
 */
const props = defineProps<{ driverId: string }>();

const session = useSessionStore();
const toast = useToastStore();
const driverId = computed(() => props.driverId);
const listQ = useEmployerCallsQuery(driverId);
const record = useRecordEmployerCall();

const canRecord = computed(() => session.can("recruitment"));
const data = computed(() => listQ.data.value ?? null);
const zone = computed(() => data.value?.timeZone ?? undefined);
const at = (instant: string) => formatDisplayDateTime(instant, undefined, zone.value);

const callsFor = (key: string | null) => (data.value?.calls ?? []).filter((c) => key !== null && c.employerKey === key);

const OUTCOME_OPTIONS = VERIFICATION_OUTCOMES.map((o) => ({ value: o, label: VERIFICATION_OUTCOME_LABELS[o] }));

const blankOutcomes = (): Record<VerificationQuestion, VerificationOutcome> =>
  Object.fromEntries(VERIFICATION_QUESTIONS.map((q) => [q, "confirmed"])) as Record<VerificationQuestion, VerificationOutcome>;
const blankCorrections = (): Record<VerificationQuestion, string> =>
  Object.fromEntries(VERIFICATION_QUESTIONS.map((q) => [q, ""])) as Record<VerificationQuestion, string>;

const openKey = ref<string | null>(null);
const form = reactive({
  answeredBy: "",
  calledAt: "",
  outcomes: blankOutcomes(),
  corrections: blankCorrections(),
});

const ready = computed(() =>
  Boolean(form.answeredBy.trim() && form.calledAt)
  && VERIFICATION_QUESTIONS.every((q) => form.outcomes[q] !== "corrected" || form.corrections[q].trim() !== ""),
);

function start(e: VerifiableEmployer): void {
  openKey.value = e.key;
  Object.assign(form, { answeredBy: "", calledAt: "", outcomes: blankOutcomes(), corrections: blankCorrections() });
}

async function save(): Promise<void> {
  if (!openKey.value) return;
  const corrections = Object.fromEntries(
    VERIFICATION_QUESTIONS.filter((q) => form.outcomes[q] === "corrected").map((q) => [q, form.corrections[q].trim()]),
  );
  try {
    await record.mutateAsync({
      driverId: props.driverId,
      call: {
        employer_key: openKey.value,
        answered_by: form.answeredBy.trim(),
        called_at: form.calledAt,
        outcomes: { ...form.outcomes },
        corrections: Object.keys(corrections).length > 0 ? corrections : null,
      },
    });
    toast.success("Call recorded", "Filing the application copies it onto the inquiry list.");
    openKey.value = null;
  } catch (e) {
    toast.error("Could not record the call", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <p class="text-sm font-medium text-ink">Calls before filing</p>
      <p class="mt-1 text-xs text-ink-secondary">
        <template v-if="data?.filed">
          The application is filed, so these calls are on the inquiry list below. Record new contact there.
        </template>
        <template v-else>
          Ring a previous employer before the application is filed and record what they confirmed. Filing
          copies each call onto the inquiry list.
        </template>
      </p>
    </div>
    <p v-if="listQ.isLoading.value" class="text-xs text-ink-muted">Loading…</p>
    <p v-else-if="listQ.error.value" class="text-xs text-danger-700">The calls could not be loaded.</p>
    <p v-else-if="!data?.employers.length" class="text-xs text-ink-muted">The application names no employer yet.</p>

    <ul v-else class="space-y-4">
      <li v-for="(e, i) in data.employers" :key="e.key ?? `unkeyed-${i}`" class="space-y-2">
        <p class="text-xs">
          <span class="font-medium text-ink">{{ e.name }}</span>
          <span v-if="e.phone" class="text-ink-secondary"> · {{ e.phone }}</span>
        </p>
        <ul v-if="callsFor(e.key).length" class="space-y-1">
          <li v-for="c in callsFor(e.key)" :key="c.id" class="text-2xs text-ink-secondary">
            {{ at(c.calledAt) }} · {{ c.answeredBy }} ·
            {{ VERIFICATION_QUESTIONS.map((q) => `${VERIFICATION_QUESTION_LABELS[q]}: ${VERIFICATION_OUTCOME_LABELS[c.outcomes[q]]}`).join("; ") }}
            <template v-if="c.copiedInquiryId"> · on the inquiry list</template>
          </li>
        </ul>
        <p v-if="e.key === null" class="text-2xs text-ink-muted">
          Entered before employers carried a reference, so a call can't be recorded against it until filing puts it on the inquiry list.
        </p>
        <template v-else-if="canRecord && !data.filed">
          <BaseButton v-if="openKey !== e.key" size="sm" @click="start(e)">Record a call</BaseButton>
          <div v-else class="space-y-3 rounded-surface border border-edge p-3">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField v-slot="{ id }" label="Who answered">
                <BaseInput :id="id" v-model="form.answeredBy" placeholder="Name and role" />
              </FormField>
              <FormField v-slot="{ id }" label="Called at">
                <AppDateTimeField :id="id" v-model="form.calledAt" />
              </FormField>
            </div>
            <div v-for="q in VERIFICATION_QUESTIONS" :key="q" class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <FormField v-slot="{ id }" :label="VERIFICATION_QUESTION_LABELS[q]">
                <AppSelect :id="id" v-model="form.outcomes[q]" :options="OUTCOME_OPTIONS" />
              </FormField>
              <FormField v-if="form.outcomes[q] === 'corrected'" v-slot="{ id }" label="What they said instead">
                <BaseInput :id="id" v-model="form.corrections[q]" />
              </FormField>
            </div>
            <div class="flex gap-2">
              <BaseButton size="sm" variant="primary" :disabled="!ready || record.isPending.value" @click="save">Record the call</BaseButton>
              <BaseButton size="sm" variant="ghost" @click="openKey = null">Cancel</BaseButton>
            </div>
          </div>
        </template>
      </li>
    </ul>
  </div>
</template>
