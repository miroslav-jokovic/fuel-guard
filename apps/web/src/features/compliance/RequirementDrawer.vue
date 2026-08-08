<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { AppIcon } from "@fuelguard/ui";
import { ClipboardDocumentCheckIcon } from "@fuelguard/ui/icons";
import {
  DQ_ITEMS,
  HAZMAT_TRAINING_TYPES,
  type CertificationCreateRequest,
  type CertificationKind,
  type DocumentKind,
  type QualificationRecordCreateRequest,
  type QualificationRecordKind,
} from "@fuelguard/shared";
import SlideOver from "@/components/SlideOver.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseCheckbox from "@/components/ui/BaseCheckbox.vue";
import ComboSelect from "@/components/ui/ComboSelect.vue";
import FormField from "@/components/ui/FormField.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";
import {
  useCreateCertification,
  useCreateQualificationRecord,
  useUploadDocument,
} from "@/composables/useCompliance";

/**
 * One requirement, one form (D-DQ9).
 *
 * The old drawer named a gap — "medical card, missing" — and then handed you a generic *add a
 * certification* form with a Type dropdown to re-select. The system had already answered the question
 * and still asked it. Here the requirement is the input: no type picker, and only the fields that
 * kind actually needs. A medical card asks for an expiry; a road test asks when it happened.
 */
const props = defineProps<{ open: boolean; driverId: string; itemKey: string | null }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const createCert = useCreateCertification();
const createRecord = useCreateQualificationRecord();
const upload = useUploadDocument();

const spec = computed(() => DQ_ITEMS.find((i) => i.key === props.itemKey) ?? null);
const isCertification = computed(() => spec.value?.source === "certification");
const isEndorsement = computed(() => spec.value?.evidenceKinds[0] === "endorsement");
const isTraining = computed(() => spec.value?.evidenceKinds[0] === "hazmat_training");

const form = reactive({
  // certification
  identifier: "",
  issuingAuthority: "",
  issuedAt: "",
  expiresAt: "",
  qualifier: "H",
  trainingProviderName: "",
  trainingCertified: false,
  // qualification record
  occurredOn: "",
  coversUntil: "",
  result: "",
  performedBy: "",
  reference: "",
});
const scan = ref<File | null>(null);

function reset(): void {
  Object.assign(form, {
    identifier: "",
    issuingAuthority: "",
    issuedAt: "",
    expiresAt: "",
    qualifier: "H",
    trainingProviderName: "",
    trainingCertified: false,
    occurredOn: "",
    coversUntil: "",
    result: "",
    performedBy: "",
    reference: "",
  });
  scan.value = null;
}
watch(() => props.itemKey, reset);

const saving = computed(
  () => createCert.isPending.value || createRecord.isPending.value || upload.isPending.value,
);

/** A record has to have happened on a date; a certification is dated by its expiry or its issue. */
const ready = computed(() => {
  if (!spec.value) return false;
  return isCertification.value
    ? Boolean(form.expiresAt || form.issuedAt)
    : Boolean(form.occurredOn);
});

async function save(): Promise<void> {
  const s = spec.value;
  if (!s) return;
  try {
    // The scan goes first, so the record can cite a document that already exists rather than a
    // document id that may never arrive. An orphaned scan is swept; an orphaned citation is a lie.
    let documentId: string | undefined;
    if (scan.value) {
      const res = await upload.mutateAsync({
        subjectType: "driver",
        subjectId: props.driverId,
        kind: s.evidenceKinds[0] as DocumentKind,
        file: scan.value,
      });
      documentId = res.documentId;
    }

    if (isCertification.value) {
      const body: CertificationCreateRequest = {
        id: crypto.randomUUID(),
        subjectType: "driver",
        subjectId: props.driverId,
        kind: s.evidenceKinds[0] as CertificationKind,
        qualifier: isEndorsement.value ? form.qualifier : null,
        trainingType: isTraining.value
          ? (s.trainingType as (typeof HAZMAT_TRAINING_TYPES)[number])
          : null,
        trainingProviderName: isTraining.value ? form.trainingProviderName.trim() || null : null,
        trainingCertified: isTraining.value ? form.trainingCertified : null,
        identifier: form.identifier.trim() || null,
        issuingAuthority: form.issuingAuthority.trim() || null,
        issuedAt: form.issuedAt || null,
        expiresAt: form.expiresAt || null,
        documentId: documentId ?? null,
      };
      await createCert.mutateAsync(body);
    } else {
      const body: QualificationRecordCreateRequest = {
        id: crypto.randomUUID(),
        driverId: props.driverId,
        kind: s.evidenceKinds[0] as QualificationRecordKind,
        occurredOn: form.occurredOn,
        coversUntil: form.coversUntil || null,
        result: form.result.trim() || null,
        performedBy: form.performedBy.trim() || null,
        reference: form.reference.trim() || null,
        documentId: documentId ?? null,
        detail: {},
      };
      await createRecord.mutateAsync(body);
    }

    toast.success(`${s.label} recorded`);
    reset();
    emit("close");
  } catch (e) {
    toast.error(
      `Could not record the ${spec.value?.label.toLowerCase()}`,
      e instanceof Error ? e.message : undefined,
    );
  }
}
</script>

<template>
  <SlideOver :open="open" size="lg" :title="spec?.label ?? 'Requirement'" @close="emit('close')">
    <div v-if="spec" class="space-y-6">
      <div class="space-y-4">
        <template v-if="isCertification">
          <FormField
            v-if="isEndorsement"
            v-slot="{ id }"
            label="Endorsement"
            hint="H covers hazmat; X covers hazmat and tank."
          >
            <ComboSelect
              :id="id"
              v-model="form.qualifier"
              :options="[
                { value: 'H', label: 'H — hazmat' },
                { value: 'X', label: 'X — hazmat and tank' },
              ]"
            />
          </FormField>

          <FormField v-if="isTraining" v-slot="{ id }" label="Training provider">
            <BaseInput
              :id="id"
              v-model="form.trainingProviderName"
              placeholder="Who delivered it"
            />
          </FormField>

          <FormField
            v-slot="{ id }"
            label="Identifier"
            hint="Licence, certificate or policy number. Optional."
          >
            <BaseInput :id="id" v-model="form.identifier" placeholder="Optional" />
          </FormField>

          <FormField v-slot="{ id }" label="Issuing authority" hint="Optional.">
            <BaseInput :id="id" v-model="form.issuingAuthority" placeholder="Optional" />
          </FormField>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField v-slot="{ id }" label="Issued">
              <BaseInput :id="id" v-model="form.issuedAt" type="date" />
            </FormField>
            <FormField
              v-slot="{ id }"
              label="Expires"
              :hint="isTraining ? 'Training runs three years from the issue date.' : undefined"
            >
              <BaseInput :id="id" v-model="form.expiresAt" type="date" />
            </FormField>
          </div>

          <BaseCheckbox v-if="isTraining" v-model="form.trainingCertified">
            I certify this training record is complete (§172.704(d)).
          </BaseCheckbox>
        </template>

        <template v-else>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField v-slot="{ id }" label="Date">
              <BaseInput :id="id" v-model="form.occurredOn" type="date" />
            </FormField>
            <FormField
              v-if="spec.recurrence === 'annual'"
              v-slot="{ id }"
              label="Covers until"
              hint="Leave blank for one year from the date."
            >
              <BaseInput :id="id" v-model="form.coversUntil" type="date" />
            </FormField>
          </div>
          <FormField v-slot="{ id }" label="Result" hint="Optional.">
            <BaseInput :id="id" v-model="form.result" placeholder="Optional" />
          </FormField>
          <FormField v-slot="{ id }" label="Performed by" hint="Optional.">
            <BaseInput :id="id" v-model="form.performedBy" placeholder="Optional" />
          </FormField>
          <FormField
            v-slot="{ id }"
            label="Reference"
            hint="Report or confirmation number. Optional."
          >
            <BaseInput :id="id" v-model="form.reference" placeholder="Optional" />
          </FormField>
        </template>

        <div>
          <p class="text-sm font-medium text-ink">Scan</p>
          <p class="mt-1 text-sm text-ink-muted">
            Optional here — you can attach it later from the file.
          </p>
          <div class="mt-2">
            <FileDropzone
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
              :busy="upload.isPending.value"
              busy-label="Uploading…"
              :label="scan ? scan.name : 'Drag & drop the scan here'"
              hint="PDF or photo. Uploads straight to storage and is never publicly reachable."
              @files="scan = $event[0] ?? null"
            />
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="saving" @click="emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="saving || !ready" @click="save">
          <AppIcon :icon="ClipboardDocumentCheckIcon" class="size-4" aria-hidden="true" />
          {{ saving ? "Saving…" : "Record it" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
