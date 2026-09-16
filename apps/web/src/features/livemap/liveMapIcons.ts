/**
 * The eight pictures the symbol layer draws with (LIVE-MAP-PLAN.md LM8, D-LM7).
 *
 * ── DRAWN ON A CANVAS RATHER THAN SHIPPED AS FILES ───────────────────────────────────────────────
 * Four states × two shapes, in colours that come from the design tokens and CHANGE WITH THE THEME —
 * `--ramp-success-600` and every other ramp is a `light-dark()` pair. A checked-in PNG would be a
 * ninth copy of a colour the token layer already owns and would be wrong in one of the two schemes,
 * which is the failure `lint:tokens-parity` exists to prevent and cannot see inside a binary.
 *
 * ⚠ NOT AN SDF. maplibre can tint a single-channel SDF icon with `icon-color`, which would be one
 * image instead of eight — but an SDF built from a plain alpha mask has soft, haloed edges at these
 * sizes, and a correct distance field for the arrow is real work to produce for no gain. Eight small
 * bitmaps at 48×48 is 9 KB of texture, drawn once per theme.
 *
 * This file is the counterpart of `tokenColor`: it touches the DOM and a 2D context, so it cannot be
 * unit-tested in jsdom. Everything it is asked to decide — which icon a truck gets, which colour a
 * state is — lives in `liveMapLayer.ts` instead, where a test can hold it still.
 */
import type maplibregl from "maplibre-gl";
import { tokenColor } from "@/composables/useMapLibre";
import { MAP_STATES, STATE_COLOR_CLASS } from "./liveMapLayer";

/**
 * Marker size in CSS pixels, at pixel ratio 2.
 *
 * 24 px is the smallest an arrow stays readable as a DIRECTION rather than a blob, and the largest
 * that leaves 199 of them legible over a metro area — the two constraints that actually bound this.
 */
const SIZE = 24;
const RATIO = 2;

/** The white keyline. A green dot on a green field is invisible; the ring is what makes it not. */
const OUTLINE = "rgb(255, 255, 255)";
const OUTLINE_WIDTH = 2;

function context(): CanvasRenderingContext2D | null {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE * RATIO;
  canvas.height = SIZE * RATIO;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(RATIO, RATIO);
  ctx.translate(SIZE / 2, SIZE / 2);
  ctx.lineJoin = "round";
  return ctx;
}

/**
 * A navigation arrow pointing north at rotation 0, so `icon-rotate` can hand it a compass bearing
 * verbatim. The concave tail is what tells the eye which end is the front at 24 px — an isoceles
 * triangle reads as a diamond at this size and its direction has to be worked out rather than seen.
 */
function drawArrow(ctx: CanvasRenderingContext2D, fill: string): void {
  const r = SIZE / 2 - OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.72, r * 0.85);
  ctx.quadraticCurveTo(0, r * 0.35, -r * 0.72, r * 0.85);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
}

/** For a truck whose ping carried no bearing: a dot claims nothing about which way it is facing. */
function drawDot(ctx: CanvasRenderingContext2D, fill: string): void {
  const r = SIZE / 2 - OUTLINE_WIDTH - 1;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
}

function bitmap(draw: (ctx: CanvasRenderingContext2D, fill: string) => void, fill: string): ImageData | null {
  const ctx = context();
  if (!ctx) return null;
  draw(ctx, fill);
  return ctx.getImageData(0, 0, SIZE * RATIO, SIZE * RATIO);
}

/**
 * Register (or re-register) every marker image on a map.
 *
 * Called once on style load and AGAIN on every theme change — `updateImage` rather than a second
 * `addImage`, because maplibre warns and ignores a duplicate id, which would leave a dark-mode map
 * wearing light-mode markers with nothing in the console to say so.
 */
export function installLiveMapIcons(map: maplibregl.Map): void {
  for (const state of MAP_STATES) {
    const fill = tokenColor(STATE_COLOR_CLASS[state]);
    for (const [suffix, draw] of [["arrow", drawArrow], ["dot", drawDot]] as const) {
      const image = bitmap(draw, fill);
      if (!image) continue;
      const id = `live-${state}-${suffix}`;
      if (map.hasImage(id)) map.updateImage(id, image);
      else map.addImage(id, image, { pixelRatio: RATIO });
    }
  }
}
