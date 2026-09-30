<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/vue";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { XMarkIcon } from "@silvicom/ui/icons";
import { useLiveScan, type LiveCapture } from "@/features/apply/capture/useLiveScan";
import type { LiveRefusal } from "@/features/apply/capture/liveFrame";
import type { PickedPhoto } from "@/features/apply/capture/webFileProvider";
import { pickImageFile, pickPhotoFromCamera } from "@/features/apply/capture/webImageIo";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The live licence scanner (2026-09-30): the rear camera inside the page, a card outline over it, and the
 * photograph taken for the driver — the back by its own barcode, the front by the button once the phone has
 * settled (`useLiveScan` says how, and why the front does not take itself).
 *
 * It is a PICKER: it resolves with one photograph, which then goes through the very pipeline a camera-app
 * photo does — the gate, the downscale, EXIF stripped, "Use this photo / Retake" (`useApplicationCaptures`).
 * So nothing here uploads, and nothing here decides what the office receives.
 *
 * ── THE CAMERA APP IS NEVER MORE THAN ONE PRESS AWAY ──────────────────────────────────────────
 * A refusal (camera denied, busy, too few pixels — `liveFrame.LiveRefusal`) says what happened and offers the
 * camera app and an upload, and so does the live view itself. Those two open from the driver's own press,
 * because a file input opened any other way is refused by the browser (it needs a user gesture).
 *
 * ⚠ `scheme-light` on the panel: `--scrim` stays dark in both schemes but `--ink-inverse` FLIPS to near-black
 * in dark mode, so without it this dark screen would print dark text in dark mode — the QR handoff's reason
 * (`PartOneHandoff`), met again.
 */
const props = defineProps<{ photo: "cdl_front" | "cdl_back" }>();
const emit = defineEmits<{
  captured: [photo: PickedPhoto];
  cancel: [];
  /** The scanner could not run on this phone; the page stops offering it (a busy camera is not this). */
  unavailable: [why: LiveRefusal];
}>();

const copy = APPLY_COPY.partOne.photo;
const live = copy.live;
const video = ref<HTMLVideoElement | null>(null);
const frame = ref<HTMLElement | null>(null);
const shutterButton = ref<{ $el: HTMLElement } | null>(null);

const scan = useLiveScan(video, {
  side: props.photo === "cdl_back" ? "back" : "front",
  outline: () => {
    const v = video.value;
    const f = frame.value;
    if (!v || !f || v.clientWidth === 0) return null;
    const vr = v.getBoundingClientRect();
    const fr = f.getBoundingClientRect();
    return {
      rect: { x: fr.left - vr.left, y: fr.top - vr.top, width: fr.width, height: fr.height },
      view: { width: vr.width, height: vr.height },
    };
  },
  // The barcode's licence is not passed on: the page reads it again from the kept photo after "Use this
  // photo" (`usePartOne`), the one path that fills answers — a second one here would be a second writer.
  onCapture: (c: LiveCapture) => emit("captured", { file: c.file, captureMode: "web_live_camera" }),
});

const status = computed<string | null>(() => {
  switch (scan.state.value) {
    case "starting": return live.starting;
    case "aiming": return live.aim[props.photo];
    case "settling": return live.settling;
    case "taking": return live.taking;
    default: return scan.refusal.value ? live.refused[scan.refusal.value] : null;
  }
});
const refused = computed(() => scan.state.value === "refused");

onMounted(async () => {
  await nextTick();
  await scan.start();
  // A busy camera may free up; the others will not on this page, so the page stops offering the scanner.
  const why = scan.refusal.value;
  if (why && why !== "busy") emit("unavailable", why);
});

/** The camera app or a picked photo, from the driver's press — the live camera is let go first. */
async function fallBack(to: "camera" | "file"): Promise<void> {
  scan.stop();
  const file = to === "camera" ? await pickPhotoFromCamera() : await pickImageFile("image/*");
  if (file) emit("captured", { file, captureMode: "web_file_input" });
  else if (!refused.value) void scan.start();
}

function close(): void {
  scan.stop();
  emit("cancel");
}
</script>

<template>
  <Dialog :open="true" class="relative z-dialog" :initial-focus="shutterButton?.$el" @close="close">
    <DialogPanel class="scheme-light fixed inset-0 flex flex-col bg-scrim text-ink-inverse" data-live-scanner>
      <div class="flex items-center justify-between gap-3 px-4 pt-4">
        <DialogTitle class="text-base font-semibold">{{ copy[photo].heading }}</DialogTitle>
        <BaseButton variant="ghost" size="touch" class="text-ink-inverse" :aria-label="live.close" @click="close">
          <AppIcon :icon="XMarkIcon" class="size-6" aria-hidden="true" />
        </BaseButton>
      </div>

      <div class="relative min-h-0 flex-1 overflow-hidden">
        <video
          ref="video"
          class="absolute inset-0 h-full w-full object-cover"
          autoplay
          muted
          playsinline
          :aria-label="live.videoLabel"
        />
        <!-- The outline: an ID-1 card (85.60 × 53.98 mm), the rest of the view dimmed around it. -->
        <div
          v-if="!refused"
          ref="frame"
          class="absolute left-1/2 top-1/2 aspect-[85.6/54] w-[88%] -translate-x-1/2 -translate-y-1/2 rounded-surface ring-2 ring-ink-inverse outline-[100vmax] outline-solid outline-scrim/55"
          data-live-outline
        />
      </div>

      <div class="space-y-3 px-4 pb-6 pt-4">
        <p class="min-h-10 text-center text-sm" aria-live="polite" :role="refused ? 'alert' : undefined">{{ status }}</p>
        <template v-if="refused">
          <BaseButton v-if="scan.refusal.value === 'busy'" variant="primary" size="touch" block @click="scan.start()">
            {{ live.tryAgain }}
          </BaseButton>
          <BaseButton :variant="scan.refusal.value === 'busy' ? 'secondary' : 'primary'" size="touch" block @click="fallBack('camera')">
            {{ live.cameraApp }}
          </BaseButton>
        </template>
        <template v-else>
          <BaseButton
            ref="shutterButton"
            variant="primary"
            size="touch"
            block
            :disabled="scan.state.value !== 'aiming'"
            data-live-shutter
            @click="scan.shutter()"
          >
            {{ live.shutter }}
          </BaseButton>
          <BaseButton variant="ghost" size="touch" block class="text-ink-inverse" @click="fallBack('camera')">
            {{ live.cameraApp }}
          </BaseButton>
        </template>
        <BaseButton variant="ghost" size="touch" block class="text-ink-inverse" @click="fallBack('file')">
          {{ live.upload }}
        </BaseButton>
      </div>
    </DialogPanel>
  </Dialog>
</template>
