<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * A place to draw a signature with a finger (A8b, D-APP7/D-APP8).
 *
 * ── IT IS DECORATION, AND EVERY DECISION HERE FOLLOWS FROM THAT ───────────────────────────────
 * §390.32(c)(2) accepts "any available technology", and what carries the legal weight is the tuple
 * the server already stores: the intent statement, the exact disclosure text and version, the
 * timestamp, the IP and the user agent. A drawn squiggle adds none of that. It exists because drivers
 * expect to see a signature on their own document — so it is never required, never blocks adoption,
 * and a driver on a cracked screen who cannot produce one has still signed.
 *
 * ── THE TWO THINGS THAT ARE EASY TO GET WRONG ON A PHONE ──────────────────────────────────────
 * `touch-action: none` on the canvas, or the browser treats the first stroke as a scroll and the
 * driver watches the page move instead of a line appear. And the backing store is scaled by the
 * device pixel ratio, or a signature drawn on a retina screen is rendered at half resolution and
 * arrives in the PDF as a blurred smear.
 */
const emit = defineEmits<{ change: [Blob | null] }>();

const copy = APPLY_COPY.signing;
const canvas = ref<HTMLCanvasElement | null>(null);
const drawn = ref(false);
const ctx = shallowRef<CanvasRenderingContext2D | null>(null);
let drawing = false;

/** Sized once, from the element's own laid-out box, so the stroke lands under the finger. */
function prepare(): CanvasRenderingContext2D | null {
  const el = canvas.value;
  if (!el) return null;
  if (ctx.value) return ctx.value;
  const ratio = globalThis.devicePixelRatio || 1;
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

function down(e: PointerEvent): void {
  const c = prepare();
  if (!c) return;
  drawing = true;
  canvas.value?.setPointerCapture(e.pointerId);
  const [x, y] = at(e);
  c.beginPath();
  c.moveTo(x, y);
}

function move(e: PointerEvent): void {
  if (!drawing || !ctx.value) return;
  const [x, y] = at(e);
  ctx.value.lineTo(x, y);
  ctx.value.stroke();
  drawn.value = true;
}

function up(): void {
  if (!drawing) return;
  drawing = false;
  emitMark();
}

/** The PNG, or null. Emitted after each stroke so the parent always holds the current mark. */
function emitMark(): void {
  const el = canvas.value;
  if (!el || !drawn.value) {
    emit("change", null);
    return;
  }
  el.toBlob((blob) => emit("change", blob), "image/png");
}

function clear(): void {
  const el = canvas.value;
  const c = ctx.value;
  if (el && c) c.clearRect(0, 0, el.width, el.height);
  drawn.value = false;
  emit("change", null);
}

onBeforeUnmount(() => {
  ctx.value = null;
});
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-baseline justify-between gap-4">
      <p class="text-sm text-ink">{{ copy.drawLabel }}</p>
      <BaseButton v-if="drawn" variant="ghost" @click="clear">{{ copy.drawClear }}</BaseButton>
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
    <p class="text-xs text-ink-muted">{{ copy.drawHint }}</p>
  </div>
</template>

<style scoped>
/* Without this the browser treats the first stroke as a scroll gesture and the page moves under the
   driver's finger instead of a line appearing. */
.signature-pad {
  touch-action: none;
}
</style>
