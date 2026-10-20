<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import {
  AppButton as BaseButton,
  AppDateField,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppRadioGroup,
  AppSelect,
  AppTextarea as BaseTextarea,
} from "@silvicom/ui";
import { COURT_OUTCOME_CODES, COURT_OUTCOME_EFFECT, COURT_OUTCOME_TEXT, type CourtOutcomeCode, type RoadsideCitationDto } from "@silvicom/shared";
import { formatDateTime } from "@/lib/format";
import { RepairDecisionError, useRecordDisposition } from "./useRoadsideInspections";

/**
 * What the court decided on ONE ticket, read by a person from a court paper filed on the inspection (IC4 second
 * merge, R-ADJ2/R-ADJ3; 0495). The paper is the inspection's and may hold several tickets, so the person says which
 * paper and what it says about this one; each outcome says what it does to CSA before it is saved, as "Not
 * contested" does. Recording again over an earlier read is a correction — a new record, the earlier kept.
 */

const props = defineProps<{
  inspectionId: string;
  ticket: RoadsideCitationDto;
  papers: readonly { id: string; filedAt: string }[];
  inspectionDate: string | null;
  today: string;
}>();
const emit = defineEmits<{ done: [] }>();

const record = useRecordDisposition(toRef(props, "inspectionId"));
const prior = props.ticket.disposition;
// The paper the earlier read named, else the newest: most inspections hold one.
const documentId = ref<string>(prior?.documentId ?? props.papers.at(-1)?.id ?? "");
const outcome = ref<CourtOutcomeCode | undefined>(prior?.outcomeCode);
const amendedCharge = ref(prior?.amendedCharge ?? "");
const courtName = ref(prior?.courtName ?? "");
const decidedOn = ref(prior?.decidedOn ?? "");
const note = ref("");

const paperOptions = computed(() => props.papers.map((p, i) => ({ value: p.id, label: `Court result ${i + 1}, filed ${formatDateTime(p.filedAt)}` })));
const outcomeOptions = COURT_OUTCOME_CODES.map((c) => ({ value: c, label: COURT_OUTCOME_TEXT[c], description: `Once FMCSA has it, ${COURT_OUTCOME_EFFECT[c]}.` }));
const ready = computed(() => !!documentId.value && !!outcome.value && !!courtName.value.trim() && !!decidedOn.value && (outcome.value !== 2 || !!amendedCharge.value.trim()));

function save() {
  record.mutate(
    {
      violationId: props.ticket.violationId,
      basedOn: prior?.id ?? null,
      documentId: documentId.value,
      outcomeCode: outcome.value!,
      amendedCharge: outcome.value === 2 ? amendedCharge.value.trim() : undefined,
      courtName: courtName.value.trim(),
      decidedOn: decidedOn.value,
      note: note.value.trim() || undefined,
    },
    { onSuccess: () => emit("done") },
  );
}
const failure = computed(() => {
  const e = record.error.value;
  if (!e) return null;
  return e instanceof RepairDecisionError && e.code === "changed" ? "Someone else recorded the court's result for this ticket. It is shown again above." : e.message;
});
</script>

<template>
  <form class="space-y-3 rounded-detail border border-edge p-3" data-test="disposition-form" @submit.prevent="save">
    <p class="text-ink">Read the court's paper and record what it decided on ticket {{ ticket.citationNumber }}. A paper may answer more than one ticket; each is recorded on its own.</p>
    <FormField v-slot="{ id: fieldId }" label="Court paper" required>
      <AppSelect :id="fieldId" v-model="documentId" :options="paperOptions" data-test="disposition-paper" />
    </FormField>
    <AppRadioGroup v-model="outcome" :options="outcomeOptions" legend="What the court decided" data-test="disposition-outcome" />
    <FormField v-if="outcome === 2" v-slot="{ id: fieldId }" label="The charge the driver was convicted of" required>
      <BaseInput :id="fieldId" v-model="amendedCharge" maxlength="200" data-test="disposition-charge" />
    </FormField>
    <div class="grid gap-3 sm:grid-cols-2">
      <FormField v-slot="{ id: fieldId }" label="Court" required>
        <BaseInput :id="fieldId" v-model="courtName" maxlength="200" placeholder="For example: Will County Circuit Court" data-test="disposition-court" />
      </FormField>
      <FormField v-slot="{ id: fieldId }" label="Decided on" required>
        <AppDateField :id="fieldId" v-model="decidedOn" :min-date="inspectionDate" :max-date="today" data-test="disposition-day" />
      </FormField>
    </div>
    <FormField v-slot="{ id: fieldId }" label="Note">
      <BaseTextarea :id="fieldId" v-model="note" maxlength="1000" placeholder="For example: case 26TR1234." />
    </FormField>
    <p v-if="failure" class="text-sm text-danger-700" role="alert" data-test="disposition-error">{{ failure }}</p>
    <div class="flex gap-2">
      <BaseButton variant="primary" type="submit" :disabled="record.isPending.value || !ready" data-test="disposition-save">Save</BaseButton>
      <BaseButton @click="emit('done')">Cancel</BaseButton>
    </div>
  </form>
</template>
