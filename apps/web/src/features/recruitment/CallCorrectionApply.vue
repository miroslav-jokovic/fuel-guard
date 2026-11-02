<script setup lang="ts">
import { computed, reactive } from "vue";
import {
  VERIFICATION_QUESTION_LABELS,
  formatDisplayDate,
  suggestCorrection,
  type ApplyCallCorrection,
  type VerifiableEmployer,
  type VerificationQuestion,
} from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppDateField,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSegmentedControl,
} from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import { useApplyCallCorrection } from "@/features/recruitment/useApplicantScreening";

/**
 * One corrected answer from a call, and the button that writes it into the application (HW5d,
 * HIRING-WORKFLOW-AUDIT §4.5, EM-8: the corrections were "never applied; the recruiter re-types
 * them").
 *
 * ⚠ The employer's words are not written as they are. "02/2023–11/2024" is not a date, so the form
 * opens pre-filled with `suggestCorrection`'s first guess — or, where it cannot read the words, with
 * what the application says now — and the person applying confirms the value. The server decides
 * which fields the answer writes and logs it as an office edit (`applyCallCorrection.ts`).
 */
const props = defineProps<{
  driverId: string;
  callId: string;
  question: VerificationQuestion;
  said: string;
  employer: VerifiableEmployer;
  revision: number;
}>();

const toast = useToastStore();
const apply = useApplyCallCorrection();

const YES_NO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] as const;

/** What the application says now, in words — beside what the employer said. */
const current = computed((): string => {
  const e = props.employer;
  const yn = (v: boolean | null) => (v === null ? "Not answered" : v ? "Yes" : "No");
  switch (props.question) {
    case "dates":
      return `${e.startedOn ? formatDisplayDate(e.startedOn) : "No start"} – ${e.endedOn ? formatDisplayDate(e.endedOn) : "now"}`;
    case "position": return e.positionHeld ?? "Not answered";
    case "reason": return e.reasonForLeaving ?? "Not answered";
    case "cmv": return yn(e.operatedCmv);
    case "dot_tested": return yn(e.safetySensitive);
  }
  return "";
});

const open = reactive({ on: false });
const form = reactive({ started: "", ended: "", text: "", yn: "" });

function start(): void {
  const guess = suggestCorrection(props.question, props.said);
  const e = props.employer;
  if ("started_on" in guess) {
    form.started = guess.started_on ?? e.startedOn ?? "";
    form.ended = guess.ended_on ?? e.endedOn ?? "";
  } else if (typeof guess.value === "boolean") {
    form.yn = guess.value ? "yes" : "no";
  } else {
    form.text = guess.value ?? "";
    form.yn = "";
  }
  open.on = true;
}

const body = computed((): ApplyCallCorrection | null => {
  const revision = props.revision;
  switch (props.question) {
    case "dates":
      return form.started ? { question: "dates", started_on: form.started, ended_on: form.ended || null, revision } : null;
    case "position":
    case "reason":
      return form.text.trim() ? { question: props.question, value: form.text.trim(), revision } : null;
    case "cmv":
    case "dot_tested":
      return form.yn ? { question: props.question, value: form.yn === "yes", revision } : null;
  }
  return null;
});

async function save(): Promise<void> {
  if (!body.value) return;
  try {
    await apply.mutateAsync({ driverId: props.driverId, callId: props.callId, body: body.value });
    toast.success("Applied to the application", `${VERIFICATION_QUESTION_LABELS[props.question]} for ${props.employer.name}.`);
    open.on = false;
  } catch (e) {
    toast.error("Could not apply it", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-2 text-xs" data-call-correction>
    <p class="text-ink-secondary">
      <span class="font-medium text-ink">{{ VERIFICATION_QUESTION_LABELS[question] }}:</span>
      they said “{{ said }}”. The application says {{ current }}.
    </p>
    <BaseButton v-if="!open.on" size="sm" @click="start">Apply</BaseButton>
    <div v-else class="space-y-3 rounded-surface border border-edge p-3">
      <div v-if="question === 'dates'" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="Started">
          <AppDateField :id="id" v-model="form.started" />
        </FormField>
        <FormField v-slot="{ id }" label="Ended" hint="Leave empty if they still work there.">
          <AppDateField :id="id" v-model="form.ended" />
        </FormField>
      </div>
      <FormField v-else-if="question === 'position' || question === 'reason'" v-slot="{ id }" :label="VERIFICATION_QUESTION_LABELS[question]">
        <BaseInput :id="id" v-model="form.text" />
      </FormField>
      <AppSegmentedControl v-else v-model="form.yn" :options="YES_NO" :label="VERIFICATION_QUESTION_LABELS[question]" />
      <div class="flex gap-2">
        <BaseButton size="sm" variant="primary" :disabled="!body || apply.isPending.value" @click="save">
          Write it into the application
        </BaseButton>
        <BaseButton size="sm" variant="ghost" @click="open.on = false">Cancel</BaseButton>
      </div>
    </div>
  </div>
</template>
