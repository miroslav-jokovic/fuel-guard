<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";

/**
 * A place to draw a signature — with a finger on a phone (A8b, D-APP7/D-APP8) or with a mouse at the
 * office (Q-AW45 (a)).
 *
 * ── TWO KINDS OF SIGNER, ONE PAD ──────────────────────────────────────────────────────────────
 * It was the applicant's, under `features/apply/signing/`. Q-AW45 gave the carrier's Representative
 * and road-test examiner a drawn signature in place of an uploaded PNG (the owner, 2026-09-28: "We
 * don't want to upload some PNG file with signature"), and `lint:boundaries` forbids the recruitment
 * feature reaching into the apply feature — so the pad moved here rather than being written twice.
 * It carries no words of its own: the applicant's are in `APPLY_COPY` (and will be translated with
 * it, C4), the office's are in `SignatoryAddForm.vue`, so every caller passes its label, hint and
 * clear.
 *
 * ── WHETHER A DRAWING IS NEEDED IS THE CALLER'S RULE ──────────────────────────────────────────
 * For the applicant a drawn squiggle is decoration unless they chose to sign by drawing (D-PKT13):
 * §390.32(c)(2)'s weight is the intent, text, time, IP and user agent the server stores, and D-APP8
 * says a PNG that will not upload may never block a signature. For the office it is the image the
 * carrier's paper prints (D-HB3, Q-RT2), so its form refuses without one. The pad only reports what
 * was drawn.
 *
 * ── THE TWO THINGS THAT ARE EASY TO GET WRONG ON A PHONE ──────────────────────────────────────
 * `touch-action: none` on the canvas, or the browser treats the first stroke as a scroll and the
 * driver watches the page move instead of a line appear. And the backing store is scaled by the
 * device pixel ratio, or a signature drawn on a retina screen is rendered at half resolution and
 * arrives in the PDF as a blurred smear.
 */
const emit = defineEmits<{ change: [Blob | null] }>();

/**
 * `trim` crops the PNG to the ink, with a small margin. The office's image is placed by
 * `doc.image(…, { fit })` into a box ~27 pt tall (`handbookPdf.ts`, `applicationPdf/roadTest.ts`),
 * which keeps proportions — so a wide pad with a signature across its middle third printed as a
 * signature a third of the box's height. Off for the applicant: their marks' places on the permission
 * and packet pages were measured with the whole pad (`pdf-text-collisions-are-invisible-to-tests`),
 * and enlarging them is a separate change that would need that measuring again.
 */
const props = withDefaults(
  defineProps<{ label: string; hint: string; clearLabel: string; trim?: boolean }>(),
  { trim: false },
);

/** Around the cropped ink, in CSS px — so a stroke's round cap is not sheared off at the edge. */
const TRIM_MARGIN = 6;

const canvas = ref<HTMLCanvasElement | null>(null);
const drawn = ref(false);
const ctx = shallowRef<CanvasRenderingContext2D | null>(null);
let drawing = false;
let ratio = 1;
/** The ink's extent in CSS px, grown by every point drawn; null until the first stroke. */
let ink: { left: number; top: number; right: number; bottom: number } | null = null;

/** Sized once, from the element's own laid-out box, so the stroke lands under the finger. */
function prepare(): CanvasRenderingContext2D | null {
  const el = canvas.value;
  if (!el) return null;
  if (ctx.value) return ctx.value;
  ratio = globalThis.devicePixelRatio || 1;
  const box = el.getBoundingClientRect();
  el.width = Math.round(box.width * ratio);
  el.height = Math.round(box.height * ratio);
  const c = el.getContext("2d");
  if (!c) return null;
  c.scale(ratio, ratio);
  c.lineWidth = 2;
  c.lineCap = "round";
  c.lineJoin = "round";
  // ⚠ Fixed rather than themed, and the token gate is waived on that basis — the precedent is
  // `lib/chartTheme.ts`, allow-listed for the same reason. These pixels do not stay in the browser: they
  // are re-encoded to a PNG and drawn onto a printed white sheet by the PDF renderer, so a stroke
  // that inherited a dark theme's foreground would arrive as a near-white signature on white paper.
  c.strokeStyle = "#1a1a1a"; // token-check-disable-line: canvas ink for a printed PNG, never a themed surface
  ctx.value = c;
  return c;
}

const at = (e: PointerEvent): [number, number] => {
  const box = canvas.value!.getBoundingClientRect();
  return [e.clientX - box.left, e.clientY - box.top];
};

function reach(x: number, y: number): void {
  ink = ink
    ? { left: Math.min(ink.left, x), top: Math.min(ink.top, y), right: Math.max(ink.right, x), bottom: Math.max(ink.bottom, y) }
    : { left: x, top: y, right: x, bottom: y };
}

function down(e: PointerEvent): void {
  const c = prepare();
  if (!c) return;
  drawing = true;
  canvas.value?.setPointerCapture(e.pointerId);
  const [x, y] = at(e);
  c.beginPath();
  c.moveTo(x, y);
  reach(x, y);
}

function move(e: PointerEvent): void {
  if (!drawing || !ctx.value) return;
  const [x, y] = at(e);
  ctx.value.lineTo(x, y);
  ctx.value.stroke();
  reach(x, y);
  drawn.value = true;
}

function up(): void {
  if (!drawing) return;
  drawing = false;
  emitMark();
}

/** The ink and its margin, in backing-store pixels, clamped to the canvas. */
function inkRect(el: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  if (!ink) return null;
  const x = Math.max(0, Math.floor((ink.left - TRIM_MARGIN) * ratio));
  const y = Math.max(0, Math.floor((ink.top - TRIM_MARGIN) * ratio));
  const right = Math.min(el.width, Math.ceil((ink.right + TRIM_MARGIN) * ratio));
  const bottom = Math.min(el.height, Math.ceil((ink.bottom + TRIM_MARGIN) * ratio));
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
}

/** The PNG, or null. Emitted after each stroke so the parent always holds the current mark. */
function emitMark(): void {
  const el = canvas.value;
  if (!el || !drawn.value) {
    emit("change", null);
    return;
  }
  const rect = props.trim ? inkRect(el) : null;
  if (!rect) {
    el.toBlob((blob) => emit("change", blob), "image/png");
    return;
  }
  const out = document.createElement("canvas");
  out.width = rect.w;
  out.height = rect.h;
  out.getContext("2d")?.drawImage(el, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  out.toBlob((blob) => emit("change", blob), "image/png");
}

function clear(): void {
  const el = canvas.value;
  const c = ctx.value;
  if (el && c) c.clearRect(0, 0, el.width, el.height);
  drawn.value = false;
  ink = null;
  emit("change", null);
}

onBeforeUnmount(() => {
  ctx.value = null;
});
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-baseline justify-between gap-4">
      <p class="text-sm text-ink">{{ label }}</p>
      <BaseButton v-if="drawn" variant="ghost" @click="clear">{{ clearLabel }}</BaseButton>
    </div>
    <canvas
      ref="canvas"
      class="signature-pad h-32 w-full rounded-surface bg-surface ring-1 ring-edge"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
      @pointerleave="up"
    />
    <p class="text-xs text-ink-muted">{{ hint }}</p>
  </div>
</template>

<style scoped>
/* Without `touch-action` the browser treats the first stroke as a scroll gesture and the page moves
   under the driver's finger instead of a line appearing.

   `color-scheme: light` because the ink is fixed near-black for the printed page (see `prepare`),
   and the office has a dark theme (D-DS2): on a dark `bg-surface` the Representative would have
   signed in ink they could not see. The tokens are `light-dark()` pairs, so this resolves the pad's
   own surface and ring to their light values — a sheet of paper — without a raw colour. */
.signature-pad {
  touch-action: none;
  color-scheme: light;
}
</style>
