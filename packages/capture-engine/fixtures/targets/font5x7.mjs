/**
 * A 5x7 bitmap font — the only way the target sheets can carry real text.
 *
 * ── WHY A FONT LIVES HERE AT ALL ──────────────────────────────────────────────────────────────
 * `minMedianCharHeightPx: 16` is a shipped, enforcing threshold in `src/config.ts`, and nothing has
 * ever measured it against a glyph of known height. The synthetic corpus draws ink bars, which is
 * honest for blur and contrast and useless for legibility: a bar has no cap height. To calibrate a
 * glyph-height floor you need glyphs whose height you set on purpose, printed, photographed, and
 * measured back.
 *
 * Written out rather than taken as a dependency for the same reason `png.mjs` is: this package
 * promises to import nothing platform-specific, the corpus must be reproducible from committed code,
 * and a font file that renders differently after a package upgrade would move every legibility
 * measurement underneath the threshold it was used to set.
 *
 * Glyphs are written as five-character rows so a reviewer can read the shape instead of decoding
 * hexadecimal. 5x7 is the classic terminal cell: legible at small sizes, and every glyph exactly the
 * same box, which is what makes "height" an unambiguous number rather than a per-character opinion.
 */

const G = {
  A: ["·███·", "█···█", "█···█", "█████", "█···█", "█···█", "█···█"],
  B: ["████·", "█···█", "█···█", "████·", "█···█", "█···█", "████·"],
  C: ["·███·", "█···█", "█····", "█····", "█····", "█···█", "·███·"],
  D: ["████·", "█···█", "█···█", "█···█", "█···█", "█···█", "████·"],
  E: ["█████", "█····", "█····", "████·", "█····", "█····", "█████"],
  F: ["█████", "█····", "█····", "████·", "█····", "█····", "█····"],
  G: ["·███·", "█···█", "█····", "█·███", "█···█", "█···█", "·███·"],
  H: ["█···█", "█···█", "█···█", "█████", "█···█", "█···█", "█···█"],
  I: ["·███·", "··█··", "··█··", "··█··", "··█··", "··█··", "·███·"],
  J: ["··███", "···█·", "···█·", "···█·", "···█·", "█··█·", "·██··"],
  K: ["█···█", "█··█·", "█·█··", "██···", "█·█··", "█··█·", "█···█"],
  L: ["█····", "█····", "█····", "█····", "█····", "█····", "█████"],
  M: ["█···█", "██·██", "█·█·█", "█···█", "█···█", "█···█", "█···█"],
  N: ["█···█", "██··█", "█·█·█", "█··██", "█···█", "█···█", "█···█"],
  O: ["·███·", "█···█", "█···█", "█···█", "█···█", "█···█", "·███·"],
  P: ["████·", "█···█", "█···█", "████·", "█····", "█····", "█····"],
  Q: ["·███·", "█···█", "█···█", "█···█", "█·█·█", "█··█·", "·██·█"],
  R: ["████·", "█···█", "█···█", "████·", "█·█··", "█··█·", "█···█"],
  S: ["·████", "█····", "█····", "·███·", "····█", "····█", "████·"],
  T: ["█████", "··█··", "··█··", "··█··", "··█··", "··█··", "··█··"],
  U: ["█···█", "█···█", "█···█", "█···█", "█···█", "█···█", "·███·"],
  V: ["█···█", "█···█", "█···█", "█···█", "█···█", "·█·█·", "··█··"],
  W: ["█···█", "█···█", "█···█", "█···█", "█·█·█", "██·██", "█···█"],
  X: ["█···█", "█···█", "·█·█·", "··█··", "·█·█·", "█···█", "█···█"],
  Y: ["█···█", "█···█", "·█·█·", "··█··", "··█··", "··█··", "··█··"],
  Z: ["█████", "····█", "···█·", "··█··", "·█···", "█····", "█████"],
  0: ["·███·", "█···█", "█··██", "█·█·█", "██··█", "█···█", "·███·"],
  1: ["··█··", "·██··", "··█··", "··█··", "··█··", "··█··", "·███·"],
  2: ["·███·", "█···█", "····█", "···█·", "··█··", "·█···", "█████"],
  3: ["█████", "···█·", "··█··", "···█·", "····█", "█···█", "·███·"],
  4: ["···█·", "··██·", "·█·█·", "█··█·", "█████", "···█·", "···█·"],
  5: ["█████", "█····", "████·", "····█", "····█", "█···█", "·███·"],
  6: ["··██·", "·█···", "█····", "████·", "█···█", "█···█", "·███·"],
  7: ["█████", "····█", "···█·", "··█··", "·█···", "·█···", "·█···"],
  8: ["·███·", "█···█", "█···█", "·███·", "█···█", "█···█", "·███·"],
  9: ["·███·", "█···█", "█···█", "·████", "····█", "···█·", "·██··"],
  " ": ["·····", "·····", "·····", "·····", "·····", "·····", "·····"],
  "-": ["·····", "·····", "·····", "█████", "·····", "·····", "·····"],
  ".": ["·····", "·····", "·····", "·····", "·····", "··██·", "··██·"],
  "/": ["····█", "···█·", "···█·", "··█··", "·█···", "·█···", "█····"],
  ":": ["·····", "··██·", "··██·", "·····", "··██·", "··██·", "·····"],
  "#": ["·█·█·", "█████", "·█·█·", "·█·█·", "█████", "·█·█·", "·····"],
};

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
/** One blank column between glyphs, in font units. */
export const GLYPH_ADVANCE = GLYPH_WIDTH + 1;

/** Rows of a glyph as booleans. Unknown characters render as a space rather than throwing — a target
 *  sheet with a missing glyph is still a usable target sheet, and a crash during generation is not. */
export function glyph(ch) {
  const rows = G[ch.toUpperCase()] ?? G[" "];
  return rows.map((row) => [...row].map((c) => c === "█"));
}

/** Width in font units of `text` rendered at scale 1 (trailing advance excluded). */
export function textWidth(text) {
  return text.length === 0 ? 0 : text.length * GLYPH_ADVANCE - 1;
}

/**
 * Draw `text` with its cap height exactly `GLYPH_HEIGHT * scale` pixels — the property the whole
 * exercise depends on. `plot(x, y)` receives every ink pixel; the caller owns the canvas.
 */
export function drawText(text, x0, y0, scale, plot) {
  for (let i = 0; i < text.length; i++) {
    const rows = glyph(text[i]);
    const gx = x0 + i * GLYPH_ADVANCE * scale;
    for (let ry = 0; ry < GLYPH_HEIGHT; ry++) {
      for (let rx = 0; rx < GLYPH_WIDTH; rx++) {
        if (!rows[ry][rx]) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) plot(gx + rx * scale + sx, y0 + ry * scale + sy);
        }
      }
    }
  }
}
