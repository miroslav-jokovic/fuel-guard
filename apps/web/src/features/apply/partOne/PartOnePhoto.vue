<script setup lang="ts">
import { computed } from "vue";
import { AppCheckbox } from "@silvicom/ui";
import type { ApplicationCaptureSlot, ApplicationCaptureView } from "@silvicom/shared";
import DocumentCaptureFields from "@/features/apply/DocumentCaptureFields.vue";
import type { PartOneAnswers, PhotoScreen, ScreenErrors } from "./partOneScreens";
import type { BarcodeState } from "./usePartOne";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * Screens 8–10 (§6.2): one document per screen — the CDL's front, its back, the medical card (D-AW4:
 * both sides of the CDL required; the medical card, or "I don't have one yet").
 *
 * On the CDL's back the original photograph is handed up (`staged`) for its barcode (AW5); what the
 * read filled is said here, and an unreadable barcode is said once and costs nothing.
 *
 * ⚠ The capture itself is `DocumentCaptureFields`, unchanged, for one slot. The scanner wizard — the
 * card outline, the in-browser metrics, the server's re-hash, "Upload a photo instead", the desktop QR
 * handoff (§6.6, AW4) — replaces it in C3b behind the same `CaptureProvider` seam; this screen is where
 * it will go, and what it requires does not change when it does.
 */
const props = defineProps<{
  token: string;
  photo: PhotoScreen;
  captures: ApplicationCaptureView[];
  errors: ScreenErrors;
  /** AW5: hand the original of this screen's photograph to `usePartOne`, whose barcode read it starts. */
  readsBarcode?: boolean;
  barcode?: BarcodeState;
}>();
const emit = defineEmits<{ staged: [original: Blob] }>();
const answers = defineModel<PartOneAnswers>("answers", { required: true });
const copy = APPLY_COPY.partOne.photo;
const only = computed(() => [props.photo] as const);
/**
 * Emitted synchronously, the moment the photo is staged — the read itself runs in `usePartOne`, because
 * this component is keyed by screen and may be gone (the driver pressed Continue) before a decode ends.
 */
const onStaged = (slot: ApplicationCaptureSlot, original: Blob): void => {
  if (props.readsBarcode && slot === props.photo) emit("staged", original);
};
const barcodeNote = computed(() => {
  switch (props.barcode) {
    case "reading": return copy.reading;
    case "filled": return copy.readFilled;
    case "unread": return copy.readNothing;
    default: return null;
  }
});
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-ink-muted">{{ copy[photo].hint }}</p>
    <DocumentCaptureFields :token="token" :captures="captures" :only="only" :on-staged="onStaged" />
    <p v-if="barcodeNote" class="text-sm text-ink-muted" aria-live="polite">{{ barcodeNote }}</p>
    <div v-if="photo === 'medical_card'">
      <AppCheckbox v-model="answers.medical_card_pending" :label="copy.noMedicalCard" />
      <p v-if="answers.medical_card_pending" class="mt-1 text-xs text-ink-tertiary">{{ copy.noMedicalCardHint }}</p>
    </div>
    <p v-if="errors.photo" class="text-sm text-danger-700" role="alert">{{ errors.photo }}</p>
  </div>
</template>
