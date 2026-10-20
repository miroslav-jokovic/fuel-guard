<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import {
  AppButton as BaseButton,
  AppCallout,
  AppCheckbox,
  AppDateField,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppTextarea as BaseTextarea,
  FactList,
  type Fact,
} from "@silvicom/ui";
import {
  DATAQS_ATTESTATION,
  DATAQS_URL,
  attributionAnswer,
  dataqsFields,
  dataqsNarrative,
  type CitationStanding,
  type DataqsFilingFacts,
  type RoadsideAttributionDto,
  type RoadsideCitationDto,
} from "@silvicom/shared";
import DocumentPreview from "@/components/DocumentPreview.vue";
import { formatDateTime } from "@/lib/format";
import { useApproveDataqs, useInspectionDocumentsQuery, useRecordDataqsFiled } from "./useRoadsideInspections";

/**
 * The DataQs request for a ticket the court decided in the driver's favour (IC4 second merge, R-ADJ2; plan §6's
 * case panel). DataQs has no API, so this prepares and hands over; it never sends.
 *
 *   file_ready     the drafted explanation (the person's to edit), the job aid's fields, who was driving, and
 *                  DataQs's 18 USC 1001 certification to accept before "Approve for filing".
 *   file_approved  the hand-off: open DataQs, the fields to enter, the explanation to copy, the court paper to
 *                  attach — then the RDR number DataQs gave it.
 *
 * Who was driving must be a decision (D-IC7): a person's, or the officer's report's. Samsara's reading alone sends
 * the person to the driver card, which is the one place a driver is confirmed.
 */

const props = defineProps<{
  inspectionId: string;
  ticket: RoadsideCitationDto;
  standing: Extract<CitationStanding, { kind: "file_ready" | "file_approved" }>;
  filing: DataqsFilingFacts;
  attribution: RoadsideAttributionDto;
  today: string;
}>();
const emit = defineEmits<{ confirmDriver: [] }>();
const id = toRef(props, "inspectionId");

const fields = computed(() => dataqsFields(props.filing, props.ticket, props.standing.disposition));
// The request type is step 1 of the hand-off, so the approved list starts after it.
const facts = computed((): Fact[] => fields.value.map((f) => ({ label: f.label, value: f.value })));
const driver = computed(() => (props.attribution.decision ? attributionAnswer(props.attribution) : null));

const narrative = ref("");
const attested = ref(false);
watch(
  () => props.standing.disposition.id,
  () => {
    narrative.value = dataqsNarrative(props.filing, props.ticket, props.standing.disposition);
    attested.value = false;
  },
  { immediate: true },
);
const approve = useApproveDataqs(id);
function approveIt() {
  approve.mutate({
    violationId: props.ticket.violationId,
    dispositionId: props.standing.disposition.id,
    attributionId: props.attribution.decision!.id,
    narrative: narrative.value.trim(),
    attested: true,
  });
}

const rdrNumber = ref("");
const filedOn = ref(props.today);
const filed = useRecordDataqsFiled(id);
function recordFiled() {
  if (props.standing.kind !== "file_approved") return;
  filed.mutate({ violationId: props.ticket.violationId, caseId: props.standing.dataqs.id, rdrNumber: rdrNumber.value.trim(), filedOn: filedOn.value });
}

const copied = ref(false);
async function copyNarrative() {
  if (props.standing.kind !== "file_approved") return;
  await navigator.clipboard.writeText(props.standing.dataqs.narrative);
  copied.value = true;
}

// The court paper, in the sanctioned viewer (which downloads it), from the Documents card's own read.
const { data: documents } = useInspectionDocumentsQuery(id);
const paper = computed(() => (documents.value ?? []).find((d) => d.id === props.standing.disposition.documentId) ?? null);
const viewing = ref(false);

// The API's refusals already say what moved and to reload; the record is read again either way.
const failure = computed(() => (approve.error.value ?? filed.error.value)?.message ?? null);
</script>

<template>
  <section class="space-y-3 rounded-detail border border-edge p-3" data-test="dataqs-request">
    <h4 class="text-sm font-semibold text-ink">DataQs request</h4>

    <template v-if="standing.kind === 'file_ready'">
      <p class="text-ink-muted">
        FMCSA's record does not show the court's result yet. Check the request, approve it, then file it in DataQs yourself — it is never sent from here.
      </p>
      <FactList :facts="facts" layout="rows" data-test="dataqs-fields" />
      <p v-if="driver" class="text-ink" data-test="dataqs-driver">
        Driver: {{ driver.name }} ({{ driver.by === "report" ? "confirmed by the officer's report" : "confirmed by a person" }})
      </p>
      <AppCallout v-else tone="warning" data-test="dataqs-driver-unconfirmed">
        Confirm who was driving first: a request is never filed on Samsara's reading alone.
        <BaseButton size="sm" variant="link" data-test="dataqs-confirm-driver" @click="emit('confirmDriver')">Go to the driver card</BaseButton>
      </AppCallout>
      <FormField v-slot="{ id: fieldId }" label="Explanation" required>
        <BaseTextarea :id="fieldId" v-model="narrative" maxlength="4000" rows="6" data-test="dataqs-narrative" />
      </FormField>
      <AppCallout tone="info" data-test="dataqs-attestation">{{ DATAQS_ATTESTATION }}</AppCallout>
      <AppCheckbox v-model="attested" label="I have read this. The request is true, accurate and complete." data-test="dataqs-attest" />
      <BaseButton
        variant="primary"
        :disabled="!driver || !attested || !narrative.trim() || approve.isPending.value"
        data-test="dataqs-approve"
        @click="approveIt"
      >
        Approve for filing
      </BaseButton>
    </template>

    <template v-else>
      <p class="text-ink-muted" data-test="dataqs-approved">
        Approved by {{ standing.dataqs.attestedBy ?? "a former user" }} on {{ formatDateTime(standing.dataqs.attestedAt) }}. File it in DataQs:
      </p>
      <ol class="list-decimal space-y-2 pl-5 text-ink">
        <li>
          <a :href="DATAQS_URL" target="_blank" rel="noopener" class="font-medium text-link hover:text-link-hover" data-test="dataqs-open">Open DataQs</a>
          and start a request of type “{{ fields[0]!.value }}”.
        </li>
        <li>
          Enter these:
          <FactList :facts="facts.slice(1)" layout="rows" class="mt-1" data-test="dataqs-fields" />
        </li>
        <li>
          Paste the explanation.
          <BaseButton size="sm" variant="link" data-test="dataqs-copy" @click="copyNarrative">{{ copied ? "Copied" : "Copy it" }}</BaseButton>
          <p class="mt-1 whitespace-pre-line text-ink-muted">{{ standing.dataqs.narrative }}</p>
        </li>
        <li>
          Attach the court's paper.
          <BaseButton size="sm" variant="link" :disabled="!paper" data-test="dataqs-paper" @click="viewing = true">View or download it</BaseButton>
        </li>
      </ol>
      <form class="flex flex-wrap items-end gap-3" data-test="dataqs-filed-form" @submit.prevent="recordFiled">
        <FormField v-slot="{ id: fieldId }" label="RDR number" required>
          <BaseInput :id="fieldId" v-model="rdrNumber" maxlength="40" data-test="dataqs-rdr" />
        </FormField>
        <FormField v-slot="{ id: fieldId }" label="Filed on" required>
          <AppDateField :id="fieldId" v-model="filedOn" :max-date="today" data-test="dataqs-filed-on" />
        </FormField>
        <BaseButton variant="primary" type="submit" :disabled="!rdrNumber.trim() || !filedOn || filed.isPending.value" data-test="dataqs-filed">
          Record the filing
        </BaseButton>
      </form>
    </template>

    <p v-if="failure" class="text-sm text-danger-700" role="alert" data-test="dataqs-error">{{ failure }}</p>

    <DocumentPreview
      :open="viewing && !!paper"
      label="Court result"
      :doc="paper"
      :download-path="paper ? `/api/roadside-inspections/${encodeURIComponent(inspectionId)}/documents/${paper.id}/download` : null"
      @close="viewing = false"
    />
  </section>
</template>
