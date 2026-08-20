<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { dateDiscrepancies, type EmployerResponse } from "@fuelguard/shared";
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppInput as BaseInput,
  AppDateField,
  AppFormField as FormField,
} from "@fuelguard/ui";
import SlideOver from "@/components/SlideOver.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import {
  useRecordInquiryOutcome,
  useUploadInquiryDocument,
  type EmployerInquiry,
} from "@/features/recruitment/useEmployerInquiries";

/**
 * Recording what a previous employer said (EMPLOYER-INQUIRY-PLAN E4).
 *
 * ── THE DISCREPANCY IS SHOWN, NEVER APPLIED ────────────────────────────────────────────────────
 * When the employer's dates differ from the ones the applicant declared, this says so and stops
 * there. "Correcting" the application from the reply would edit a document somebody certified as
 * true and complete under §391.21(b) — the one thing that document may never have done to it. What
 * the difference calls for is a conversation with the driver, so the screen produces something to
 * ask about rather than a resolution.
 *
 * ── AND A NIL RETURN IS AN ANSWER ──────────────────────────────────────────────────────────────
 * "They reported no accidents" is a checkbox rather than an empty list, because an empty list means
 * two different things depending on who is reading it, and only one of them is evidence.
 */
const props = defineProps<{ inquiry: EmployerInquiry | null; declared: { started_on: string; ended_on: string | null } | null; driverId: string }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const recordOutcome = useRecordInquiryOutcome();
const upload = useUploadInquiryDocument();

const form = reactive({
  employment_confirmed: true,
  verified_started_on: "",
  verified_ended_on: "",
  position_held: "",
  reports_no_accidents: true,
  accidents: [] as Array<{ occurred_on: string; nature: string; fatalities: string; injuries: string; hazmat_spill: boolean }>,
  note: "",
  outcome_on: "",
});
const letter = ref<File | null>(null);

watch(
  () => props.inquiry?.id,
  (id) => {
    if (!id) return;
    Object.assign(form, {
      employment_confirmed: true,
      verified_started_on: props.declared?.started_on ?? "",
      verified_ended_on: props.declared?.ended_on ?? "",
      position_held: "",
      reports_no_accidents: true,
      accidents: [],
      note: "",
      outcome_on: new Date().toISOString().slice(0, 10),
    });
    letter.value = null;
  },
);

/** Live, so the operator sees the disagreement while they are still typing the employer's answer. */
const discrepancies = computed(() =>
  props.declared
    ? dateDiscrepancies(props.declared, {
        verified_started_on: form.verified_started_on || null,
        verified_ended_on: form.verified_ended_on || null,
      })
    : [],
);

function addAccident(): void {
  form.reports_no_accidents = false;
  form.accidents.push({ occurred_on: "", nature: "", fatalities: "0", injuries: "0", hazmat_spill: false });
}

const busy = computed(() => recordOutcome.isPending.value || upload.isPending.value);

async function save(): Promise<void> {
  const inquiry = props.inquiry;
  if (!inquiry) return;
  try {
    // The letter goes first, so the record cites a document that already exists rather than an id
    // that may never arrive — the same order every other evidence path in the product uses.
    let documentId: string | null = null;
    if (letter.value) {
      documentId = (await upload.mutateAsync({ inquiryId: inquiry.id, file: letter.value })).documentId;
    }

    const response: EmployerResponse = {
      employment_confirmed: form.employment_confirmed,
      verified_started_on: form.verified_started_on || null,
      verified_ended_on: form.verified_ended_on || null,
      position_held: form.position_held.trim() || null,
      reports_no_accidents: form.reports_no_accidents,
      accidents: form.accidents
        .filter((a) => a.occurred_on || a.nature.trim())
        .map((a) => ({
          occurred_on: a.occurred_on,
          nature: a.nature.trim(),
          fatalities: Number.parseInt(a.fatalities, 10) || 0,
          injuries: Number.parseInt(a.injuries, 10) || 0,
          hazmat_spill: a.hazmat_spill,
        })),
      note: form.note.trim() || null,
    };

    await recordOutcome.mutateAsync({
      id: inquiry.id,
      driverId: props.driverId,
      input: { outcome: "responded", outcome_on: form.outcome_on, response, document_id: documentId },
    });
    toast.success("Their answer is on file");
    emit("close");
  } catch (e) {
    toast.error("Could not record the answer", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver
    :open="inquiry !== null"
    size="lg"
    :title="`What ${inquiry?.employer_name ?? 'they'} said`"
    @close="emit('close')"
  >
    <div v-if="inquiry" class="space-y-6">
      <p class="text-sm text-ink-muted">
        §391.23(c)(2) asks for the information received, not only that something arrived. Record what
        they confirmed and any accidents they reported; attach their letter if you have one.
      </p>

      <div class="space-y-4">
        <BaseCheckbox v-model="form.employment_confirmed">
          They confirmed this driver worked for them
        </BaseCheckbox>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField v-slot="{ id }" label="They say from">
            <AppDateField :id="id" v-model="form.verified_started_on" />
          </FormField>
          <FormField v-slot="{ id }" label="They say until">
            <AppDateField :id="id" v-model="form.verified_ended_on" />
          </FormField>
          <FormField v-slot="{ id }" label="Position" hint="Optional.">
            <BaseInput :id="id" v-model="form.position_held" placeholder="Optional" />
          </FormField>
        </div>

        <ul v-if="discrepancies.length" class="space-y-1">
          <li v-for="d in discrepancies" :key="d.field" class="text-sm text-ink-secondary">
            <span :class="[BADGE_BASE, toneClass('warning')]">{{ d.days }} days apart</span>
            <span class="ml-2">
              The applicant said {{ d.declared }}; they say {{ d.reported }}. Worth asking about — the
              application is a document the driver certified, so it is not corrected from here.
            </span>
          </li>
        </ul>
      </div>

      <div class="space-y-3">
        <h3 class="text-sm font-semibold text-ink">Accidents they reported</h3>
        <BaseCheckbox v-model="form.reports_no_accidents">
          They reported no accidents
        </BaseCheckbox>

        <template v-if="!form.reports_no_accidents">
          <div
            v-for="(accident, i) in form.accidents"
            :key="i"
            class="space-y-4 rounded-surface bg-surface-muted p-4"
          >
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField v-slot="{ id }" label="Date">
                <AppDateField :id="id" v-model="accident.occurred_on" />
              </FormField>
              <FormField v-slot="{ id }" label="What happened">
                <BaseInput :id="id" v-model="accident.nature" />
              </FormField>
            </div>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField v-slot="{ id }" label="Fatalities">
                <BaseInput :id="id" v-model="accident.fatalities" inputmode="numeric" />
              </FormField>
              <FormField v-slot="{ id }" label="Injuries">
                <BaseInput :id="id" v-model="accident.injuries" inputmode="numeric" />
              </FormField>
            </div>
            <BaseCheckbox v-model="accident.hazmat_spill">
              Hazardous material other than fuel was spilled
            </BaseCheckbox>
            <div class="flex justify-end">
              <BaseButton variant="ghost" size="sm" @click="form.accidents.splice(i, 1)">Remove</BaseButton>
            </div>
          </div>
          <BaseButton size="sm" @click="addAccident">Add an accident</BaseButton>
        </template>
        <BaseButton v-else size="sm" @click="addAccident">They did report one</BaseButton>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="Answered on">
          <AppDateField :id="id" v-model="form.outcome_on" />
        </FormField>
        <FormField v-slot="{ id }" label="Anything else they said" hint="Optional.">
          <BaseInput :id="id" v-model="form.note" placeholder="Optional" />
        </FormField>
      </div>

      <div>
        <p class="text-sm font-medium text-ink">Their letter</p>
        <p class="mt-1 text-sm text-ink-muted">Optional — the record stands on what you enter above.</p>
        <div class="mt-2">
          <FileDropzone
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            :busy="upload.isPending.value"
            busy-label="Uploading…"
            :label="letter ? letter.name : 'Drag & drop what they sent back'"
            hint="PDF or a photo of the fax. Never publicly reachable."
            @files="letter = $event[0] ?? null"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="busy" @click="emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="busy || !form.outcome_on" @click="save">
          {{ busy ? "Recording…" : "Record their answer" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
