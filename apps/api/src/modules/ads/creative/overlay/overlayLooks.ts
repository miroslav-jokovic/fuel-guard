import { contrastRatio, parseHex, type AdBrandKit, type AdLook, type Rgb } from "@silvicom/shared";
import type { AdFace } from "../../../../lib/adFonts.js";

/**
 * What each look IS, as data, and which of the kit's colours it draws with (ADS-AD-LOOK-PLAN D-ADL16–D-ADL19).
 * Nothing here draws or measures: `overlayLayout.ts` measures the words into a look, `overlay.ts` paints it.
 *
 * ── THREE LOOKS, NO ORNAMENT (2026-11-12) ──────────────────────────────────────────────────────────
 * The owner on the two looks before these (`rail`, `ribbon`): every device "individually works" and together the
 * ad "doesn't look really professional", and "avoid using any dots and lines, these are generic AI things". The
 * same day's research named the rest (`.claude/skills/silvicom-brand/SKILL.md`, "Banned"): side rails, ribbon
 * tags, pill and chevron buttons, hairlines and tracked kickers are all gone. What is left is what real carrier
 * ads use — one brand colour as a solid field, a heavy headline, one supporting line — in three compositions:
 *   · `field`  — the picture, then a solid band in the kit's ground colour holding the words. The default.
 *   · `number` — the same band, with the headline's opening figure as the band's biggest object and the rest of
 *                the headline beside it. Only for a headline that OPENS with a figure; any other is drawn `field`.
 *   · `photo`  — the whole picture, the words straight on it, darkened under them only as much as it needs.
 * No look draws a call-to-action button (D-ADL19: Meta draws its own) or the kicker as a label: a preset with a
 * kicker and no second line has the kicker drawn AS the second line, sentence case, the one supporting line.
 *
 * ── SIZES ARE THE FRAME'S ──────────────────────────────────────────────────────────────────────────
 * Every figure below is in pixels of a frame 1080 wide; the layout multiplies by `width / 1080`. Only the
 * headline (and `number`'s figure) steps down a ladder; every other line has ONE size and refuses rather than
 * shrinks. The supporting line's 47 is not a taste: it is the size at which 28 of the widest capital (W) fit the
 * narrowest safe zone (9:16, 906 wide) and 29 do not, which is what `OVERLAY_SMALL_LINE_MAX_CHARS` promises the
 * preset save. Measured 2026-11-12: W is 0.6755 of the size in Big Shoulders Text Medium. The headline's floor
 * (80) is measured too: at 76–80 the longest recorded headline that fits is 58, `OVERLAY_HEADLINE_MAX_CHARS`; at 72
 * it is 62 and at 66, 67 — a smaller floor would let the overlay draw what the save refuses, at a size too small to lead.
 */
export interface TextStyle { face: AdFace; px: number; tracking: number }

export interface LookSpec {
  /** Where the words sit: on a solid band of the kit's ground colour, or on the picture. */
  ground: "band" | "picture";
  headline: { ladder: readonly number[]; lineGap: number; figuresInAccent: boolean };
  sub: TextStyle & { gapBefore: number };
  footer: { phone: TextStyle; eeo: TextStyle; gapBefore: number };
  /** The band: its least share of the frame's height (one seam across ads, the design review's ask) and its inner top padding. */
  band: { minShare: number; padTop: number } | null;
  /**
   * `number`'s figure: its ladder, the rest of the headline's size as a share of the figure's but never under
   * `restMin` (the words beside the figure must stay a size above the 47 px supporting line), and the gap between.
   */
  figure: { ladder: readonly number[]; restShare: number; restMin: number; gap: number } | null;
}

const SUB: LookSpec["sub"] = { face: "text", px: 47, tracking: 0, gapBefore: 24 };
const FOOTER: LookSpec["footer"] = { phone: { face: "text", px: 28, tracking: 0 }, eeo: { face: "text", px: 24, tracking: 0 }, gapBefore: 36 };
const BAND = { minShare: 0.3, padTop: 48 } as const;

export const LOOKS: Record<AdLook, LookSpec> = {
  field: {
    ground: "band", band: BAND, figure: null, sub: SUB, footer: FOOTER,
    headline: { ladder: [150, 136, 124, 112, 100, 90, 80], lineGap: 0.12, figuresInAccent: true },
  },
  number: {
    ground: "band", band: BAND, sub: SUB, footer: FOOTER,
    headline: { ladder: [150, 136, 124, 112, 100, 90, 80], lineGap: 0.12, figuresInAccent: true },
    figure: { ladder: [300, 270, 240, 214, 190, 168, 150], restShare: 0.32, restMin: 64, gap: 48 },
  },
  photo: {
    ground: "picture", band: null, figure: null, sub: SUB, footer: FOOTER,
    headline: { ladder: [168, 152, 138, 124, 112, 100, 90, 80], lineGap: 0.12, figuresInAccent: false },
  },
};

/** The share of the frame's height the stack may take before the headline steps down (see `overlayLayout`). */
export const QUIET_SHARE = 0.4;

/**
 * How strongly the picture is blended toward the kit's ground colour under the words (D-ADL1), weakest first —
 * the `photo` look only; the band looks put their words on a solid colour. The renderer takes the first step at
 * which every line on the picture reaches `SCRIM_TARGET`, so a picture that is already dark under the words is
 * darkened least, often not visibly. It is a measured correction for contrast, not a decorative fade.
 */
export const SCRIM_STEPS = [0.45, 0.6, 0.72, 0.82, 0.9, 0.96] as const;
/** WCAG's body-text ratio, asked of display text too: the render check's 3:1 is the floor, not the aim. */
export const SCRIM_TARGET = 4.5;

export interface Palette {
  text: string;
  /** The band's colour, and what the picture is blended toward under `photo`'s words; null = the kit asked for words straight on the picture. */
  ground: string | null;
  accent: string;
  /** The kit's primary colour: the band's colour when the kit names no ground. */
  primary: string | null;
}

const rgb = (hex: string): Rgb => parseHex(hex)!;
export const contrastOf = (a: string, b: string): number => contrastRatio(rgb(a), rgb(b));

/** Of the two colours a kit's overlay already holds, the one that reads better on `fill` — never a third. */
export function inkOn(fill: string, p: Pick<Palette, "text" | "ground">): string {
  const other = p.ground ?? (contrastOf(p.text, "#000000") > contrastOf(p.text, "#FFFFFF") ? "#000000" : "#FFFFFF");
  return contrastOf(other, fill) >= contrastOf(p.text, fill) ? other : p.text;
}

/**
 * The colours a look draws with, all read from the kit (D-ADL5). `text_color` is the words, `plate_color` is the
 * ground: the band's colour, and what `photo` darkens toward (null = no darkening, the render check alone decides).
 *
 * The accent is the colour the kit NAMES accent; else the kit colour that stands out most from the ground,
 * provided it is readable there (3:1) and is not the text colour again. A kit with no such colour draws its
 * figures in the text colour: one colour used twice, rather than one invented. For Silvicom the ground is the
 * wordmark's navy and the accent the trailer decal's cyan (D-ADL16).
 */
export function paletteOf(overlay: NonNullable<AdBrandKit["overlays"]["4:5"]>, colors: AdBrandKit["colors"] | undefined): Palette {
  const text = overlay.text_color, ground = overlay.plate_color;
  const named = (re: RegExp) => colors?.find((c) => re.test(c.name))?.hex ?? null;
  const usable = (hex: string) => contrastOf(hex, text) >= 1.5 && (ground === null || contrastOf(hex, ground) >= 3);
  const byContrast = [...(colors ?? [])].map((c) => c.hex).filter(usable)
    .sort((a, b) => (ground ? contrastOf(b, ground) - contrastOf(a, ground) : 0));
  const namedAccent = named(/accent/i);
  const accent = namedAccent && usable(namedAccent) ? namedAccent : byContrast[0] ?? text;
  return { text, ground, accent, primary: named(/primary/i) ?? colors?.[0]?.hex ?? ground };
}
