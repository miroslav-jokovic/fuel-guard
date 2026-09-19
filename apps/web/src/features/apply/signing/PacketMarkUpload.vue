<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { pickImageFile } from "@/features/apply/capture/webImageIo";
import {
  UPLOADED_MARK_ACCEPT,
  normaliseUploadedMark,
  type UploadedMarkFailure,
} from "@/features/apply/signing/markUpload";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * **Upload** — the third of C2's tabs, and the only one with no code behind it before this step.
 *
 * A driver who already has a picture of their signature — scanned once, kept in their photos, used on
 * every other carrier's paperwork — hands it over here. `markUpload.ts` carries the four reasons the
 * file is never staged as it arrived, and every one of them is a way the filed packet would have come
 * out different from the screen.
 *
 * ── ⚠ WHY THIS IS NOT `FileDropzone` ──────────────────────────────────────────────────────────
 * `FileDropzone` is the office's control: it stages a document as given, on a desktop, with a drag
 * target. Nothing here matches it. This runs on a phone where there is nothing to drag, it takes one
 * image rather than a list, and the bytes it produces are not the bytes it was handed — so a dropzone
 * showing a filename and a tick would be reporting on a file that is not what gets filed. What the
 * driver needs to see is the PICTURE after cleaning, which is a different control with a different
 * job. Recorded here rather than assumed, because reaching for the shared primitive is normally the
 * right instinct in this repo.
 */
const emit = defineEmits<{
  /** The cleaned PNG, or null whenever there is not one — including while a file is being read. */
  change: [Blob | null];
}>();

const copy = APPLY_COPY.packet;

const previewUrl = ref<string | null>(null);
const failure = ref<UploadedMarkFailure | null>(null);
const reading = ref(false);

function show(blob: Blob | null): void {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = blob ? URL.createObjectURL(blob) : null;
}

/**
 * ⚠ **The parent is told `null` the moment a new file arrives, before it has been read.**
 *
 * Without it there is a window — a decode plus a `getImageData` plus a `toBlob`, which on a phone with
 * a 12-megapixel photograph is not instant — in which the previous upload is still the parent's
 * `markBlob`. A driver who replaced a bad photograph and pressed straight through in that window would
 * file the picture they had just rejected. `working` cannot cover this: it belongs to the WALK and is
 * shared with `sign()`, and A3's note on it is explicit that staging and filing must never both be in
 * flight — this is neither.
 */
async function choose(): Promise<void> {
  const file = await pickImageFile(UPLOADED_MARK_ACCEPT);
  // The picker was dismissed. Leave whatever was already chosen exactly as it was — a driver who
  // opened the picker to look and changed their mind has not withdrawn the picture they already had.
  if (!file) return;

  reading.value = true;
  failure.value = null;
  show(null);
  emit("change", null);

  const result = await normaliseUploadedMark(file);
  reading.value = false;
  if (typeof result === "string") {
    failure.value = result;
    return;
  }
  show(result.blob);
  emit("change", result.blob);
}

onBeforeUnmount(() => show(null));
</script>

<template>
  <div class="space-y-3">
    <div>
      <p class="text-sm text-ink">{{ copy.uploadLabel }}</p>
      <p class="mt-1 text-xs text-ink-muted">{{ copy.uploadHint }}</p>
    </div>

    <!-- ⚠ The picker is built, clicked and thrown away by `pickImageFile` rather than living in this
         template: `lint:ui-adoption` allows no raw `<input>` in a feature, and the licence-capture
         screen already solved the same problem the same way. -->
    <div class="flex items-center gap-2">
      <BaseButton variant="secondary" :disabled="reading" @click="choose">
        {{ reading ? copy.uploadReading : previewUrl ? copy.uploadReplace : copy.uploadChoose }}
      </BaseButton>
    </div>

    <!--
      ⚠ The CLEANED picture, which is the one that goes on the form — not the file the driver chose.
      The paper behind it has been made transparent and the empty margin trimmed off, and both change
      what the packet prints, so a preview of the original would be previewing something no document
      will ever contain.
    -->
    <div v-if="previewUrl">
      <p class="text-sm text-ink-muted">{{ copy.uploadPreviewLabel }}</p>
      <!-- ⚠ `h-10`, the printed ratio of a mark to typed text — see `PacketAdoption.vue`. -->
      <img
        :src="previewUrl"
        alt=""
        class="mt-1 h-10 w-auto max-w-full object-contain object-left"
      />
    </div>

    <!-- ⚠ Three outcomes, three sentences. "We could not read that" sent at a driver whose camera
         worked perfectly and whose sheet was blank is advice they cannot act on. -->
    <p v-if="failure" class="text-sm text-ink-secondary">{{ copy.uploadFailed[failure] }}</p>
    <p v-else-if="!previewUrl && !reading" class="text-sm text-ink-secondary">
      {{ copy.uploadNeeded }}
    </p>
  </div>
</template>
