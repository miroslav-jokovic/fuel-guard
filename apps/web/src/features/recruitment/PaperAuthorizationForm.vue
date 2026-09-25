<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  APPLICATION_RELEASE_ORDER,
  AUTHORIZATION_PURPOSE_LABELS,
  type AuthorizationPurpose,
} from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCombobox as ComboSelect,
  AppFormField as FormField,
  AppInput as BaseInput,
} from "@silvicom/ui";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";
import { useRecordPaperAuthorization } from "@/features/recruitment/useAuthorizations";

/**
 * Record a permission the driver signed on paper (MV3, D-MVR2) — the other half of the Templates tab.
 *
 * ⚠ The purposes offered are `APPLICATION_RELEASE_ORDER`, the list the link collects, and the first
 * one still unsigned is preselected: the usual case is one missing release — since D-MVR1, the MVR
 * release for a link whose five were signed before it existed.
 *
 * ⚠ The scan is required, here and by the server (`paperAuthorization.ts`). What the office types is
 * the name as written; the wording is composed by the server from the carrier's live text, never sent.
 */
const props = defineProps<{
  driverId: string;
  /** Purposes that already have a live signature — preselection skips them. */
  signed: readonly AuthorizationPurpose[];
}>();
const emit = defineEmits<{ done: [] }>();

const toast = useToastStore();
const record = useRecordPaperAuthorization();

const firstUnsigned = (): AuthorizationPurpose =>
  APPLICATION_RELEASE_ORDER.find((p) => !props.signed.includes(p)) ?? APPLICATION_RELEASE_ORDER[0]!;

const purpose = ref<AuthorizationPurpose>(firstUnsigned());
const signedName = ref("");
const scan = ref<File | null>(null);
watch(() => props.signed, () => (purpose.value = firstUnsigned()));

const options = APPLICATION_RELEASE_ORDER.map((p) => ({ value: p, label: AUTHORIZATION_PURPOSE_LABELS[p] }));
const ready = computed(() => signedName.value.trim().length > 0 && scan.value !== null);

async function save(): Promise<void> {
  if (!scan.value) return;
  try {
    await record.mutateAsync({
      driverId: props.driverId,
      purpose: purpose.value,
      signedName: signedName.value.trim(),
      file: scan.value,
    });
    toast.success("Paper signature recorded");
    signedName.value = "";
    scan.value = null;
    emit("done");
  } catch (e) {
    toast.error("Could not record it", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-4 rounded-surface border border-edge p-4">
    <p class="text-sm font-medium text-ink">Record a paper signature</p>
    <p class="text-xs text-ink-secondary">
      Print the blank from Recruitment → Templates, have the driver sign it, then upload the scan. The
      wording on file is the carrier's current text for that permission.
    </p>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField v-slot="{ id }" label="Permission">
        <ComboSelect :id="id" v-model="purpose" :options="options" />
      </FormField>
      <FormField v-slot="{ id }" label="Name as signed">
        <BaseInput :id="id" v-model="signedName" />
      </FormField>
    </div>
    <FileDropzone
      accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
      :busy="record.isPending.value"
      busy-label="Uploading…"
      :label="scan ? scan.name : 'Drag & drop the signed page'"
      hint="PDF or a photo. Stored privately in the driver's file."
      @files="scan = $event[0] ?? null"
    />
    <BaseButton variant="primary" size="sm" :disabled="!ready || record.isPending.value" @click="save">
      Record paper signature
    </BaseButton>
  </div>
</template>
