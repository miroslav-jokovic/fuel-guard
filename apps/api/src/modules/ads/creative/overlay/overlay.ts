import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import sharp from "sharp";
import {
  checkClaims, checkRender, FORMAT_SIZE, parseHex, safeZone,
  type AdBrandKit, type AdBrief, type AdFormat, type AdOverlayLayout, type ClaimFinding, type PlacedText, type Rect, type RenderFinding, type Rgb,
} from "@silvicom/shared";
import { canDraw, pdfFontBytes } from "../../../../lib/pdfFonts.js";

/**
 * The overlay renderer for stills (ADS-AGENT-BUILD-WORKFLOW C4; plan D-AD9, D-AD12 §3): the words on an ad
 * image are drawn HERE, by us, never by the image model. One format and one language per call; bytes in,
 * PNG out — storing the result and recording it on the creative are compose's (C5).
 *
 * ── TEXT FROM THE BRIEF ONLY ───────────────────────────────────────────────────────────────────────
 * Every line drawn is re-checked with `checkClaims` against the brief, here, whatever checked it before:
 * the renderer is the last thing between a figure and the picture, so it does not trust its caller. The
 * one fixed line, `EEO_LINE`, is D-AD9's "Equal Opportunity Employer" — legal wording, not a brand value;
 * counsel confirms it with the rest of G12 / Q-AD8.
 *
 * ── THE TEMPLATE, AND REFUSING RATHER THAN SHRINKING ────────────────────────────────────────────────
 * A stack anchored to the bottom of the text zone (the kit's zone for the format, else `safeZone`): the
 * headline (bold, up to two lines), the call to action (bold, one line), the EEO line (one line); the
 * logo, when the kit has one, at the zone's top left. Sizes are fixed per format — never reduced to make
 * a line fit. A headline that needs a third line, any line wider than the zone, a stack taller than the
 * zone, or a character the bundled font cannot draw (it would print as an empty box) REFUSES, naming the
 * line (workflow C4: "a too-long line refuses rather than overflows").
 *
 * ── CONTRAST IS MEASURED UNDER THE TEXT ────────────────────────────────────────────────────────────
 * The image and the kit's plate are composed first; the pixels under each text box are sampled from THAT,
 * and `checkRender` (shared, pure) judges the worst one — so a bright patch behind a headline fails even
 * when the image averages dark. Any render finding refuses; no PNG is returned with a finding.
 *
 * No colour is invented: a format with no overlay in the kit (Q-AD14 not answered) refuses `no_template`.
 * Fonts are the repo's bundled Liberation Sans (`lib/pdfFonts.ts`), registered from its bytes, so a host
 * without system fonts renders the same pixels.
 */

export const EEO_LINE = { en: "Equal Opportunity Employer", es: "Empleador con igualdad de oportunidades" } as const;
export type OverlayLanguage = keyof typeof EEO_LINE;

const FAMILY = "AdsOverlaySans";
GlobalFonts.register(pdfFontBytes("regular"), FAMILY);
GlobalFonts.register(pdfFontBytes("bold"), FAMILY);

interface Style { px: number; bold: boolean; maxLines: number }
const TEMPLATE: Record<AdFormat, { headline: Style; cta: Style; eeo: Style; pad: number; gap: number; logoHeight: number }> = {
  "1:1": { headline: { px: 64, bold: true, maxLines: 2 }, cta: { px: 44, bold: true, maxLines: 1 }, eeo: { px: 26, bold: false, maxLines: 1 }, pad: 32, gap: 18, logoHeight: 110 },
  "4:5": { headline: { px: 66, bold: true, maxLines: 2 }, cta: { px: 46, bold: true, maxLines: 1 }, eeo: { px: 26, bold: false, maxLines: 1 }, pad: 32, gap: 20, logoHeight: 120 },
  "9:16": { headline: { px: 70, bold: true, maxLines: 2 }, cta: { px: 48, bold: true, maxLines: 1 }, eeo: { px: 28, bold: false, maxLines: 1 }, pad: 36, gap: 22, logoHeight: 130 },
};
const LINE_HEIGHT = 1.2;
/** Every SAMPLE_STEP-th pixel in each direction under a box is a contrast sample. */
const SAMPLE_STEP = 4;

export interface OverlayInput {
  format: AdFormat;
  language: OverlayLanguage;
  /** The generated image (C3's stored asset), any size; covered to the format's size. */
  base: Buffer;
  headline: string;
  cta: string;
  brief: Pick<AdBrief, "claims">;
  kit: Pick<AdBrandKit, "overlays">;
  /** The kit's logo bytes, or null for Q-AD14's fallback (no logo). */
  logo: Buffer | null;
  /** The preset's layout (CQ6); absent = `bottom_plate`, the layout every ad had before. */
  layout?: AdOverlayLayout;
}

export type OverlayFinding =
  | RenderFinding
  | { kind: "no_template"; format: AdFormat }
  | { kind: "too_long"; label: string; lines: number; max_lines: number }
  | { kind: "stack_too_tall"; needed: number; zone_height: number }
  | { kind: "undrawable_character"; label: string; character: string }
  | ({ kind: "claim"; label: string } & Pick<ClaimFinding, "text"> & { claim: ClaimFinding["kind"] });

export type OverlayOutcome =
  | { kind: "rendered"; png: Buffer; blocks: PlacedText[] }
  | { kind: "refused"; findings: OverlayFinding[] };

const fontOf = (s: Style) => `${s.bold ? "bold " : ""}${s.px}px ${FAMILY}`;

/** Greedy word wrap at `width`; a single word wider than `width` stays one (over-wide) line for the check to refuse. */
function wrap(ctx: SKRSContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function samplesUnder(ctx: SKRSContext2D, box: Rect): Rgb[] {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const w = Math.max(1, Math.floor(box.width));
  const h = Math.max(1, Math.floor(box.height));
  const data = ctx.getImageData(x, y, w, h).data;
  const out: Rgb[] = [];
  for (let j = 0; j < h; j += SAMPLE_STEP) {
    for (let i = 0; i < w; i += SAMPLE_STEP) {
      const at = (j * w + i) * 4;
      out.push([data[at]!, data[at + 1]!, data[at + 2]!]);
    }
  }
  return out;
}

/**
 * The image as it fills `format`'s frame, before any text: what the overlay draws on, and what the visual
 * check looks at (C5b) — one function, so the checker sees exactly the pixels the ad is made of.
 */
export async function frameStill(image: Buffer, format: AdFormat): Promise<Buffer> {
  const { width, height } = FORMAT_SIZE[format];
  return sharp(image).resize(width, height, { fit: "cover" }).png().toBuffer();
}

/** What `layOut` needs: everything about the words and where they go, nothing about the picture. */
export type OverlayText = Pick<OverlayInput, "format" | "language" | "headline" | "cta" | "brief" | "kit" | "layout">;

const measurer = createCanvas(8, 8).getContext("2d");

/**
 * Steps 1 and 2 of the overlay, with no image: is every line from the brief and drawable, and does the stack fit
 * the zone at its fixed sizes. Whether the words FIT is a fact about the words, the format and the layout — the
 * picture changes none of it — so compose asks this before it pays for a picture (`overlayFit`, D-AD26), and
 * `renderOverlay` asks the same function, so the answer before the render and the answer at it cannot differ.
 * Measured on a canvas of its own: the font, not the canvas, decides a width.
 */
function layOut(input: OverlayText) {
  const { format, language } = input;
  const overlay = input.kit.overlays[format];
  if (!overlay) return { ok: false as const, findings: [{ kind: "no_template", format }] satisfies OverlayFinding[] };
  const t = TEMPLATE[format];
  const zone = overlay.zone ?? safeZone(format);
  const lines = [
    { label: "headline", text: input.headline.trim(), style: t.headline },
    { label: "cta", text: input.cta.trim(), style: t.cta },
    { label: "eeo", text: EEO_LINE[language], style: t.eeo },
  ];

  // 1. Text from the brief only, drawable by the bundled font.
  const findings: OverlayFinding[] = [];
  for (const l of lines) {
    for (const f of checkClaims(l.text, input.brief).findings) findings.push({ kind: "claim", label: l.label, text: f.text, claim: f.kind });
    const bad = [...l.text].find((ch) => !/\s/.test(ch) && !canDraw(ch));
    if (bad) findings.push({ kind: "undrawable_character", label: l.label, character: bad });
  }
  if (findings.length) return { ok: false as const, findings };

  // 2. Lay out the stack at fixed sizes — where it sits in the zone is the layout's (step 2b).
  const innerWidth = zone.width - 2 * t.pad;
  const laid = lines.map((l) => {
    measurer.font = fontOf(l.style);
    const wrapped = wrap(measurer, l.text, innerWidth);
    const needed = Math.max(...wrapped.map((w) => measurer.measureText(w).width));
    return { ...l, wrapped, needed, height: Math.ceil(wrapped.length * l.style.px * LINE_HEIGHT) };
  });
  for (const l of laid) {
    if (l.wrapped.length > l.style.maxLines) findings.push({ kind: "too_long", label: l.label, lines: l.wrapped.length, max_lines: l.style.maxLines });
    // One word wider than the zone stays one line (`wrap`); said here as the render check would say it.
    if (Math.ceil(l.needed) > innerWidth) findings.push({ kind: "overflows", label: l.label, needed_width: Math.ceil(l.needed), width: innerWidth });
  }
  const stackHeight = laid.reduce((n, l) => n + l.height, 0) + t.gap * (laid.length - 1) + 2 * t.pad;
  if (stackHeight > zone.height) findings.push({ kind: "stack_too_tall", needed: stackHeight, zone_height: zone.height });
  if (findings.length) return { ok: false as const, findings };
  return { ok: true as const, overlay, t, zone, innerWidth, laid, stackHeight };
}

/**
 * Why these words cannot be drawn on this format in this layout, or nothing when they can (D-AD26). No image is
 * read and none is made. Contrast is NOT answered here: it is measured under the text on the finished picture.
 */
export function overlayFit(input: OverlayText): OverlayFinding[] {
  const l = layOut(input);
  return l.ok ? [] : l.findings;
}

export async function renderOverlay(input: OverlayInput): Promise<OverlayOutcome> {
  const { format } = input;
  const layout: AdOverlayLayout = input.layout ?? "bottom_plate";
  const l = layOut(input);
  if (!l.ok) return { kind: "refused", findings: l.findings };
  const { overlay, t, zone, innerWidth, laid, stackHeight } = l;
  const textColor = parseHex(overlay.text_color)!;
  const plate = overlay.plate_color ? parseHex(overlay.plate_color)! : null;
  const { width: W, height: H } = FORMAT_SIZE[format];
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // 2b. Where the stack sits (CQ6): its top edge, by layout. The stack's own height never changes.
  const stackInner = stackHeight - 2 * t.pad;
  const stackTop = layout === "bottom_plate" ? zone.y + zone.height - t.pad - stackInner
    : layout === "top_band" ? zone.y + t.pad
    : zone.y + Math.floor((zone.height - stackInner) / 2);
  const blocks: Array<PlacedText & { wrapped: string[]; style: Style }> = [];
  let y = stackTop;
  for (const l of laid) {
    blocks.push({
      label: l.label, box: { x: zone.x + t.pad, y, width: innerWidth, height: l.height }, needed_width: Math.ceil(l.needed),
      px: l.style.px, bold: l.style.bold, color: textColor, background_samples: [], wrapped: l.wrapped, style: l.style,
    });
    y += l.height + t.gap;
  }

  // 3. Compose the background: the image covered to the frame, the plate behind the stack, the logo where the
  //    layout keeps it clear of the words.
  const base = await loadImage(await frameStill(input.base, format));
  ctx.drawImage(base, 0, 0, W, H);
  if (plate) {
    ctx.fillStyle = overlay.plate_color!;
    const plateTop = stackTop - t.pad;
    const plateBottom = layout === "bottom_plate" ? zone.y + zone.height : blocks[blocks.length - 1]!.box.y + blocks[blocks.length - 1]!.box.height + t.pad;
    ctx.fillRect(zone.x, plateTop, zone.width, plateBottom - plateTop);
  }
  if (input.logo) {
    const logo = await loadImage(input.logo);
    const scale = Math.min(t.logoHeight / logo.height, innerWidth / 2 / logo.width);
    const lw = logo.width * scale, lh = logo.height * scale;
    if (layout === "top_band") ctx.drawImage(logo, zone.x + zone.width - t.pad - lw, zone.y + zone.height - t.pad - lh, lw, lh);
    else ctx.drawImage(logo, zone.x + t.pad, zone.y + t.pad, lw, lh);
  }

  // 4. Measure what lies under each box, judge, and only then draw the words.
  for (const b of blocks) b.background_samples = samplesUnder(ctx, b.box);
  const placed: PlacedText[] = blocks.map(({ wrapped: _w, style: _s, ...p }) => p);
  const verdict = checkRender(format, placed, zone);
  if (verdict.length) return { kind: "refused", findings: verdict };
  ctx.fillStyle = overlay.text_color;
  ctx.textBaseline = "top";
  ctx.textAlign = layout === "centered" ? "center" : "left";
  const textX = (b: Rect) => (layout === "centered" ? b.x + b.width / 2 : b.x);
  for (const b of blocks) {
    ctx.font = fontOf(b.style);
    b.wrapped.forEach((line, i) => ctx.fillText(line, textX(b.box), b.box.y + i * b.style.px * LINE_HEIGHT));
  }
  return { kind: "rendered", png: await canvas.encode("png"), blocks: placed };
}
