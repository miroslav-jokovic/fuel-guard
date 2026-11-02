<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { CARRIER_STEP_PROOF_LABELS, carrierStepRecordSchema, formatDisplayDate, type CarrierChecklistRow } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCallout,
  AppFormField as FormField,
  AppSelect,
  AppTextarea,
} from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useRecordCarrierStep } from "@/features/recruitment/useCarrierSteps";
import { useApplicantDocumentsQuery } from "@/features/recruitment/useApplicantDocuments";

/**
 * One of the carrier's own steps on one applicant (HIRING-WORKFLOW-AUDIT §10 CE2, 0545).
 *
 * Done is one press for a tick step; a document step asks which of the applicant's FILED papers proves
 * it (D-CE2) — the papers come from the record's Documents section, so "add it there first" is the
 * instruction when there is none. Taking a done step back asks why (CS028): the record keeps both acts,
 * and the row reads open again.
 *
 * ⚠ Only filed papers are offered. A paper still on the link's staging bucket has no `documents` row
 * yet, and 0545 checks the record names a `documents` row of this driver (CS026).
 *
 * Writes on `session.can("recruitment")`, what the api's POST asks.
 */
const props = defineProps<{ open: boolean; driverId: string; step: CarrierChecklistRow | null }>();
const emit = defineEmits<{ close: [] }>();

const session = useSessionStore();
const toast = useToastStore();
const canManage = computed(() => session.can("recruitment"));
const record = useRecordCarrierStep();
const documentsQ = useApplicantDocumentsQuery(computed(() => (props.open && props.step?.proof === "document" ? props.driverId : "")));

const note = ref("");
const documentId = ref<string | null>(null);
const undoing = ref(false);
watch(() => [props.open, props.step?.id], () => {
  note.value = "";
  documentId.value = null;
  undoing.value = false;
});

const papers = computed(() =>
  (documentsQ.data.value ?? [])
    .filter((d) => !d.staged)
    .map((d) => ({ value: d.id, label: `${d.kind.replaceAll("_", " ")} · ${formatDisplayDate(d.at)}` })),
);
const done = computed(() => props.step?.state === "done");
const input = computed(() =>
  undoing.value
    ? { act: "undone" as const, note: note.value }
    : { act: "done" as const, note: note.value, documentId: props.step?.proof === "document" ? documentId.value : null },
);
const parsed = computed(() => carrierStepRecordSchema.safeParse(input.value));
const ready = computed(() =>
  parsed.value.success && (undoing.value || props.step?.proof !== "document" || documentId.value !== null),
);

async function submit(): Promise<void> {
  if (!props.step || !parsed.value.success) return;
  try {
    await record.mutateAsync({ driverId: props.driverId, stepId: props.step.id, input: parsed.value.data });
    toast.success(undoing.value ? "Step taken back" : "Step done");
    emit("close");
  } catch (e) {
    toast.error("Could not record the step", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="open && step !== null" size="md" :title="step?.label ?? ''" @close="emit('close')">
    <div v-if="step" class="space-y-5" data-testid="carrier-step-drawer">
      <p v-if="step.instructions" class="text-sm text-ink">{{ step.instructions }}</p>
      <p class="text-xs text-ink-muted">
        Proved by {{ CARRIER_STEP_PROOF_LABELS[step.proof].toLowerCase() }}.
        {{ step.blocksHire ? "Your company's rule: the hire waits for it." : "It does not hold the hire." }}
      </p>

      <AppCallout v-if="done && step.record" tone="success" data-testid="carrier-step-done">
        Done by {{ step.record.byName }} on {{ formatDisplayDate(step.record.at) }}.{{ step.record.note ? ` ${step.record.note}` : "" }}
      </AppCallout>
      <AppCallout v-else-if="step.record?.act === 'undone'" tone="info" data-testid="carrier-step-undone">
        Taken back by {{ step.record.byName }} on {{ formatDisplayDate(step.record.at) }}: {{ step.record.note }}
      </AppCallout>

      <template v-if="canManage">
        <template v-if="!done || undoing">
          <template v-if="!undoing && step.proof === 'document'">
            <FormField v-if="papers.length" v-slot="{ id }" label="The paper that proves it">
              <AppSelect :id="id" v-model="documentId" :options="papers" placeholder="Choose a document…" />
            </FormField>
            <AppCallout v-else-if="!documentsQ.isPending.value" tone="caution" data-testid="carrier-step-no-papers">
              This step needs a document on file. Add it in Documents on this page first, then come back.
            </AppCallout>
          </template>
          <FormField v-slot="{ id }" :label="undoing ? 'Why are you taking this back?' : 'Note'" :hint="undoing ? undefined : 'Optional.'">
            <AppTextarea :id="id" v-model="note" :rows="2" />
          </FormField>
        </template>
      </template>
      <p v-else class="text-xs text-ink-muted">Ask someone who manages recruiting to record this step.</p>
    </div>

    <template v-if="step && canManage" #footer>
      <BaseButton v-if="done && !undoing" variant="secondary" @click="undoing = true">Take it back</BaseButton>
      <template v-else>
        <BaseButton v-if="undoing" variant="ghost" @click="undoing = false">Cancel</BaseButton>
        <BaseButton :variant="undoing ? 'danger' : 'primary'" :disabled="!ready || record.isPending.value" @click="submit">
          {{ record.isPending.value ? "Saving…" : undoing ? "Take it back" : "Mark done" }}
        </BaseButton>
      </template>
    </template>
  </SlideOver>
</template>
