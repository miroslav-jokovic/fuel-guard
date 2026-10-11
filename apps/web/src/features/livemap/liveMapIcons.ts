/**
 * The pictures the symbol layer draws with (LIVE-MAP-PLAN.md LM8, D-LM7; shapes D-LM30).
 *
 * ── DRAWN ON A CANVAS RATHER THAN SHIPPED AS FILES ───────────────────────────────────────────────
 * One bitmap per glyph in `liveMapGlyphs.ts`, in colours that come from the design tokens and CHANGE
 * WITH THE THEME —
 * `--ramp-success-600` and every other ramp is a `light-dark()` pair. A checked-in PNG would be a
 * ninth copy of a colour the token layer already owns and would be wrong in one of the two schemes,
 * which is the failure `lint:tokens-parity` exists to prevent and cannot see inside a binary.
 *
 * ⚠ NOT AN SDF. maplibre can tint a single-channel SDF icon with `icon-color`, which would be one
 * image instead of eight — but an SDF built from a plain alpha mask has soft, haloed edges at these
 * sizes, and a correct distance field for five silhouettes is real work to produce for no gain. Five
 * small bitmaps at 60×60 is 70 KB of texture, drawn once per theme.
 *
 * This file is the counterpart of `tokenColor`: it touches the DOM and a 2D context, so it cannot be
 * unit-tested in jsdom. Everything it is asked to decide — which icon a truck gets, which colour a
 * state is — lives in `liveMapLayer.ts` instead, where a test can hold it still.
 */
import type maplibregl from "maplibre-gl";
import { tokenColor } from "@/composables/useMapLibre";
import { STATE_COLOR_CLASS, iconId } from "./liveMapLayer";
import { GLYPHS, GLYPH_NAMES, glyphState, type Glyph } from "./liveMapGlyphs";

/**
 * Marker size in CSS pixels, at pixel ratio 2 (D-LM24, the owner's item 9).
 *
 * ⚠ **THIS WAS 24, UNDER A CLAIM THAT TURNED OUT TO BE FALSE.** The old comment read "24 px is the
 * smallest an arrow stays readable as a DIRECTION rather than a blob, and the largest that leaves 199
 * of them legible over a metro area". The first half stands; the second was asserted and never
 * measured, and it is wrong in the view this map OPENS in.
 *
 * Measured 2026-09-17 against the 198 positions production holds today — `vehicle_positions` is
 * current state, one row per vehicle — projected into the map's real box beside the rail (1132×780 at
 * 1512×900) with `fitBounds(padding: 56, maxZoom: 9)`:
 *
 * | zoom | what it is | trucks touching another at 24 px | at 30 px |
 * |---|---|---|---|
 * | 3.87 | the fitted fleet, the default view | **77.2%** | 83.8% |
 * | 5 | a region | 46.2% | 49.7% |
 * | 9 | a corridor, where a dispatcher reads markers | 25.4% | **25.4%** |
 *
 * Two things fall out. The default view is ALREADY a pile at 24 px, so the size was not buying the
 * legibility the comment claimed. And at zoom 9 and above the number does not move with the size at
 * all — those 480 overlapping pairs are trucks at the same coordinates in a yard, which no size fixes
 * and which is exactly what `icon-allow-overlap: true` exists to keep visible.
 *
 * So 30 costs 6.6 points on a view that is already three-quarters overlapped, and nothing at all
 * where markers are actually read. 24 remains the FLOOR for the arrow reading as a direction.
 */
const SIZE = 30;
const RATIO = 2;
/**
 * How much of the 30 px the glyph itself takes. The old arrow ran to 26 px edge to edge with its
 * keyline; this keeps the silhouettes at that size and spends the margin on a shadow, which is what
 * lifts a marker off a busy basemap instead of a thicker outline flattening it (D-LM30).
 */
const GLYPH_PX = 24;
/** A soft contact shadow. Not a token: it is a property of the marker's depth, not a colour. */
const SHADOW = "rgba(0, 0, 0, 0.35)";

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
 * Draw one glyph from `liveMapGlyphs.ts` — the same path strings the rail renders as SVG.
 *
 * The 24-unit glyph box is scaled to `GLYPH_PX`, leaving the rest of the canvas for the keyline and
 * the drop shadow; a shadow clipped at the bitmap's edge draws as a hard line on one side.
 *
 * Order matters and is the glyph's own: an outlined body strokes its white keyline FIRST and then
 * fills over the inner half of it, so the keyline sits outside the silhouette instead of eating
 * into a 17-pixel square. The shadow is on the keyline pass only — shadowing every part would put a
 * shadow INSIDE the parked square around its "P".
 */
function drawGlyph(ctx: CanvasRenderingContext2D, glyph: Glyph, stateColour: string): void {
  const k = GLYPH_PX / 24;
  ctx.scale(k, k);
  for (const part of glyph.parts) {
    const path = new Path2D(part.d);
    const colour = part.paint === "state" ? stateColour : OUTLINE;
    if (part.outline) {
      ctx.save();
      ctx.shadowColor = SHADOW;
      ctx.shadowBlur = 2.5 / k;
      ctx.shadowOffsetY = 1 / k;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = (OUTLINE_WIDTH * 2) / k;
      ctx.stroke(path);
      ctx.restore();
    }
    if (part.mode === "fill") {
      ctx.fillStyle = colour;
      ctx.fill(path);
    } else {
      ctx.strokeStyle = colour;
      ctx.lineWidth = part.width ?? 2;
      ctx.lineCap = "round";
      ctx.stroke(path);
    }
  }
}

function bitmap(glyph: Glyph, stateColour: string): ImageData | null {
  const ctx = context();
  if (!ctx) return null;
  drawGlyph(ctx, glyph, stateColour);
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
  for (const name of GLYPH_NAMES) {
    const image = bitmap(GLYPHS[name], tokenColor(STATE_COLOR_CLASS[glyphState(name)]));
    if (!image) continue;
    const id = iconId(name);
    if (map.hasImage(id)) map.updateImage(id, image);
    else map.addImage(id, image, { pixelRatio: RATIO });
  }
}
