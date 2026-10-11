<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/vue";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import {
  CameraOffIcon,
  CheckIcon,
  DevicePhoneMobileIcon,
  FaceIcon,
  FlashlightIcon,
  FlashlightOffIcon,
  FrameCornersIcon,
  GlareIcon,
  HatGlassesIcon,
  IdCardIcon,
  LightIcon,
  MedicalCardIcon,
  ScanIcon,
  XMarkIcon,
} from "@silvicom/ui/icons";
import { useLiveScan, type LiveCapture } from "@/features/apply/capture/useLiveScan";
import {
  LIVE_SLOTS,
  mirrored,
  SHUTTER_DEADLINE_MS,
  TAKEN_HOLD_MS,
  tipsKind,
  type LiveRefusal,
  type LiveSlot,
} from "@/features/apply/capture/liveFrame";
import type { PickedPhoto } from "@/features/apply/capture/webFileProvider";
import { pickImageFile, pickPhotoFromCamera, uploadAccept } from "@/features/apply/capture/webImageIo";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The live scanner (2026-09-30): the camera inside the page, an outline of the document over it, and the
 * photograph taken for the driver — the CDL's back by its own barcode, everything else by the button once
 * the phone has settled (`useLiveScan` says how, and why only the back takes itself).
 *
 * ── ONE SCANNER FOR ALL FOUR (owner, 2026-09-30, Q-AW53) ──────────────────────────────────────
 * It began as the CDL's; the owner ruled the same day that the four Part 1 photo screens look and behave
 * the same, so the medical card and the selfie open it too. What differs is read from `liveFrame.LIVE_SLOTS`,
 * never decided here: the CDL's ID-1 card outline, the medical card's letter-size page, the selfie's oval on
 * the FRONT camera with its preview mirrored (`liveFrame.mirrored` — the preview only, never the photograph).
 * The flashlight is offered on the rear camera only; a front camera has no torch to light the driver with.
 *
 * ⚠ The medical card's page is an AIMING GUIDE, nothing more. Nothing finds the page's edges or squares
 * it up — that is Q-AW53's option (a), a multi-MB OpenCV download, not chosen. The photograph is cut to the
 * outline with a margin, like the card, and "Use this photo / Retake" is where a crooked page is caught.
 *
 * It is a PICKER: it resolves with one photograph, which then goes through the very pipeline a camera-app
 * photo does — the gate, the downscale, EXIF stripped, "Use this photo / Retake" (`useApplicationCaptures`).
 * So nothing here uploads, and nothing here decides what the office receives.
 *
 * ── WHY IT LOOKS LIKE A SCANNER (owner approved the mock, 2026-09-30) ─────────────────────────────
 * The look is the one ID scanners have taught people (BlinkID, Scandit, Scanbot): corner brackets rather than
 * a box, a chip naming the side, a round shutter. The brackets carry the state, so the driver reads it
 * without reading the line under it — white while aiming, the brand colour pulsing while the shutter waits
 * for the phone to settle, green with a check once it is taken. That last moment is held for
 * `TAKEN_HOLD_MS` with the very frame kept shown inside the corners, plus a short buzz where the phone allows
 * one (Android; iOS Safari has no `navigator.vibrate`). Tips come first, ONCE a visit (`tips`, owned by
 * `scannerTips.ts`): glare, a busy background and a card too small are the three bad photos, and they are
 * cheaper to prevent than to retake.
 *
 * ⚠ Nothing here says "move closer", "too dark" or "glare" about the live picture. Each needs a fixed quality
 * floor, which D-SCAN10 and Q-AW32 hold back until recorded samples exist; the tips say it in advance instead.
 *
 * ── THE CAMERA APP IS NEVER MORE THAN ONE PRESS AWAY ──────────────────────────────────────────
 * On the tips, in the live view and after a refusal (camera denied, busy, too few pixels —
 * `liveFrame.LiveRefusal`) the camera app and an upload are both on screen. They open from the driver's own
 * press, because a file input opened any other way is refused by the browser (it needs a user gesture).
 *
 * ⚠ `scheme-light` on the panel: `--scrim` stays dark in both schemes but `--ink-inverse` FLIPS to near-black
 * in dark mode, so without it this dark screen would print dark text in dark mode — the QR handoff's reason
 * (`PartOneHandoff`), met again.
 */
const props = defineProps<{
  photo: LiveSlot;
  /** Show the tips before the camera opens — the first scanner of this kind this visit (`scannerTips.ts`). */
  tips?: boolean;
}>();
const emit = defineEmits<{
  captured: [photo: PickedPhoto];
  cancel: [];
  /** The scanner could not run on this phone; the page stops offering it (a busy camera is not this). */
  unavailable: [why: LiveRefusal];
  /** The driver went past the tips, so the page does not show them again this visit. */
  tipsSeen: [];
}>();

/** The buzz on Android: one short tap, the length a phone's own keyboard uses. */
const TAKEN_BUZZ_MS = 40;

const copy = APPLY_COPY.partOne.photo;
const live = copy.live;
const kind = LIVE_SLOTS[props.photo];
const mirror = mirrored(props.photo);
const face = kind.outline === "face";
const video = ref<HTMLVideoElement | null>(null);
const frame = ref<HTMLElement | null>(null);
const shutterButton = ref<{ $el: HTMLElement } | null>(null);
const openButton = ref<{ $el: HTMLElement } | null>(null);

/** Read once: the page decides at open whether this visit has seen the tips, and pressing past them is final. */
const tipsOpen = ref(Boolean(props.tips));
/** The photograph taken, held on screen for `TAKEN_HOLD_MS` before it is handed on. */
const taken = ref<{ file: File; preview: string } | null>(null);
let hold: ReturnType<typeof setTimeout> | undefined;

const scan = useLiveScan(video, {
  slot: props.photo,
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
  onCapture: (c: LiveCapture) => {
    taken.value = { file: c.file, preview: URL.createObjectURL(c.file) };
    if (typeof navigator.vibrate === "function") navigator.vibrate(TAKEN_BUZZ_MS);
    hold = setTimeout(() => emit("captured", { file: c.file, captureMode: "web_live_camera" }), TAKEN_HOLD_MS);
  },
});

const refused = computed(() => scan.state.value === "refused");
const status = computed<string | null>(() => {
  if (taken.value) return live.taking;
  switch (scan.state.value) {
    case "starting": return live.starting;
    case "aiming": return live.aim[props.photo];
    case "settling": return live.settling;
    case "taking": return live.taking;
    default: return null;
  }
});
/** The brackets carry the state: white aiming, the brand colour while settling, green once taken. */
const bracketTone = computed(() =>
  taken.value ? "border-success-400" : scan.state.value === "settling" ? "border-brand-400 animate-pulse" : "border-ink-inverse",
);
const CORNERS = [
  "-left-1 -top-1 border-l-4 border-t-4 rounded-tl-surface",
  "-right-1 -top-1 border-r-4 border-t-4 rounded-tr-surface",
  "-bottom-1 -left-1 border-b-4 border-l-4 rounded-bl-surface",
  "-bottom-1 -right-1 border-b-4 border-r-4 rounded-br-surface",
] as const;
const TIPS = {
  document: [
    { icon: IdCardIcon, text: live.tips.flat },
    { icon: GlareIcon, text: live.tips.glare },
    { icon: FrameCornersIcon, text: live.tips.fill },
  ],
  face: [
    { icon: DevicePhoneMobileIcon, text: live.tips.arm },
    { icon: HatGlassesIcon, text: live.tips.uncovered },
    { icon: LightIcon, text: live.tips.light },
  ],
}[tipsKind(props.photo)];
/** What the tips and the chip above the frame show: the thing being photographed. */
const SUBJECT_ICON = { cdl_front: IdCardIcon, cdl_back: ScanIcon, medical_card: MedicalCardIcon, selfie: FaceIcon }[props.photo];
/**
 * The outline, the document's own shape. The page and the oval are sized against BOTH sides of the view
 * (container units on the view, `cqw`/`cqh`), because a tall shape fitted to the width alone runs off the
 * bottom of a short phone — measured in the built app, 375 × 667 leaves a view 391 px tall, and an 8.5 × 11
 * page 88% wide would be 427 (it is 242 × 313 there instead).
 * The card is wide enough that the width always binds, so it keeps the size the owner approved.
 */
const OUTLINE_SHAPE = {
  card: "aspect-[85.6/54] w-[88%] rounded-surface",
  page: "aspect-[8.5/11] w-[min(88cqw,calc(80cqh*8.5/11))] rounded-surface",
  face: "aspect-[3/4] w-[min(80cqw,calc(84cqh*3/4))] rounded-full",
}[kind.outline];
/** The rear camera only: the light is beside the rear lens, so it lights a document and never the driver. */
const torchOffered = computed(() => kind.facing === "environment" && scan.torchAvailable.value);

async function begin(): Promise<void> {
  await nextTick();
  await scan.start();
  // A busy camera may free up; the others will not on this page, so the page stops offering the scanner.
  const why = scan.refusal.value;
  if (why && why !== "busy") emit("unavailable", why);
}

onMounted(() => {
  if (!tipsOpen.value) void begin();
});

function pastTips(): void {
  tipsOpen.value = false;
  emit("tipsSeen");
  void begin();
}

/** The camera app or a picked photo, from the driver's press — the live camera is let go first. */
async function fallBack(to: "camera" | "file"): Promise<void> {
  scan.stop();
  const file = to === "camera" ? await pickPhotoFromCamera(kind.facing) : await pickImageFile(uploadAccept(props.photo));
  if (file) emit("captured", { file, captureMode: "web_file_input" });
  else if (!refused.value && !tipsOpen.value) void scan.start();
}

function close(): void {
  clearTimeout(hold);
  scan.stop();
  emit("cancel");
}

onBeforeUnmount(() => {
  clearTimeout(hold);
  if (taken.value) URL.revokeObjectURL(taken.value.preview);
});
</script>

<template>
  <Dialog
    :open="true"
    class="relative z-dialog"
    :initial-focus="(tipsOpen ? openButton : shutterButton)?.$el"
    @close="close"
  >
    <DialogPanel class="scheme-light fixed inset-0 flex flex-col bg-scrim text-ink-inverse" data-live-scanner>
      <div class="flex items-center justify-between gap-3 px-4 pt-4">
        <DialogTitle class="text-base font-semibold">{{ tipsOpen ? live.tips.heading[photo] : copy[photo].heading }}</DialogTitle>
        <div class="flex items-center gap-2">
          <BaseButton
            v-if="torchOffered && !taken"
            variant="inverse"
            size="touch"
            :aria-label="scan.torchOn.value ? live.torchOn : live.torchOff"
            :aria-pressed="scan.torchOn.value"
            data-live-torch
            @click="scan.toggleTorch()"
          >
            <AppIcon :icon="scan.torchOn.value ? FlashlightIcon : FlashlightOffIcon" class="size-6" aria-hidden="true" />
          </BaseButton>
          <BaseButton variant="inverse" size="touch" :aria-label="live.close" @click="close">
            <AppIcon :icon="XMarkIcon" class="size-6" aria-hidden="true" />
          </BaseButton>
        </div>
      </div>

      <!-- The tips, once a visit, before the camera is asked for. -->
      <template v-if="tipsOpen">
        <div class="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-5 py-4" :data-live-tips="tipsKind(photo)">
          <div class="mx-auto grid size-24 place-items-center rounded-surface bg-scrim/60 ring-1 ring-ink-inverse/40">
            <AppIcon :icon="SUBJECT_ICON" class="size-12" aria-hidden="true" />
          </div>
          <ul class="mt-6 space-y-4">
            <li v-for="tip in TIPS" :key="tip.text" class="flex items-center gap-3 text-sm">
              <span class="grid size-9 shrink-0 place-items-center rounded-control ring-1 ring-ink-inverse/40">
                <AppIcon :icon="tip.icon" class="size-5" aria-hidden="true" />
              </span>
              {{ tip.text }}
            </li>
          </ul>
        </div>
        <div class="space-y-2 px-4 pb-6 pt-4">
          <BaseButton ref="openButton" variant="primary" size="touch" block @click="pastTips">{{ live.tips.open }}</BaseButton>
          <div class="grid grid-cols-2 gap-2">
            <BaseButton variant="inverse" size="touch" @click="fallBack('camera')">{{ live.cameraAppShort }}</BaseButton>
            <BaseButton variant="inverse" size="touch" @click="fallBack('file')">{{ live.uploadShort }}</BaseButton>
          </div>
        </div>
      </template>

      <template v-else>
        <!-- `container-type: size` so the outline can be sized against the view's height as well (`OUTLINE_SHAPE`). -->
        <div class="relative min-h-0 flex-1 overflow-hidden [container-type:size]">
          <!-- Mirrored for the selfie by CSS alone: the pixels the photograph is cut from are never flipped. -->
          <video
            ref="video"
            class="absolute inset-0 h-full w-full object-cover"
            :class="{ '-scale-x-100': mirror }"
            :data-live-mirrored="mirror || undefined"
            autoplay
            muted
            playsinline
            :aria-label="live.videoLabel"
          />
          <template v-if="!refused">
            <!-- The outline (`OUTLINE_SHAPE`), the rest of the view dimmed around it. Centred, which is what lets
                 the selfie's mirrored preview and its unmirrored crop agree (`liveFrame.viewRectToVideo`). -->
            <div
              ref="frame"
              class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 outline-[100vmax] outline-solid outline-scrim/55"
              :class="OUTLINE_SHAPE"
              :data-live-outline="kind.outline"
            >
              <!-- The frame kept, shown as the preview showed it — mirrored for the selfie, so the moment it is
                   taken does not flip; "Use this photo / Retake" then shows the photograph as it was saved. -->
              <img
                v-if="taken"
                :src="taken.preview"
                alt=""
                class="absolute inset-0 h-full w-full object-cover"
                :class="[face ? 'rounded-full' : 'rounded-surface', { '-scale-x-100': mirror }]"
              />
              <!-- A face's outline is the oval itself, carrying the same state colours as a document's corners. -->
              <span
                v-if="face"
                class="absolute -inset-1 rounded-full border-4 transition-colors"
                :class="bracketTone"
                aria-hidden="true"
                data-live-oval
              />
              <template v-else>
                <span
                  v-for="corner in CORNERS"
                  :key="corner"
                  class="absolute aspect-square w-1/5 transition-colors"
                  :class="[corner, bracketTone]"
                  aria-hidden="true"
                />
              </template>
              <!-- The back is read live: a soft line sweeps the card so a driver can see it is working. -->
              <span
                v-if="kind.reads && scan.state.value === 'aiming'"
                class="scan-sweep absolute inset-x-3 h-0.5 rounded-full bg-brand-400"
                aria-hidden="true"
              />
              <template v-if="taken">
                <span
                  class="taken-flash pointer-events-none absolute inset-0 bg-ink-inverse"
                  :class="face ? 'rounded-full' : 'rounded-surface'"
                  aria-hidden="true"
                />
                <span
                  class="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-success-500"
                  data-live-taken
                >
                  <AppIcon :icon="CheckIcon" class="size-9" aria-hidden="true" />
                </span>
              </template>
            </div>
            <!-- How long the shutter will wait for the phone to settle (`liveFrame.SHUTTER_DEADLINE_MS`). -->
            <div
              v-if="scan.state.value === 'settling' && !taken"
              class="absolute bottom-4 left-1/2 h-1 w-[80%] -translate-x-1/2 overflow-hidden rounded-full bg-scrim/60"
              aria-hidden="true"
            >
              <div class="settle-fill h-full bg-brand-400" :style="{ animationDuration: `${SHUTTER_DEADLINE_MS}ms` }" />
            </div>
            <p
              v-if="!taken"
              class="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-scrim/80 py-1.5 pl-2.5 pr-3 text-xs font-semibold"
              data-live-side
            >
              <AppIcon :icon="SUBJECT_ICON" class="size-5" aria-hidden="true" />
              {{ live.side[photo] }}
            </p>
          </template>
          <div v-else class="absolute inset-0 grid place-items-center px-6">
            <div class="rounded-surface bg-scrim/80 p-4 text-center ring-1 ring-ink-inverse/40">
              <AppIcon :icon="CameraOffIcon" class="mx-auto mb-2 size-8 text-danger-400" aria-hidden="true" />
              <p class="text-sm" role="alert">{{ scan.refusal.value ? live.refused[scan.refusal.value] : "" }}</p>
            </div>
          </div>
        </div>

        <div class="space-y-3 px-4 pb-6 pt-4">
          <template v-if="refused">
            <BaseButton v-if="scan.refusal.value === 'busy'" variant="primary" size="touch" block @click="scan.start()">
              {{ live.tryAgain }}
            </BaseButton>
            <BaseButton :variant="scan.refusal.value === 'busy' ? 'secondary' : 'primary'" size="touch" block @click="fallBack('camera')">
              {{ live.cameraApp }}
            </BaseButton>
            <BaseButton variant="inverse" size="touch" block @click="fallBack('file')">
              {{ live.upload }}
            </BaseButton>
          </template>
          <template v-else>
            <p
              class="grid min-h-10 place-items-center text-center"
              :class="taken || scan.state.value === 'settling' ? 'text-base font-semibold' : 'text-sm'"
              aria-live="polite"
            >
              {{ status }}
            </p>
            <div class="flex justify-center" :class="{ invisible: taken }">
              <BaseButton
                ref="shutterButton"
                variant="primary"
                size="shutter"
                class="ring-4 ring-ink-inverse ring-offset-4 ring-offset-scrim"
                :aria-label="live.shutter"
                :disabled="scan.state.value !== 'aiming'"
                data-live-shutter
                @click="scan.shutter()"
              />
            </div>
            <div class="grid grid-cols-2 gap-2" :class="{ invisible: taken }">
              <BaseButton variant="inverse" size="touch" @click="fallBack('camera')">{{ live.cameraAppShort }}</BaseButton>
              <BaseButton variant="inverse" size="touch" @click="fallBack('file')">{{ live.uploadShort }}</BaseButton>
            </div>
          </template>
        </div>
      </template>
    </DialogPanel>
  </Dialog>
</template>

<style scoped>
/* Decorative motion only: the reduced-motion rule in style.css stills all three, and the status line under
   the view says the same thing in words. */
.scan-sweep {
  top: 8%;
  animation: scan-sweep 1.6s ease-in-out infinite alternate;
}
@keyframes scan-sweep {
  to {
    top: 90%;
  }
}
.settle-fill {
  width: 0;
  animation: settle-fill linear forwards;
}
@keyframes settle-fill {
  to {
    width: 100%;
  }
}
.taken-flash {
  opacity: 0;
  animation: taken-flash 0.35s ease-out;
}
@keyframes taken-flash {
  from {
    opacity: 0.6;
  }
}
</style>
