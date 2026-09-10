<script setup lang="ts">
import { computed } from "vue";
import { encode, labelSheet, toSvgPath, LABEL_PRESETS, type LabelPresetId } from "@silvicom/qr";
import type { LabelFaceDto } from "@silvicom/shared";

/**
 * The sheet, on screen, before it is on paper (INVENTORY-PLAN.md I10; research §5.15).
 *
 * ── IT DRAWS FROM THE SAME TWO FUNCTIONS THE PDF DOES, AND THAT IS THE POINT ──────────────────
 * `labelSheet()` decides where every label goes — including the start position and the nudge — and
 * `toSvg()` decides what each symbol looks like. `labelPdf.ts` on the API calls exactly those two
 * with exactly these numbers. Nothing here re-derives a position or re-encodes a payload, which is
 * what makes I10's done-when ("the preview and the PDF are pixel-compared for one preset") a real
 * test rather than a comparison of two guesses: a divergence would have to be a difference between
 * pdfkit and an SVG renderer, not a difference between two authors' arithmetic.
 *
 * ── WHY THE WHOLE SHEET AND NOT A SINGLE ENLARGED LABEL ───────────────────────────────────────
 * A blown-up label answers "does the text fit", which is not the question anybody has at a printer.
 * The questions are "will this start where I told it to" and "is the whole thing shifted", and both
 * are about the SHEET. Avery's own alignment guidance is a whole-page comparison for the same
 * reason, and the empty backing squares are what make a start position legible at a glance: six
 * blank outlines and then the first label is a picture of "starting at 7".
 *
 * ── SCALE IS A CSS TRANSFORM ON ONE WRAPPER, NOT A NUMBER THREADED THROUGH THE GEOMETRY ───────
 * Every coordinate below is in PostScript points, exactly as the PDF has them, and the preview is
 * shrunk by scaling the container. Threading a scale factor into `labelSheet()` would mean the
 * preview asks a different question of the geometry than the printer does — and rounding at a
 * quarter size is exactly where a pixel comparison would start disagreeing for no real reason.
 */

const props = defineProps<{
  faces: LabelFaceDto[];
  presetId: LabelPresetId;
  startPosition: number;
  nudgeX: number;
  nudgeY: number;
  /** How wide the preview may be, in CSS pixels. The sheet is scaled to fit it. */
  maxWidth?: number;
}>();

const preset = computed(() => LABEL_PRESETS[props.presetId]);

const sheet = computed(() =>
  labelSheet(props.faces.length, props.presetId, {
    startPosition: props.startPosition,
    nudge: { x: props.nudgeX, y: props.nudgeY },
  }),
);

/** The first page only. A run of ten sheets is ten identical pictures after the first. */
const firstPage = computed(() => sheet.value.placements.filter((p) => p.page === 0));

const scale = computed(() => (props.maxWidth ?? 340) / preset.value.sheet.width);

/**
 * Where the labels that were SKIPPED sit — the empty backing squares before the start position.
 *
 * Drawn deliberately, because they are the whole reason a start position is legible. They are
 * computed here rather than asked of `labelSheet()`, and that is the one piece of geometry this
 * file does own: the sheet function answers "where do my labels go" and has no opinion about the
 * ones nobody is printing on.
 */
const skipped = computed(() => {
  const p = preset.value;
  return Array.from({ length: props.startPosition - 1 }, (_, slot) => ({
    slot,
    x: p.margin.left + (slot % p.columns) * p.pitch.x + props.nudgeX,
    y: p.margin.top + Math.floor(slot / p.columns) * p.pitch.y + props.nudgeY,
  }));
});

/**
 * The symbol's path, at the size the label gives it — **the same call `labelPdf.ts` makes**.
 *
 * `toSvgPath` and not `toSvg`, and the difference is worth the line: `toSvg` returns a whole
 * document that would have to be injected with `v-html`, and the API's renderer does not use it
 * either — it feeds the PATH to pdfkit. Taking the path means the two renderers now share one more
 * function and this component injects no markup at all.
 */
const symbolPath = (payload: string, size: number) => toSvgPath(encode(payload), { size });

/** How big the symbol may be inside one label — `labelPdf.ts`'s own arithmetic. */
const symbolSize = (placement: { width: number; height: number }) =>
  beside.value ? placement.height - 8 : Math.min(placement.width - 8, placement.height - 22);

/** Matches `labelPdf.ts`'s own rule: a label too short to stack puts its text beside the symbol. */
const beside = computed(() => preset.value.label.height < preset.value.label.width * 0.8);
</script>

<template>
  <div class="overflow-hidden rounded-surface bg-surface p-3 ring-1 ring-edge">
    <div
      class="relative origin-top-left bg-surface shadow-card ring-1 ring-edge"
      :style="{
        width: `${preset.sheet.width}px`,
        height: `${preset.sheet.height}px`,
        transform: `scale(${scale})`,
        marginBottom: `${preset.sheet.height * (scale - 1)}px`,
        marginRight: `${preset.sheet.width * (scale - 1)}px`,
      }"
    >
      <!-- The labels already peeled off the sheet in your hand. Outlined and empty. -->
      <div
        v-for="s in skipped"
        :key="`skip-${s.slot}`"
        class="absolute rounded-detail border border-dashed border-edge"
        :style="{
          left: `${s.x}px`,
          top: `${s.y}px`,
          width: `${preset.label.width}px`,
          height: `${preset.label.height}px`,
        }"
      />

      <div
        v-for="(placement, i) in firstPage"
        :key="placement.position"
        class="absolute flex rounded-detail border border-edge-subtle"
        :class="beside ? 'flex-row items-center gap-1 p-1' : 'flex-col items-center p-1'"
        :style="{
          left: `${placement.x}px`,
          top: `${placement.y}px`,
          width: `${placement.width}px`,
          height: `${placement.height}px`,
        }"
      >
        <!-- `shape-rendering="crispEdges"` is load-bearing rather than cosmetic (research §4.6):
             without it the browser antialiases the module edges, and a scanner reading the screen —
             or a printer rasterising this preview — sees grey where it needs a hard transition. -->
        <svg
          :width="symbolSize(placement)"
          :height="symbolSize(placement)"
          :viewBox="`0 0 ${symbolSize(placement)} ${symbolSize(placement)}`"
          shape-rendering="crispEdges"
          aria-hidden="true"
          class="shrink-0"
        >
          <path :d="symbolPath(faces[i]!.payload, symbolSize(placement))" fill="currentColor" />
        </svg>
        <div class="min-w-0 overflow-hidden" :class="beside ? 'flex-1' : 'w-full text-center'">
          <p class="label-code truncate font-semibold text-ink">{{ faces[i]!.code }}</p>
          <p v-for="line in faces[i]!.lines" :key="line" class="label-line truncate text-ink-secondary">
            {{ line }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/**
 * ⚠ These are POINTS, not the app's type scale, and that is why they are here rather than as
 * `text-2xs`.
 *
 * `lint:tokens` is right that a screen has seven text sizes and that an arbitrary one is a smell.
 * This is not a screen: it is a scale model of a printed sheet, and every number in it — including
 * these two — is the number `labelPdf.ts` passes to pdfkit (`CODE_SIZE`, `LINE_SIZE`). Rounding
 * them to the nearest UI size would make the preview a picture of a different label than the one
 * that comes out of the printer, which is the single thing this component exists not to do.
 * `ShopLayout.vue` takes the same escape for `100dvh` and for the same reason.
 */
.label-code {
  font-size: 9px;
  line-height: 11px;
}

.label-line {
  font-size: 7px;
  line-height: 8px;
}
</style>
