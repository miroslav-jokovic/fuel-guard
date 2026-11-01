<script setup lang="ts">
import { computed, toRef } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import type { ApplicationCaptureSlot, ApplicationCaptureView } from "@silvicom/shared";
import { useApplicationCaptures } from "@/features/apply/capture/useApplicationCaptures";
import {
  useDocumentSends,
  type DocumentGroupView,
  type DocumentPlaceView,
} from "@/features/apply/capture/useDocumentSends";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The capture screen (A8) — and, since §9 P9, Part 2's "Your documents": every paper offered, photo or PDF.
 *
 * ── WHY A REFUSED PHOTOGRAPH IS THE MOST IMPORTANT STATE ON THIS SCREEN ───────────────────────
 * The gate runs in the browser before anything is uploaded (A7), so the common case is a driver in a
 * truck-stop car park being told to move away from the light and try again — and being told that in
 * a tenth of a second, at no cost in bytes. Every rejection therefore names what to fix. "That did
 * not work" would send the driver to a support call the carrier cannot answer either.
 *
 * ── AND WHY NOTHING HERE IS REQUIRED ──────────────────────────────────────────────────────────
 * §391.21 is a form and none of its twelve paragraphs is a photograph; §391.51's file is assembled
 * over the whole hiring process. A driver whose camera will not open must still be able to certify
 * and send, or the carrier loses the candidate over a picture a recruiter can ask for by email.
 */
const props = defineProps<{
  token: string;
  captures: ApplicationCaptureView[];
  /**
   * Just these slots, with the caller saying what they are for (AF3: the licence's two sides, on
   * the identity step). The screen's own introduction is about the whole set, so it is left out.
   */
  only?: readonly ApplicationCaptureSlot[];
  /** Passed through to `useApplicationCaptures` — the original of each photograph once it is staged (AW5). */
  onStaged?: (slot: ApplicationCaptureSlot, original: Blob) => void;
}>();

const copy = APPLY_COPY.documents;
/**
 * Two lists, one component: `only` is the identity step's licence sides (take, look, send — one
 * photograph per slot); without it this is Part 2's "Your documents" (§9 P9), keyed by place, photo or
 * PDF, several of the papers that come in several. See `useDocumentSends` for why they are two.
 */
const captures = props.only
  ? useApplicationCaptures(toRef(props, "token"), toRef(props, "captures"), {
      only: props.only,
      ...(props.onStaged ? { onStaged: props.onStaged } : {}),
    })
  : null;
const documents = props.only ? null : useDocumentSends(toRef(props, "token"), toRef(props, "captures"));
const anyBusy = computed(() => (captures?.busy.value ?? documents?.busy.value ?? null) !== null);

/** What a place says under its name, in the driver's words. */
function status(place: DocumentPlaceView): string | null {
  if (place.state === "done") return place.contentType === "application/pdf" ? copy.pdfDone : copy.done;
  if (place.state === "rejected" && place.reason) return copy.rejected[place.reason];
  if (place.state === "failed") {
    if (place.failure === "not_intact") return copy.notIntact;
    if (place.failure === "too_large") return copy.tooLarge;
    return copy.failed;
  }
  return null;
}
const placeLabel = (group: DocumentGroupView, place: DocumentPlaceView): string =>
  group.places.length > 1 || place.ordinal > 0 ? copy.numbered(group.label, place.ordinal + 1) : group.label;
</script>

<template>
  <div v-if="documents" class="space-y-4">
    <div>
      <p class="text-sm text-ink">{{ copy.intro }}</p>
      <p class="mt-1 text-sm text-ink-muted">{{ copy.optional }}</p>
    </div>

    <ul class="space-y-3">
      <li
        v-for="group in documents.groups.value"
        :key="group.slot"
        class="space-y-3 rounded-surface bg-surface-muted p-4"
        :data-document-slot="group.slot"
      >
        <div
          v-for="place in group.places"
          :key="place.ordinal"
          class="flex flex-wrap items-center justify-between gap-3"
        >
          <img
            v-if="place.previewUrl"
            :src="place.previewUrl"
            :alt="placeLabel(group, place)"
            class="h-14 w-20 shrink-0 rounded-detail object-cover ring-1 ring-inset ring-edge"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-ink">{{ placeLabel(group, place) }}</p>
            <!-- §4.7: the licence Part 1 took is shown as received, and never asked for again. -->
            <p v-if="group.fromPartOne && place.state === 'done'" class="mt-1 text-sm text-ink-muted">
              {{ copy.fromLicenceStep }}
            </p>
            <p v-else-if="status(place)" class="mt-1 text-sm text-ink-secondary">{{ status(place) }}</p>
          </div>
          <div v-if="!(group.fromPartOne && place.state === 'done')" class="flex flex-wrap gap-2">
            <BaseButton
              :variant="place.state === 'done' ? 'ghost' : 'secondary'"
              :disabled="anyBusy"
              @click="documents.photo(place)"
            >
              <template v-if="place.state === 'working'">{{ copy.working }}</template>
              <template v-else-if="place.state === 'done'">{{ copy.retake }}</template>
              <template v-else>{{ copy.take }}</template>
            </BaseButton>
            <BaseButton variant="ghost" :disabled="anyBusy" @click="documents.file(place)">
              {{ place.state === "done" ? copy.uploadAgain : copy.upload }}
            </BaseButton>
          </div>
        </div>
        <!-- 0534: up to five of a paper that comes in several. -->
        <div v-if="group.next !== null" class="flex flex-wrap items-center gap-2">
          <p class="min-w-0 flex-1 text-sm text-ink-muted">{{ copy.addAnother }}</p>
          <BaseButton
            variant="secondary"
            :disabled="anyBusy"
            @click="documents.photo({ slot: group.slot, ordinal: group.next })"
          >
            {{ copy.take }}
          </BaseButton>
          <BaseButton variant="ghost" :disabled="anyBusy" @click="documents.file({ slot: group.slot, ordinal: group.next })">
            {{ copy.upload }}
          </BaseButton>
        </div>
      </li>
    </ul>
  </div>

  <div v-else-if="captures" class="space-y-4">
    <ul class="space-y-3">
      <li
        v-for="slot in captures.slots.value"
        :key="slot.slot"
        class="flex flex-wrap items-center justify-between gap-3 rounded-surface bg-surface-muted p-4"
      >
        <!-- ⚠ The picture, when this browser is the one that took it (X6). A driver who
             photographed the wrong side of a licence had no way to know: the slot said "Received"
             and nothing else, and the server returns slots and dates rather than pictures on
             purpose — re-serving them would mean a signed read URL per slot on an unauthenticated
             surface on every page load. So this is what is in THIS browser's hands, and a capture
             from a previous visit correctly shows none. -->
        <img
          v-if="slot.previewUrl"
          :src="slot.previewUrl"
          :alt="slot.label"
          class="h-14 w-20 shrink-0 rounded-detail object-cover ring-1 ring-inset ring-edge"
        />
        <!-- `flex-1` so the thumbnail and the label stay together on the left and the button keeps
             the right; without it `justify-between` strands the text in the middle of the row. -->
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-ink">{{ slot.label }}</p>
          <p v-if="slot.state === 'done'" class="mt-1 text-sm text-ink-muted">{{ copy.done }}</p>
          <!-- The gate's verdict, in the driver's words. `reason` is always one of the taxonomy's
               members, and the copy map is total over it, so this cannot render a blank. -->
          <p v-else-if="slot.state === 'rejected' && slot.reason" class="mt-1 text-sm text-ink-secondary">
            {{ copy.rejected[slot.reason] }}
          </p>
          <p v-else-if="slot.state === 'failed'" class="mt-1 text-sm text-ink-secondary">
            {{ slot.failure === "not_intact" ? copy.notIntact : copy.failed }}
          </p>
        </div>
        <BaseButton
          :variant="slot.state === 'done' ? 'ghost' : 'secondary'"
          :disabled="anyBusy"
          @click="captures.capture(slot.slot)"
        >
          <template v-if="slot.state === 'working'">{{ copy.working }}</template>
          <template v-else-if="slot.state === 'done'">{{ copy.retake }}</template>
          <template v-else>{{ copy.take }}</template>
        </BaseButton>
      </li>
    </ul>
  </div>
</template>
