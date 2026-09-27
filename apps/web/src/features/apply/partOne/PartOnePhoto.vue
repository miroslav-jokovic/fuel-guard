<script setup lang="ts">
import { computed, toRef, watch } from "vue";
import { AppButton as BaseButton, AppCheckbox } from "@silvicom/ui";
import type { ApplicationCaptureSlot, ApplicationCaptureView } from "@silvicom/shared";
import { useApplicationCaptures } from "@/features/apply/capture/useApplicationCaptures";
import PartOneHandoff from "./PartOneHandoff.vue";
import type { PartOneAnswers, PhotoScreen, ScreenErrors } from "./partOneScreens";
import type { BarcodeState } from "./usePartOne";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * Screens 8–10 (§6.2): one document per screen — the CDL's front, its back, the medical card (D-AW4:
 * both sides of the CDL required; the medical card, or "I don't have one yet").
 *
 * ── THE SCANNER SCREEN (§6.6.1, §6.6.6, AW4, C3b2b) ───────────────────────────────────────────
 * An outline of what goes in the picture, two lines of how, one full-width "Take photo" that opens the
 * phone's own camera app (the `capture` input — full resolution and autofocus, D-APP11), then the picture
 * large with **Use this photo / Retake**. Nothing is sent before "Use this photo" (`take` holds, `use`
 * sends — `useApplicationCaptures`), so a thumb over the licence number is seen and retaken for nothing.
 * "Upload a photo instead" is on the same screen for a browser refused the camera; it runs the same gate.
 *
 * ⚠ No "this looks blurry" advisory, on purpose: every blur/glare floor is `null` until recorded samples
 * exist (D-SCAN10), and a message fired by a guessed number is worse than none (Q-AW32).
 *
 * On the CDL's back the original photograph is handed up (`staged`) for its barcode (AW5) — after "Use
 * this photo", once it is in the bucket, never on the preview; what the read filled is said here.
 *
 * On a computer (`desktop`, a pointer media query — never the user agent) the QR handoff comes first
 * (§6.6.6, C3b2b2, `PartOneHandoff`) while the slot is still empty, and the two buttons stay beneath it
 * for a driver whose photo is already on this computer. The flow polls for the phone's photo.
 *
 * What the screen REQUIRES is unchanged by any of this: Continue asks the server whether the slot is
 * filled (`photoDone`). A photograph held and not sent is not filled, so the flow is told (`holding`) and
 * says "press Use this photo" rather than "take the photo".
 */
const props = defineProps<{
  token: string;
  carrier: string;
  photo: PhotoScreen;
  captures: ApplicationCaptureView[];
  errors: ScreenErrors;
  /** AW5: hand the original of this screen's photograph to `usePartOne`, whose barcode read it starts. */
  readsBarcode?: boolean;
  barcode?: BarcodeState;
  /** A computer: offer the phone first (§6.6.6). */
  desktop?: boolean;
}>();
const emit = defineEmits<{ staged: [original: Blob]; holding: [held: boolean] }>();
const answers = defineModel<PartOneAnswers>("answers", { required: true });
const copy = APPLY_COPY.partOne.photo;
const rejected = APPLY_COPY.documents.rejected;

/**
 * Emitted synchronously, the moment the photo is staged — the read itself runs in `usePartOne`, because
 * this component is keyed by screen and may be gone (the driver pressed Continue) before a decode ends.
 */
const onStaged = (slot: ApplicationCaptureSlot, original: Blob): void => {
  if (props.readsBarcode && slot === props.photo) emit("staged", original);
};
const captures = useApplicationCaptures(toRef(props, "token"), toRef(props, "captures"), {
  only: [props.photo],
  onStaged,
});
// `only` is one slot, so there is exactly one view.
const slot = computed(() => captures.slots.value[0]!);
const working = computed(() => slot.value.state === "working");
/** The handoff is for a slot nobody has filled — not one on file, not a photo this browser holds. */
const handoff = computed(() => Boolean(props.desktop) && !slot.value.pending && slot.value.state !== "done");
watch(() => slot.value.pending, (held) => emit("holding", held), { immediate: true });

/**
 * The outline's shape is the document's. A CDL is an ID-1 card (85.60 × 53.98 mm, ISO/IEC 7810); the
 * medical examiner's certificate is a letter-size form.
 */
const outlineShape = computed(() =>
  props.photo === "medical_card" ? "mx-auto aspect-[8.5/11] max-h-96" : "aspect-[85.6/54] w-full",
);

const status = computed<string | null>(() => {
  const s = slot.value;
  if (s.state === "rejected" && s.reason) return rejected[s.reason];
  if (s.state === "failed") return s.failure === "not_intact" ? copy.notIntact : copy.failed;
  if (s.state === "review") return copy.check;
  if (s.state === "done") return s.previewUrl ? copy.received : copy.receivedEarlier;
  return null;
});
const statusIsProblem = computed(() => slot.value.state === "rejected" || slot.value.state === "failed");

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
    <div class="space-y-1 text-sm text-ink-muted">
      <p>{{ copy[photo].hint }}</p>
      <p>{{ copy.howTo }}</p>
    </div>

    <PartOneHandoff v-if="handoff" :token="token" :carrier="carrier" />
    <p v-if="handoff" class="text-sm text-ink-muted">{{ copy.handoff.orHere }}</p>

    <!-- The picture when this browser holds one (taken, or sent this visit — X6); the outline otherwise. -->
    <figure
      :class="[
        outlineShape,
        'flex items-center justify-center overflow-hidden rounded-surface bg-surface-muted',
        slot.previewUrl ? 'ring-1 ring-inset ring-edge' : 'border-2 border-dashed border-edge-control',
      ]"
    >
      <img v-if="slot.previewUrl" :src="slot.previewUrl" :alt="copy[photo].outline" class="h-full w-full object-contain" />
      <figcaption v-else class="px-4 text-center text-sm font-medium text-ink-tertiary">{{ copy[photo].outline }}</figcaption>
    </figure>

    <p
      v-if="status"
      :class="['text-sm', statusIsProblem ? 'text-danger-700' : 'text-ink-muted']"
      :role="statusIsProblem ? 'alert' : undefined"
      aria-live="polite"
    >
      {{ status }}
    </p>

    <!-- A photograph held and not sent: the two choices, and nothing else competes with them. -->
    <div v-if="slot.pending" class="space-y-3">
      <BaseButton variant="primary" size="touch" block :disabled="working" @click="captures.use(photo)">
        {{ working ? copy.sending : copy.use }}
      </BaseButton>
      <BaseButton size="touch" block :disabled="working" @click="captures.take(photo, slot.source)">
        {{ slot.source === "file" ? copy.chooseAnother : copy.retake }}
      </BaseButton>
    </div>
    <div v-else class="space-y-3">
      <BaseButton
        :variant="slot.state === 'done' ? 'secondary' : 'primary'"
        size="touch"
        block
        :disabled="working"
        @click="captures.take(photo, 'camera')"
      >
        {{ working ? APPLY_COPY.documents.working : slot.state === "done" ? copy.takeAgain : copy.take }}
      </BaseButton>
      <BaseButton variant="ghost" size="touch" block :disabled="working" @click="captures.take(photo, 'file')">
        {{ copy.upload }}
      </BaseButton>
    </div>

    <p v-if="barcodeNote" class="text-sm text-ink-muted" aria-live="polite">{{ barcodeNote }}</p>
    <div v-if="photo === 'medical_card'">
      <AppCheckbox v-model="answers.medical_card_pending" :label="copy.noMedicalCard" />
      <p v-if="answers.medical_card_pending" class="mt-1 text-xs text-ink-tertiary">{{ copy.noMedicalCardHint }}</p>
    </div>
    <p v-if="errors.photo" class="text-sm text-danger-700" role="alert">{{ errors.photo }}</p>
  </div>
</template>
