<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/vue";
import { AppButton as BaseButton, AppIcon, countLabelFor } from "@silvicom/ui";
import { CameraOffIcon, CheckIcon, FlashlightIcon, FlashlightOffIcon, XMarkIcon } from "@silvicom/ui/icons";
import type { ReaderOptions } from "zxing-wasm/reader";
import { useBarcodeCamera, type BarcodeCameraOptions, type BarcodeCameraRefusal } from "@/lib/camera/useBarcodeCamera";

/**
 * The camera, full screen, reading barcodes — the fallback for when the shop's handheld is not near (M9c).
 * The read loop is `useBarcodeCamera`; this is its screen.
 *
 * ── AN OVERLAY, NEVER A ROUTE ─────────────────────────────────────────────────────────────────
 * An installed web app re-asks for the camera on navigation on iOS (D-INV17, `ScanPage.vue`), so the camera
 * opens over the screen that asked for it and closing it puts the person back exactly where they were — the
 * half-filled Add equipment form included.
 *
 * ⚠ **Opened from inside a drawer, it is rendered INSIDE the drawer's slot**, not beside it: HeadlessUI decides
 * which dialog owns Escape from the DOM tree, and two sibling dialogs both close on one press (memory
 * `sibling-dialogs-both-own-escape`). `StickerScanField` sits in `AssetForm`, in `AssetDrawer`'s slot, so it is.
 *
 * The default slot is drawn under the video: the sticker field puts its list of reads there, so the person
 * sees each barcode land without closing the camera.
 */
const props = defineProps<{
  title: string;
  /** One line under the video: what to aim at. */
  hint: string;
  reader: ReaderOptions;
  /** Close after the first read — the Scan page, where one code is one lookup. */
  once?: boolean;
  /** For a test: the camera and the decoder. */
  open?: BarcodeCameraOptions["open"];
  load?: BarcodeCameraOptions["load"];
}>();
const emit = defineEmits<{ read: [text: string]; close: [] }>();

const video = ref<HTMLVideoElement | null>(null);
const box = ref<HTMLElement | null>(null);
const view = ref<HTMLElement | null>(null);

const cam = useBarcodeCamera(video, {
  reader: props.reader,
  once: props.once,
  open: props.open,
  load: props.load,
  onRead: (text) => {
    emit("read", text);
    if (props.once) emit("close");
  },
  aim: () => {
    const b = box.value?.getBoundingClientRect();
    const v = view.value?.getBoundingClientRect();
    if (!b || !v || v.width === 0 || v.height === 0) return null;
    return { rect: { x: b.left - v.left, y: b.top - v.top, width: b.width, height: b.height }, view: { width: v.width, height: v.height } };
  },
});

const REFUSED: Record<BarcodeCameraRefusal, string> = {
  unsupported: "This browser can't use the camera here. Use the handheld scanner, or type the code.",
  denied: "The camera is turned off for this site. Allow it in the browser's settings, or use the handheld scanner.",
  no_camera: "No camera answered. Use the handheld scanner, or type the code.",
  busy: "Another app is using the camera. Close it and try again.",
  // Never reached on the shop's camera — it has no resolution floor — but the type is `/apply`'s too.
  too_low: "This camera's picture is too small to read a barcode. Use the handheld scanner.",
  no_reader: "The barcode reader could not load — check the connection. Use the handheld scanner, or type the code.",
};

const refused = computed(() => cam.state.value === "refused");
const status = computed(() => {
  if (cam.state.value === "starting") return "Starting the camera…";
  const n = cam.reads.value;
  return n === 0 ? props.hint : `${n} ${countLabelFor(n, "barcodes")} read — aim at the next one, or press Done.`;
});

function close(): void {
  cam.stop();
  emit("close");
}

// The dialog draws its panel — and so the `<video>` — a tick after this component mounts, as `/apply`'s
// `LiveScanner` found; starting before it would find no video and do nothing.
onMounted(async () => {
  await nextTick();
  await cam.start();
});
</script>

<template>
  <Dialog :open="true" class="relative z-dialog" @close="close">
    <DialogPanel class="scheme-light fixed inset-0 flex flex-col bg-scrim text-ink-inverse" data-barcode-camera>
      <div class="flex items-center justify-between gap-3 px-4 pt-4">
        <DialogTitle class="text-base font-semibold">{{ title }}</DialogTitle>
        <div class="flex items-center gap-2">
          <BaseButton
            v-if="cam.torchAvailable.value"
            variant="inverse"
            size="touch"
            :aria-label="cam.torchOn.value ? 'Turn the light off' : 'Turn the light on'"
            :aria-pressed="cam.torchOn.value"
            @click="cam.toggleTorch()"
          >
            <AppIcon :icon="cam.torchOn.value ? FlashlightIcon : FlashlightOffIcon" class="size-6" aria-hidden="true" />
          </BaseButton>
          <BaseButton variant="inverse" size="touch" aria-label="Close the camera" @click="close">
            <AppIcon :icon="XMarkIcon" class="size-6" aria-hidden="true" />
          </BaseButton>
        </div>
      </div>

      <div ref="view" class="relative mt-4 min-h-0 flex-1 overflow-hidden">
        <video ref="video" class="absolute inset-0 h-full w-full object-cover" autoplay muted playsinline aria-label="The camera's picture" />
        <!-- The aiming strip: wide and short, the shape of a sticker's barcode. Only what is under it is read,
             so the rest of the view is dimmed (`useBarcodeCamera`'s `aim`). -->
        <div
          v-if="!refused"
          ref="box"
          class="absolute left-1/2 top-1/2 h-[28%] w-[88%] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-surface ring-4 ring-brand-400 outline-[100vmax] outline-solid outline-scrim/55"
          data-barcode-aim
        >
          <span v-if="cam.state.value === 'reading'" class="scan-sweep absolute inset-x-3 h-0.5 rounded-full bg-brand-400" aria-hidden="true" />
        </div>
        <div v-else class="absolute inset-0 grid place-items-center px-6">
          <div class="rounded-surface bg-scrim/80 p-4 text-center ring-1 ring-ink-inverse/40">
            <AppIcon :icon="CameraOffIcon" class="mx-auto mb-2 size-8 text-danger-400" aria-hidden="true" />
            <p class="text-sm" role="alert" data-barcode-refusal>{{ cam.refusal.value ? REFUSED[cam.refusal.value] : "" }}</p>
          </div>
        </div>
      </div>

      <div class="space-y-3 px-4 pb-6 pt-4">
        <p v-if="!refused" class="flex min-h-10 items-center justify-center gap-2 text-center text-sm" aria-live="polite" data-barcode-status>
          <AppIcon v-if="cam.reads.value > 0" :icon="CheckIcon" class="size-5 text-success-400" aria-hidden="true" />
          {{ status }}
        </p>
        <slot />
        <BaseButton v-if="cam.refusal.value === 'busy' || cam.refusal.value === 'no_reader'" variant="primary" size="touch" block @click="cam.start()">
          Try again
        </BaseButton>
        <BaseButton :variant="refused ? 'inverse' : 'primary'" size="touch" block @click="close">Done</BaseButton>
      </div>
    </DialogPanel>
  </Dialog>
</template>

<style scoped>
/* The same sweep `/apply`'s scanner draws over the licence's back: a reader that is visibly working. */
.scan-sweep {
  top: 8%;
  animation: scan-sweep 1.6s ease-in-out infinite alternate;
}
@keyframes scan-sweep {
  to {
    top: 90%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .scan-sweep {
    animation: none;
    top: 50%;
  }
}
</style>
