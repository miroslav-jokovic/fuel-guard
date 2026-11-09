<script setup lang="ts">
import { computed, reactive } from "vue";
import { AppFormField as FormField, AppSelect, AppTextarea } from "@silvicom/ui";
import {
  LEAD_CLOSE_REASONS,
  closeReasonUnavailable,
  leadCloseReasonLabel,
  statusAfterClose,
  type LeadCloseReason,
  type LeadEvidence,
} from "@silvicom/shared";

/**
 * Closing a lead with a reason (LQ5c over 0578; Q-AD64 ruled 2026-11-09: a fixed list, never free text in the
 * reason). The list and every label come from `leadClosureContract.ts`; nothing is restated here.
 *
 * A reason the lead's record cannot support yet is shown greyed with the database's own sentence
 * (`closeReasonUnavailable` — the same rule `close_lead` applies, RL055–RL057), so a recruiter learns what to log
 * first rather than pressing into a 409. The database still decides; this only saves the round trip.
 *
 * The reasons are shown in two groups, as the status they leave: "not qualified" (a requirement, which also
 * writes the rules' verdict) and "lost" (everything else). The note is optional and stays in the drawer.
 */
const props = defineProps<{ formId: string; evidence: LeadEvidence }>();
const emit = defineEmits<{ save: [input: { reason: LeadCloseReason; note: string | null }] }>();

const options = computed(() =>
  LEAD_CLOSE_REASONS.map((reason) => {
    const why = closeReasonUnavailable(reason, props.evidence);
    return {
      value: reason,
      label: `${statusAfterClose(reason) === "not_qualified" ? "Not qualified — " : ""}${leadCloseReasonLabel(reason)}${why ? " (not yet)" : ""}`,
      disabled: why !== null,
    };
  }),
);

const form = reactive({ reason: null as LeadCloseReason | null, note: "" });
const why = computed(() => (form.reason ? closeReasonUnavailable(form.reason, props.evidence) : null));
const hint = computed(() => {
  if (!form.reason) return "Pick the reason the call settled on. A requirement also records the rules' verdict.";
  return why.value ?? (statusAfterClose(form.reason) === "not_qualified"
    ? "Closes the lead as not qualified and records that the requirement was not met."
    : "Closes the lead as lost. It can be reopened.");
});
const save = () => {
  if (!form.reason || why.value) return;
  emit("save", { reason: form.reason, note: form.note.trim() || null });
};
defineExpose({ ready: computed(() => form.reason !== null && why.value === null) });
</script>

<template>
  <form :id="formId" class="space-y-4" data-test="close-form" @submit.prevent="save">
    <FormField v-slot="{ id }" label="Reason" :hint="hint" :error="why ?? undefined">
      <AppSelect :id="id" v-model="form.reason" :options="options" placeholder="Choose a reason" data-test="close-reason" />
    </FormField>
    <FormField v-slot="{ id }" label="Note (optional)" hint="Stays in this drawer. Never in the audit log or the alert.">
      <AppTextarea :id="id" v-model="form.note" :rows="3" :maxlength="2000" data-test="close-note" />
    </FormField>
  </form>
</template>
