/**
 * Road signs behind route numbers on the vector road map (D-DR36), one shape per kind of road.
 *
 * ── WHICH KINDS, MEASURED ON TILES 2026-11-11 ────────────────────────────────────────────────────
 * HERE's `road_labels` features carry a `network`. Sampled with our key at zooms 9 and 12 over
 * Dallas, Houston, Indianapolis, Gary, Columbus and Toledo, the values were `US:I` (243), `US` (11),
 * a state `US:<ST>` (US:TX 319, US:OH 175, US:IN 77, US:IL 61, US:MI 12) and a county
 * `US:<ST>:CR` (US:OH:CR 98, US:TX:CR 2, US:IL:CR 1), and nothing else. So the four kinds below are
 * read off that shape; a network outside it (none was seen) is drawn as a state sign.
 *
 * ── THE ARTWORK IS OURS ─────────────────────────────────────────────────────────────────────────
 * Plain geometric outlines in the US federal sign colours (`--map-shield-*`, FHWA's published
 * blue, red and yellow): an interstate's blue shield with a red band, a US route's white shield, a
 * state route's white rounded box and a county road's blue pentagon. Nothing is copied from any map
 * provider. Drawn on a canvas per number length, so the sign widens for "35E" and not for "8".
 */
import type { ExpressionSpecification } from "maplibre-gl";
import type { MapPalette } from "./vectorBasemap";
import type { MapIconImage } from "./mapIcons";

export const SHIELD_KINDS = ["interstate", "us", "state", "county"] as const;
export type ShieldKind = (typeof SHIELD_KINDS)[number];

/** Signs are drawn for numbers up to this many characters; a longer one sits on the widest. */
export const SHIELD_MAX_CHARS = 4;
/** CSS width by number length, 20 px tall; widths set by drawing "8", "80", "35E" and "1234" in a browser (2026-11-11). */
const SHIELD_WIDTH = [0, 20, 24, 30, 36];
const SHIELD_HEIGHT = 20;
const PIXEL_RATIO = 2;

/** The road's `network` → sign kind, per the measured shapes in the header. */
export const shieldKindExpression: ExpressionSpecification = [
  "let",
  "net",
  ["coalesce", ["get", "network"], ""],
  [
    "case",
    ["==", ["var", "net"], "US:I"], "interstate",
    ["==", ["var", "net"], "US"], "us",
    // `:CR` appears only as the county suffix in every value measured (header).
    ["in", ":CR", ["var", "net"]], "county",
    "state",
  ],
];

export function shieldImageId(kind: ShieldKind, chars: number): string {
  return `map-icon:shield-${kind}-${chars}`;
}

/** The sign image for a road label: its kind, and its number's length capped at `SHIELD_MAX_CHARS`. */
export const shieldImageExpression: ExpressionSpecification = [
  "concat",
  "map-icon:shield-",
  shieldKindExpression,
  "-",
  ["to-string", ["min", ["length", ["get", "shield_text"]], SHIELD_MAX_CHARS]],
];

/** The number's colour on each sign, as the real signs print it. */
export function shieldTextColour(c: MapPalette): ExpressionSpecification {
  return ["match", shieldKindExpression, "interstate", c["shield-plain"], "county", c["shield-county-ink"], c["shield-ink"]];
}

function outline(kind: ShieldKind, w: number, h: number): Path2D {
  const p = new Path2D();
  const i = 1.5 * PIXEL_RATIO;
  if (kind === "state") {
    p.roundRect(i, i, w - 2 * i, h - 2 * i, 4 * PIXEL_RATIO);
  } else if (kind === "county") {
    // Flat top, straight sides, corners cut in toward a narrower flat bottom.
    p.moveTo(i, i);
    p.lineTo(w - i, i);
    p.lineTo(w - i, h * 0.62);
    p.lineTo(w * 0.72, h - i);
    p.lineTo(w * 0.28, h - i);
    p.lineTo(i, h * 0.62);
  } else {
    // A shield: flat top, straight sides to just past halfway, curving to a point at the bottom.
    p.moveTo(i, i);
    p.lineTo(w - i, i);
    p.lineTo(w - i, h * 0.5);
    p.quadraticCurveTo(w - i, h * 0.85, w / 2, h - i);
    p.quadraticCurveTo(i, h * 0.85, i, h * 0.5);
  }
  p.closePath();
  return p;
}

function drawShield(ctx: CanvasRenderingContext2D, kind: ShieldKind, w: number, h: number, c: MapPalette): void {
  const shape = outline(kind, w, h);
  const blue = kind === "interstate" || kind === "county";
  ctx.fillStyle = blue ? c["shield-interstate"] : c["shield-plain"];
  ctx.fill(shape);
  if (kind === "interstate") {
    ctx.save();
    ctx.clip(shape);
    ctx.fillStyle = c["shield-interstate-band"];
    ctx.fillRect(0, 0, w, h * 0.24);
    ctx.restore();
  }
  ctx.lineWidth = 1.2 * PIXEL_RATIO;
  ctx.strokeStyle = kind === "interstate" ? c["shield-plain"] : kind === "county" ? c["shield-county-ink"] : c["shield-ink"];
  ctx.stroke(shape);
}

/** Every sign, every width, in the given palette. Empty where the browser cannot draw (tests). */
export function rasteriseShields(c: MapPalette): Map<string, MapIconImage> {
  const out = new Map<string, MapIconImage>();
  for (const kind of SHIELD_KINDS) {
    for (let chars = 1; chars <= SHIELD_MAX_CHARS; chars++) {
      const w = SHIELD_WIDTH[chars]! * PIXEL_RATIO;
      const h = SHIELD_HEIGHT * PIXEL_RATIO;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return out;
      drawShield(ctx, kind, w, h, c);
      out.set(shieldImageId(kind, chars), { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data });
    }
  }
  return out;
}
