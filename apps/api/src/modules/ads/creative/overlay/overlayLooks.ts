import { contrastRatio, parseHex, type AdBrandKit, type AdLook, type Rgb } from "@silvicom/shared";
import type { AdFace } from "../../../../lib/adFonts.js";

/**
 * What each look IS, as data, and which of the kit's colours it draws with (ADS-AD-LOOK-PLAN D-ADL2–D-ADL7).
 * Nothing here draws or measures: `overlayLayout.ts` measures the words into a look, `overlay.ts` paints it.
 *
 * ── SIZES ARE THE FRAME'S ──────────────────────────────────────────────────────────────────────────
 * Every figure below is in pixels of a frame 1080 wide, and the layout multiplies by `width / 1080`, so a
 * format of another width draws the same design. Until D-ADL3 the sizes were a table per format (64/44/26,
 * 66/46/26, 70/48/28) that moved the same three lines by two pixels.
 *
 * ── ONLY THE HEADLINE STEPS ────────────────────────────────────────────────────────────────────────
 * `ladder` is the headline's sizes, largest first. The layout takes the first that holds the words in one or
 * two lines and keeps the stack inside the part of the picture the art director was told to leave plain; below
 * the last rung it refuses `too_long`. Every other line has ONE size and refuses rather than shrinks, as the
 * whole stack did before: a headline a fifth smaller is still a headline, a legal line a fifth smaller is not
 * readable, and the floor is what the refusal protects.
 */
export interface TextStyle { face: AdFace; px: number; tracking: number }

export interface LookSpec {
  align: "left" | "center";
  headline: { face: AdFace; ladder: readonly number[]; lineGap: number; figuresInAccent: boolean };
  kicker: TextStyle & { color: "accent" | "text"; gapAfter: number };
  /** The second line: plain text under the headline, or text on a ribbon in the accent colour. */
  sub: TextStyle & { ribbon: { height: number; padX: number } | null; gapBefore: number };
  button: TextStyle & { height: number; padX: number; radius: number | "pill"; fill: "accent" | "text"; gapBefore: number };
  footer: { phone: TextStyle; eeo: TextStyle; band: { height: number } | null; gapBefore: number };
  /** A bar in the accent colour beside the stack, and how far the stack is set in from it. */
  rail: { width: number; inset: number } | null;
}

export const LOOKS: Record<AdLook, LookSpec> = {
  rail: {
    align: "left",
    headline: { face: "extrabold", ladder: [176, 160, 144, 128, 112, 96, 84], lineGap: 0.14, figuresInAccent: true },
    kicker: { face: "bold", px: 32, tracking: 7, color: "accent", gapAfter: 28 },
    sub: { face: "semibold", px: 44, tracking: 2, ribbon: null, gapBefore: 28 },
    button: { face: "bold", px: 34, tracking: 3, height: 76, padX: 34, radius: 10, fill: "accent", gapBefore: 36 },
    footer: { phone: { face: "bold", px: 40, tracking: 1 }, eeo: { face: "medium", px: 24, tracking: 0 }, band: { height: 104 }, gapBefore: 44 },
    rail: { width: 8, inset: 30 },
  },
  ribbon: {
    align: "center",
    headline: { face: "anton", ladder: [168, 152, 136, 120, 104, 92, 80], lineGap: 0.16, figuresInAccent: false },
    kicker: { face: "semibold", px: 34, tracking: 9, color: "text", gapAfter: 30 },
    sub: { face: "bold", px: 34, tracking: 5, ribbon: { height: 62, padX: 32 }, gapBefore: 30 },
    button: { face: "bold", px: 34, tracking: 3, height: 78, padX: 44, radius: "pill", fill: "text", gapBefore: 40 },
    footer: { phone: { face: "bold", px: 29, tracking: 1 }, eeo: { face: "medium", px: 25, tracking: 0 }, band: null, gapBefore: 34 },
    rail: null,
  },
};

/** The share of the frame's height the stack may take before the headline steps down (see `overlayLayout`). */
export const QUIET_SHARE = 0.4;

/**
 * How strongly the picture is blended toward the kit's ground colour under the words (D-ADL1), weakest first.
 * The renderer takes the first step at which every line on the picture reaches `SCRIM_TARGET`, so a picture
 * that is already dark under the words is darkened least. The last step is nearly the ground colour itself:
 * the words are then on a soft panel, which is still not a pasted rectangle — it fades into the picture.
 */
export const SCRIM_STEPS = [0.45, 0.6, 0.72, 0.82, 0.9, 0.96] as const;
/** WCAG's body-text ratio, asked of display text too: the render check's 3:1 is the floor, not the aim. */
export const SCRIM_TARGET = 4.5;

export interface Palette {
  text: string;
  /** What the picture is blended toward under the words; null = the kit asked for words straight on the picture. */
  ground: string | null;
  accent: string;
  /** The footer band's colour, or null when the kit names nothing a band could be. */
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
 * The colours a look draws with, all read from the kit (D-ADL5) — until this, `kit.colors` was stored and read
 * by nothing (audit F-AG9). The overlay's own two colours keep their meaning with the plate gone: `text_color`
 * is the words, `plate_color` is the ground the picture darkens toward under them (null = no darkening, and the
 * render check alone decides, as a null plate always meant).
 *
 * The accent is the colour the kit NAMES accent; else the kit colour that stands out most from the ground,
 * provided it is readable there (3:1) and is not the text colour again. A kit with no such colour draws its
 * accent shapes in the text colour: one colour used twice, rather than one invented.
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
