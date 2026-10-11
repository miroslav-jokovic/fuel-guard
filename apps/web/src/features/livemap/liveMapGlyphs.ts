/**
 * The SHAPE of each map state, as data (D-LM30, the 2026-09-30 audit's LS2).
 *
 * ── WHY THE SHAPE CHANGES AND NOT ONLY THE COLOUR ────────────────────────────────────────────────
 * Until LS2 every truck was the same rotated arrow in one of four colours — a parked truck and an
 * offline one pointed somewhere, and the only thing separating the four states on the canvas was a
 * colour pair D-LM24 had to measure to 0.079 ΔEok apart for a deuteranope. A state that is carried by
 * colour alone is a state a colour-blind dispatcher, a sun-washed laptop and a greyscale printout all
 * lose. So each state now has its own silhouette, and colour is the second channel rather than the
 * only one — the same pairing Samsara's own fleet map uses (triangle moving, circle stationary).
 *
 * | glyph | reads as | rotates |
 * |---|---|---|
 * | `moving-arrow` | a direction of travel | yes — the ONLY one |
 * | `moving-dot` | moving, bearing unknown | no |
 * | `stopped` | a filled disc with a lit centre — engine on, standing | no |
 * | `parked` | a rounded square with a P — the road sign, engine off | no |
 * | `offline` | a hollow disc with a slash — no signal | no |
 *
 * Only the arrow rotates because only the arrow SAYS something with its rotation. A parked square
 * turned to its last bearing is a picture of a fact we no longer stand behind.
 *
 * ── ONE GEOMETRY, TWO RENDERERS ──────────────────────────────────────────────────────────────────
 * The map draws these onto a canvas through `Path2D` (`liveMapIcons.ts`), and the rail draws the SAME
 * strings as inline SVG (`LiveMapStateGlyph.vue`) in its census and legend. A second hand-drawn legend
 * icon is a copy with a delay fuse: the day somebody tweaks the square on the map, the rail would go
 * on promising the old one. Path strings are the one format both renderers take verbatim.
 *
 * Coordinates are in a 24-unit box centred on 0,0 (`viewBox="-12 -12 24 24"`), north up, so the arrow
 * points at a compass bearing of 0 and `icon-rotate` can hand it a heading unchanged.
 */
import type { VehicleMapState } from "@silvicom/shared";

export type GlyphName = "moving-arrow" | "moving-dot" | "stopped" | "parked" | "offline";

/**
 * One stroke or fill of a glyph.
 *
 * `paint: "state"` is the state's own token colour; `"keyline"` is the contrast colour — white on the
 * map, the surface colour in the rail. `outline` asks the MAP renderer for a keyline stroke around a
 * filled body, which is what keeps a green disc visible on a green field; the rail sits on a flat
 * surface and does not need it.
 */
export interface GlyphPart {
  d: string;
  paint: "state" | "keyline";
  mode: "fill" | "stroke";
  /** Stroke width in box units, for `mode: "stroke"`. */
  width?: number;
  outline?: boolean;
}

export interface Glyph {
  parts: readonly GlyphPart[];
  rotates: boolean;
}

const circle = (r: number) => `M${r} 0A${r} ${r} 0 1 1 ${-r} 0A${r} ${r} 0 1 1 ${r} 0Z`;

export const GLYPHS: Readonly<Record<GlyphName, Glyph>> = {
  // The concave tail is what tells the eye which end is the front at map size — an isoceles triangle
  // reads the same both ways round.
  "moving-arrow": {
    rotates: true,
    parts: [{ d: "M0 -11L8.2 9.6Q0 4.4 -8.2 9.6Z", paint: "state", mode: "fill", outline: true }],
  },
  "moving-dot": {
    rotates: false,
    parts: [{ d: circle(7.5), paint: "state", mode: "fill", outline: true }],
  },
  stopped: {
    rotates: false,
    parts: [
      { d: circle(8.5), paint: "state", mode: "fill", outline: true },
      { d: circle(3.2), paint: "keyline", mode: "fill" },
    ],
  },
  parked: {
    rotates: false,
    parts: [
      {
        d: "M-5.5 -8.5H5.5A3 3 0 0 1 8.5 -5.5V5.5A3 3 0 0 1 5.5 8.5H-5.5A3 3 0 0 1 -8.5 5.5V-5.5A3 3 0 0 1 -5.5 -8.5Z",
        paint: "state",
        mode: "fill",
        outline: true,
      },
      // A "P", drawn as a stroke so it needs no font — the style has no glyph source (see
      // `liveMapLayer.ts`'s header) and a canvas font would differ from the SVG's.
      { d: "M-2.4 5.2V-5.2H1A3 3 0 0 1 1 0.8H-2.4", paint: "keyline", mode: "stroke", width: 2.2 },
    ],
  },
  offline: {
    rotates: false,
    parts: [
      { d: circle(7.8), paint: "keyline", mode: "fill", outline: true },
      { d: circle(7.8), paint: "state", mode: "stroke", width: 2.4 },
      { d: "M-5 5L5 -5", paint: "state", mode: "stroke", width: 2.2 },
    ],
  },
};

export const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[];

/** The glyph that stands for a STATE in a legend, where there is no bearing to show. */
export const STATE_GLYPH: Readonly<Record<VehicleMapState, GlyphName>> = {
  moving: "moving-arrow",
  stopped: "stopped",
  parked: "parked",
  offline: "offline",
};

/** Which state's colour a glyph wears. Derived from the name so the two cannot disagree. */
export function glyphState(name: GlyphName): VehicleMapState {
  return name.startsWith("moving") ? "moving" : (name as VehicleMapState);
}

/**
 * Which truck is drawn on top when markers overlap — and 77% of them do in the fitted view (D-LM24).
 * Higher draws later. Moving first, because a truck on the road is the one a dispatcher is looking
 * for; offline last, because it is the one we know least about. The selected truck outranks them all.
 */
export const STATE_DRAW_ORDER: Readonly<Record<VehicleMapState, number>> = {
  offline: 0,
  parked: 1,
  stopped: 2,
  moving: 3,
};
export const SELECTED_DRAW_ORDER = 10;
