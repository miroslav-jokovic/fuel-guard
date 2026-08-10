/**
 * DOT placard SVG generator. Renders a §172.519-style square-on-point (diamond) placard from an
 * explicit, cited design descriptor: background (solid / horizontal split / vertical stripes), a hazard
 * symbol, the hazard-class number in the bottom corner, and the placard wording. Colors follow the
 * standard DOT/UN placard palette. Output is a self-contained SVG string (viewBox 0 0 200 200) that
 * renders identically in a Vue web view (inline / v-html) and a React-Native app (react-native-svg).
 *
 * SIZING (fixed 2026-08): the root <svg> no longer carries width="200" height="200". A hardcoded pixel
 * size on an inline SVG ignores its parent box, so every diamond rendered at 200×200 inside whatever
 * slot the caller had sized — overflowing captions, positions text and citation chips underneath it.
 * The root now scales to its container (`width/height = 100%`, `preserveAspectRatio`), and a caller
 * that genuinely wants intrinsic pixels asks for them via `renderPlacardSvg(d, { pxSize })`.
 *
 * GEOMETRY (§172.519, 2 units ≈ 1 mm on a 273 mm placard):
 *   · outer diamond spans 4…196 (192 units across the diagonal ≈ 386 mm)
 *   · inner border line is inset 9 units along each axis = 6.4 perpendicular ≈ 12.8 mm (spec: 12.5 mm)
 *   · the class number renders at ~41 mm cap height (spec: ≥ 41 mm)
 *
 * IDENTIFICATION NUMBERS (§172.332(c)): a placard may itself carry the ID number, displayed across the
 * center area on a white background 100 mm high × 215 mm wide whose top sits ~40 mm above the placard's
 * horizontal centerline. Pass `idNumber` to render that variant. The wording is suppressed when the band
 * is present — that is what the regulation's own example shows, and it is what actually rolls down the
 * road. §172.334 (which placards may NOT carry a number) is a RULE, not artwork: the engine decides, this
 * module draws.
 */

export const PALETTE = {
  red: "#E4002B",
  orange: "#FF7900",
  green: "#00843D",
  yellow: "#FEDD00",
  blue: "#0057B8",
  white: "#FFFFFF",
  black: "#0A0A0A",
} as const;

export type SymbolId =
  | "flame"
  | "cylinder"
  | "skull"
  | "trefoil"
  | "corrosive"
  | "oxidizer"
  | "explosion"
  | "none";

export type Background =
  | { kind: "solid"; color: string }
  | { kind: "split"; top: string; bottom: string }
  | { kind: "stripes"; base: string; stripe: string; region: "top" | "full" };

export interface Design {
  /** Placard wording as printed, e.g. "FLAMMABLE", "NON-FLAMMABLE GAS", or "" for none (Class 9). */
  text: string;
  /** Hazard class/division shown in the bottom corner, e.g. "3", "2", "9", "1.1"; null = none. */
  classNumber: string | null;
  background: Background;
  symbol: SymbolId;
  /** Ink color for the border. Also the default for symbol / text / number. */
  ink: string;
  /** Symbol ink (top half of a split placard); defaults to `ink`. */
  symbolInk?: string;
  /** Text + number ink (bottom half of a split placard); defaults to `ink`. */
  textInk?: string;
  /** Underline the class number (Class 9). */
  underlineNumber?: boolean;
}

export interface RenderOptions {
  /**
   * §172.332(c): render the identification number across the center of the placard (e.g. "1789").
   * Digits only — the "UN"/"NA" prefix is NOT displayed on the placard itself. Suppresses the wording.
   */
  idNumber?: string | null;
  /** Intrinsic pixel size. Omit (the default) to scale to the container. */
  pxSize?: number | null;
  /**
   * Suffix that makes in-document ids unique. Required whenever two striped placards can share a page:
   * the old renderer hardcoded `id="cl"`, so FLAMMABLE SOLID and CLASS 9 collided and the first
   * definition silently clipped both (Class 9 came out with full-height stripes instead of §172.560's
   * top-half-only field). Defaults to a content hash, so callers get correctness without opting in.
   */
  idSuffix?: string;
}

// ── geometry ───────────────────────────────────────────────────────────────────────────────────
const CX = 100;
const CY = 100;
/** Half-diagonal of the outer diamond, in viewBox units. */
const R_OUTER = 96;
/** Along-axis inset of the inner border line: 9 units → 9/√2 ≈ 6.4 units ≈ 12.8 mm (§172.519). */
const INNER_INSET = 9;
const R_INNER = R_OUTER - INNER_INSET;

const OUTER = diamond(R_OUTER);
const INNER = diamond(R_INNER);

function diamond(r: number): string {
  return `${CX},${CY - r} ${CX + r},${CY} ${CX},${CY + r} ${CX - r},${CY}`;
}

/** Half-width of the diamond's interior at height y — the hard limit every glyph has to live inside. */
function halfWidthAt(y: number): number {
  return Math.max(0, R_OUTER - Math.abs(y - CY));
}

function halves(top: string, bottom: string): string {
  // top triangle and bottom triangle of the diamond, split at the horizontal diagonal
  return (
    `<polygon points="${CX},${CY - R_OUTER} ${CX + R_OUTER},${CY} ${CX - R_OUTER},${CY}" fill="${top}"/>` +
    `<polygon points="${CX - R_OUTER},${CY} ${CX + R_OUTER},${CY} ${CX},${CY + R_OUTER}" fill="${bottom}"/>`
  );
}

/**
 * §172.446 / §172.560: seven equal vertical stripes. Class 9 stripes the TOP HALF only; the flammable
 * solid stripes the whole diamond. Stripes are laid out as a 7-band field (stripe, gap, stripe, …)
 * centered on the vertical axis so the pattern reads symmetrically at any size.
 */
function stripes(base: string, stripe: string, region: "top" | "full", clipId: string): string {
  const clip = region === "top" ? `${CX},${CY - R_OUTER} ${CX + R_OUTER},${CY} ${CX - R_OUTER},${CY}` : OUTER;
  const STRIPE_COUNT = 7;
  const FIELD = 2 * R_OUTER; // full diagonal width; the clip trims it to the diamond
  const band = FIELD / (STRIPE_COUNT * 2 - 1); // stripes and gaps are equal width
  const bars: string[] = [];
  for (let i = 0; i < STRIPE_COUNT; i += 1) {
    const x = CX - R_OUTER + i * band * 2;
    bars.push(`<rect x="${round(x)}" y="0" width="${round(band)}" height="200" fill="${stripe}"/>`);
  }
  return (
    `<polygon points="${OUTER}" fill="${base}"/>` +
    `<clipPath id="${clipId}"><polygon points="${clip}"/></clipPath>` +
    `<g clip-path="url(#${clipId})">${bars.join("")}</g>`
  );
}

// ── pictograms ─────────────────────────────────────────────────────────────────────────────────
// Drawn inside the upper half, in a ~76 × 64 box centered on (100, 58). Every symbol is built from
// primitives with explicit coordinates so the shapes are auditable against the §172.5xx design
// sections rather than being eyeballed blobs.

function symbolSvg(sym: SymbolId, ink: string): string {
  switch (sym) {
    case "flame":
      // UN flame: a broad base tapering to a leaning tip, with the two inner tongues the DOT drawing has.
      return (
        `<path d="M100 20 C104 34 113 41 118 50 C120 44 120 39 119 35 C129 47 132 62 126 74` +
        ` C120 86 110 92 100 92 C90 92 79 86 73 74 C67 61 71 47 79 39 C78 44 79 50 82 54` +
        ` C83 42 92 33 100 20 Z" fill="${ink}"/>`
      );
    case "cylinder":
      // §172.528: an upright gas cylinder — body, neck and valve cap, as DOT Chart 17 draws it.
      return (
        `<g fill="${ink}">` +
        `<rect x="86" y="32" width="28" height="58" rx="13"/>` +
        `<rect x="94" y="22" width="12" height="12" rx="2"/>` +
        `<rect x="89" y="17" width="22" height="6" rx="2.5"/>` +
        `</g>`
      );
    case "skull":
      // §172.554 skull and crossbones: cranium + jaw over two crossed bones with knuckled ends.
      return (
        `<g stroke="${ink}" stroke-width="9" stroke-linecap="round">` +
        `<line x1="74" y1="74" x2="126" y2="94"/><line x1="126" y1="74" x2="74" y2="94"/>` +
        `</g>` +
        `<g fill="${ink}">` +
        `<circle cx="72" cy="72" r="6"/><circle cx="72" cy="96" r="6"/>` +
        `<circle cx="128" cy="72" r="6"/><circle cx="128" cy="96" r="6"/>` +
        `<path d="M100 24 C84 24 72 36 72 52 C72 60 75 66 80 70 L120 70 C125 66 128 60 128 52 C128 36 116 24 100 24 Z"/>` +
        `<path d="M84 72 h32 v6 a6 6 0 0 1 -6 6 h-20 a6 6 0 0 1 -6 -6 Z"/>` +
        `</g>` +
        `<g fill="${contrastOn(ink)}">` +
        `<ellipse cx="89" cy="49" rx="7" ry="8"/><ellipse cx="111" cy="49" rx="7" ry="8"/>` +
        `<path d="M100 56 l5 9 h-10 Z"/>` +
        `<rect x="92" y="75" width="3.5" height="7" rx="1"/>` +
        `<rect x="98.25" y="75" width="3.5" height="7" rx="1"/>` +
        `<rect x="104.5" y="75" width="3.5" height="7" rx="1"/>` +
        `</g>`
      );
    case "trefoil": {
      // §172.556 / ISO radiation trefoil: three 60° blades on 120° centers, gaps of 60°, blade inner
      // radius 1.5 r and outer radius 5 r about a center circle of radius r.
      const r = 5.5;
      const cx = 100;
      const cy = 56;
      const blades = [270, 30, 150]
        .map((deg) => bladePath(cx, cy, r * 1.5, r * 5, deg, 60))
        .join("");
      return `<g fill="${ink}"><circle cx="${cx}" cy="${cy}" r="${r}"/>${blades}</g>`;
    }
    case "corrosive":
      // §172.558: two tilted test tubes pour liquid — the left stream corrodes a flat metal plate,
      // the right stream corrodes a hand. Every vertex is kept inside |x−100| + |y−100| ≤ 88 so the
      // drawing cannot poke through the diamond's edge at any render size.
      return (
        `<g fill="${ink}">` +
        // left tube: mouth low-left, pouring onto the plate
        `<path d="M86 36 L96 44 L76 70 L66 62 Z"/>` +
        `<path d="M70 68 q-3 6 -3 11 l6 0 q0 -4 2 -8 Z"/>` +
        // right tube: mouth low-right, pouring onto the hand
        `<path d="M114 36 L104 44 L124 70 L134 62 Z"/>` +
        `<path d="M130 68 q3 6 3 11 l-6 0 q0 -4 -2 -8 Z"/>` +
        // corroded metal plate: a bar with a bite eaten out of its upper edge under the stream
        `<path d="M56 84 h38 v10 h-38 Z"/>` +
        `<path d="M62 84 q7 -9 13 0 Z" fill="${contrastOn(ink)}"/>` +
        // hand: palm, three fingers and a thumb, being eaten from above
        `<path d="M106 84 q0 -6 6 -6 h20 q6 0 6 6 v4 q0 8 -8 8 h-16 q-8 0 -8 -8 Z"/>` +
        `<path d="M111 79 v-8 q0 -3.5 3.5 -3.5 t3.5 3.5 v8 Z"/>` +
        `<path d="M120 79 v-11 q0 -3.5 3.5 -3.5 t3.5 3.5 v11 Z"/>` +
        `<path d="M129 79 v-9 q0 -3.5 3.5 -3.5 t3.5 3.5 v9 Z"/>` +
        `</g>`
      );
    case "oxidizer":
      // §172.550: a flame ON a circle — the flame rises from the top of the circle, it does not sit
      // inside a ring (the previous drawing filled the ring and read as a black blob).
      return (
        `<circle cx="100" cy="72" r="19" fill="none" stroke="${ink}" stroke-width="6"/>` +
        `<path d="M100 16 C102.5 26 109 31 112 37 C113.5 33 113.5 30 113 28 C119 35.5 121 45 117.5 51` +
        ` C114 57.5 108 61 100 61 C92 61 85.5 57.5 82.5 51 C79 44 81.5 35.5 87 30` +
        ` C86.5 33 87 37 88.5 40 C89.5 31 95 24.5 100 16 Z" fill="${ink}"/>`
      );
    case "explosion":
      // §172.522: exploding bomb — a body with a lit fuse and radiating fragments.
      return (
        `<g fill="${ink}">` +
        `<circle cx="98" cy="66" r="20"/>` +
        `<path d="M112 51 l6 -6 q4 -4 8 -2 l-3 5 q-3 -1 -5 1 l-4 4 Z"/>` +
        `<path d="M122 40 l3 -8 2 8 8 -3 -5 6 7 5 -8 1 2 8 -6 -6 -4 4 -3 -7 Z"/>` +
        `<path d="M74 44 l6 12 -13 -3 Z"/>` +
        `<path d="M64 74 l13 -2 -8 11 Z"/>` +
        `<path d="M96 96 l6 -12 8 11 Z"/>` +
        `<path d="M126 82 l-11 -5 12 -4 Z"/>` +
        `<path d="M86 34 l3 12 -11 -6 Z"/>` +
        `</g>`
      );
    case "none":
      return "";
  }
}

/** One trefoil blade: an annular sector of `sweep`° centered on `deg`°. */
function bladePath(cx: number, cy: number, rIn: number, rOut: number, deg: number, sweep: number): string {
  const a0 = ((deg - sweep / 2) * Math.PI) / 180;
  const a1 = ((deg + sweep / 2) * Math.PI) / 180;
  const p = (r: number, a: number): string => `${round(cx + r * Math.cos(a))} ${round(cy + r * Math.sin(a))}`;
  return (
    `<path d="M${p(rIn, a0)} L${p(rOut, a0)} A${rOut} ${rOut} 0 0 1 ${p(rOut, a1)}` +
    ` L${p(rIn, a1)} A${rIn} ${rIn} 0 0 0 ${p(rIn, a0)} Z"/>`
  );
}

/** A readable ink for detail drawn on top of a filled symbol (eye sockets, cylinder highlight). */
function contrastOn(ink: string): string {
  return ink.toUpperCase() === PALETTE.white.toUpperCase() ? PALETTE.black : PALETTE.white;
}

// ── wording ────────────────────────────────────────────────────────────────────────────────────
// The old renderer picked a font size from the WORD COUNT and never measured anything, so
// "NON-FLAMMABLE GAS", "SPONTANEOUSLY COMBUSTIBLE" and "DANGEROUS WHEN WET" ran straight out through
// the sides of the diamond. Text is now measured against Arial-Bold advance widths and shrunk/wrapped
// until every line fits the diamond's actual width at that line's baseline.

/** Arial Bold advance widths, per 1000 em, for the characters placard wording actually uses. */
const ADVANCE: Record<string, number> = {
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611,
  M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667,
  Y: 667, Z: 611, " ": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
};

/** Exported for the geometry test: the same measurement the layout uses, so a regression in one is a
 *  regression in the other. Estimation, not a font engine — Arial Bold advances at the given size. */
export function estimateTextWidth(s: string, fontSize: number): number {
  return textWidth(s, fontSize);
}

/** Exported for the geometry test: half-width of the diamond's interior at height `y`. */
export function diamondHalfWidthAt(y: number): number {
  return halfWidthAt(y);
}

function textWidth(s: string, fontSize: number): number {
  let em = 0;
  for (const ch of s.toUpperCase()) em += ADVANCE[ch] ?? 600;
  return (em / 1000) * fontSize;
}

/** Greedy wrap into at most `maxLines`, balancing so a 2-line split does not leave one word alone. */
function wrapWords(text: string, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1 || maxLines <= 1) return [words.join(" ")];
  if (words.length <= maxLines) return words;
  // balance by total character length rather than word count
  const lines: string[] = [];
  const target = Math.ceil(text.length / maxLines);
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && next.length > target && lines.length < maxLines - 1) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * The usable width for a line of type whose baseline sits at `y`. Measured at the glyph bottom (the
 * widest point for a line below the centerline) and pulled in past the inner border rule plus padding.
 */
function usableWidthAt(baselineY: number, fontSize: number): number {
  const glyphBottom = baselineY + fontSize * 0.14;
  const glyphTop = baselineY - fontSize * 0.72;
  const limit = Math.min(halfWidthAt(glyphBottom), halfWidthAt(glyphTop));
  const PADDING = 11; // inner border rule (≈6.4) + breathing room
  return Math.max(0, 2 * (limit - PADDING));
}

interface TextLayout {
  lines: string[];
  fontSize: number;
  firstBaseline: number;
  lineHeight: number;
}

/**
 * Fit the wording between the symbol and the class number. Tries every (lines, size) pair from most
 * generous to least and takes the first that genuinely fits — so short words stay big and
 * "SPONTANEOUSLY COMBUSTIBLE" quietly steps down instead of overflowing.
 */
function layoutText(text: string, blockCenterY: number): TextLayout | null {
  if (!text) return null;
  for (let fontSize = 22; fontSize >= 8; fontSize -= 0.5) {
    for (let maxLines = 1; maxLines <= 3; maxLines += 1) {
      const lines = wrapWords(text, maxLines);
      if (lines.length > maxLines) continue;
      const lineHeight = fontSize * 1.08;
      const blockHeight = lines.length * lineHeight;
      const firstBaseline = blockCenterY - blockHeight / 2 + fontSize * 0.78;
      const fits = lines.every((ln, i) =>
        textWidth(ln, fontSize) <= usableWidthAt(firstBaseline + i * lineHeight, fontSize),
      );
      if (fits) return { lines, fontSize, firstBaseline, lineHeight };
    }
  }
  return null;
}

function textBlock(text: string, ink: string, blockCenterY: number): string {
  const layout = layoutText(text, blockCenterY);
  if (!layout) return "";
  return layout.lines
    .map(
      (ln, i) =>
        `<text x="${CX}" y="${round(layout.firstBaseline + i * layout.lineHeight)}" text-anchor="middle"` +
        ` font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${round(layout.fontSize)}"` +
        ` letter-spacing="-0.2" fill="${ink}">${escapeXml(ln)}</text>`,
    )
    .join("");
}

/**
 * §172.332(c) identification-number band: a white rectangle 100 mm high × 215 mm wide (50 × 107 units)
 * whose top edge sits ~40 mm (20 units) above the horizontal centerline, carrying the number in 88 mm
 * (44 unit cap height) black numerals. The band is drawn edge-to-edge inside the diamond and outlined
 * so it reads on a white-topped placard (CORROSIVE, POISON) as clearly as on a colored one.
 */
function idBand(idNumber: string, borderInk: string): string {
  const H = 50;
  const W = 107;
  const y = CY - 20;
  const x = CX - W / 2;
  // 88 mm cap height ≈ 44 units; Alpine/Alternate Gothic is condensed, so the fallback stack is
  // condensed too and the block is scaled horizontally if a long number would otherwise overrun.
  const fontSize = 44 / 0.72;
  const digits = idNumber.replace(/[^0-9]/g, "");
  const natural = textWidth(digits, fontSize) * 0.82; // condensed face ≈ 0.82 of Arial Bold
  const maxWidth = W - 12;
  const scale = natural > maxWidth ? maxWidth / natural : 1;
  return (
    `<rect x="${x}" y="${y}" width="${W}" height="${H}" fill="${PALETTE.white}" stroke="${borderInk}" stroke-width="1.5"/>` +
    `<text x="${CX}" y="${y + H / 2}" text-anchor="middle" dominant-baseline="central"` +
    ` font-family="'Arial Narrow', 'Helvetica Neue Condensed', Arial, sans-serif" font-weight="700"` +
    ` font-size="${round(fontSize)}" transform="translate(${CX} 0) scale(${round(scale, 4)} 1) translate(${-CX} 0)"` +
    ` fill="${PALETTE.black}">${escapeXml(digits)}</text>`
  );
}

/**
 * The hazard class/division in the bottom corner. §172.519(b)(4) sets a 41 mm minimum for the class
 * number, which is 20.5 units here — but the bottom corner is also the narrowest part of the diamond,
 * so a two-and-a-bit character division like "5.1" or "1.1" has to be placed where it actually fits.
 * The block is set at the largest size that clears both the minimum and the diamond's own edges, and
 * it is raised off the point rather than sitting on it (the old fixed y=182 at 24 px put "5.1"
 * straight through the border rule).
 */
function classNumberBlock(classNumber: string | null, ink: string, underline: boolean): string {
  if (classNumber == null) return "";
  for (let fontSize = 30; fontSize >= 20; fontSize -= 0.5) {
    for (let baseline = 176; baseline >= 164; baseline -= 1) {
      const width = textWidth(classNumber, fontSize);
      const capTop = baseline - fontSize * 0.72;
      const room = 2 * (Math.min(halfWidthAt(baseline + 1), halfWidthAt(capTop)) - 8);
      if (width > room) continue;
      const line = underline
        ? `<line x1="${round(CX - width / 2 - 1)}" y1="${baseline + 4}" x2="${round(CX + width / 2 + 1)}" y2="${baseline + 4}" stroke="${ink}" stroke-width="3"/>`
        : "";
      return (
        `<text x="${CX}" y="${baseline}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"` +
        ` font-weight="700" font-size="${round(fontSize)}" fill="${ink}">${escapeXml(classNumber)}</text>${line}`
      );
    }
  }
  return "";
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Small stable hash so a render's internal ids are unique per design without needing a caller to care. */
function hashId(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function renderPlacardSvg(d: Design, opts: RenderOptions = {}): string {
  const idNumber = opts.idNumber?.trim() ? opts.idNumber.trim() : null;
  const suffix = opts.idSuffix ?? hashId(`${d.text}|${d.classNumber}|${d.symbol}|${JSON.stringify(d.background)}|${idNumber ?? ""}`);

  let bg: string;
  if (d.background.kind === "solid") bg = `<polygon points="${OUTER}" fill="${d.background.color}"/>`;
  else if (d.background.kind === "split") bg = halves(d.background.top, d.background.bottom);
  else bg = stripes(d.background.base, d.background.stripe, d.background.region, `pl-clip-${suffix}`);

  const symbolInk = d.symbolInk ?? d.ink;
  const textInk = d.textInk ?? d.ink;

  const number = classNumberBlock(d.classNumber, textInk, d.underlineNumber === true);

  // The wording sits just BELOW the horizontal centerline, where the diamond is at its widest — the old
  // renderer parked it at y≈120–150, the narrow part, which is why every long wording either overflowed
  // or had to be set tiny. With a §172.332(c) band the wording is suppressed entirely.
  const middle = idNumber ? idBand(idNumber, d.ink) : textBlock(d.text, textInk, 118);

  const sizeAttrs =
    opts.pxSize != null
      ? ` width="${opts.pxSize}" height="${opts.pxSize}"`
      : ` width="100%" height="100%"`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"${sizeAttrs}` +
    ` preserveAspectRatio="xMidYMid meet" focusable="false">` +
    bg +
    `<polygon points="${OUTER}" fill="none" stroke="${d.ink}" stroke-width="3"/>` +
    `<polygon points="${INNER}" fill="none" stroke="${d.ink}" stroke-width="2"/>` +
    symbolSvg(d.symbol, symbolInk) +
    middle +
    number +
    `</svg>`
  );
}
