import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import sharp from "sharp";
import {
  checkClaims, checkRender, FORMAT_SIZE, parseHex, safeZone,
  type AdBrandKit, type AdBrief, type AdFormat, type ClaimFinding, type PlacedText, type Rect, type RenderFinding, type Rgb,
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

export async function renderOverlay(input: OverlayInput): Promise<OverlayOutcome> {
  const { format, language } = input;
  const overlay = input.kit.overlays[format];
  if (!overlay) return { kind: "refused", findings: [{ kind: "no_template", format }] };
  const t = TEMPLATE[format];
  const zone = overlay.zone ?? safeZone(format);
  const textColor = parseHex(overlay.text_color)!;
  const plate = overlay.plate_color ? parseHex(overlay.plate_color)! : null;
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
  if (findings.length) return { kind: "refused", findings };

  // 2. Lay out the stack from the bottom of the zone up, at fixed sizes.
  const { width: W, height: H } = FORMAT_SIZE[format];
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const innerWidth = zone.width - 2 * t.pad;
  const laid = lines.map((l) => {
    ctx.font = fontOf(l.style);
    const wrapped = wrap(ctx, l.text, innerWidth);
    const needed = Math.max(...wrapped.map((w) => ctx.measureText(w).width));
    return { ...l, wrapped, needed, height: Math.ceil(wrapped.length * l.style.px * LINE_HEIGHT) };
  });
  for (const l of laid) if (l.wrapped.length > l.style.maxLines) findings.push({ kind: "too_long", label: l.label, lines: l.wrapped.length, max_lines: l.style.maxLines });
  const stackHeight = laid.reduce((n, l) => n + l.height, 0) + t.gap * (laid.length - 1) + 2 * t.pad;
  if (stackHeight > zone.height) findings.push({ kind: "stack_too_tall", needed: stackHeight, zone_height: zone.height });
  if (findings.length) return { kind: "refused", findings };

  const blocks: Array<PlacedText & { wrapped: string[]; style: Style }> = [];
  let y = zone.y + zone.height - t.pad;
  for (const l of [...laid].reverse()) {
    y -= l.height;
    blocks.unshift({
      label: l.label, box: { x: zone.x + t.pad, y, width: innerWidth, height: l.height }, needed_width: Math.ceil(l.needed),
      px: l.style.px, bold: l.style.bold, color: textColor, background_samples: [], wrapped: l.wrapped, style: l.style,
    });
    y -= t.gap;
  }

  // 3. Compose the background: the image covered to the frame, the plate behind the stack, the logo.
  const base = await loadImage(await sharp(input.base).resize(W, H, { fit: "cover" }).png().toBuffer());
  ctx.drawImage(base, 0, 0, W, H);
  if (plate) {
    const top = blocks[0]!.box.y - t.pad;
    ctx.fillStyle = overlay.plate_color!;
    ctx.fillRect(zone.x, top, zone.width, zone.y + zone.height - top);
  }
  if (input.logo) {
    const logo = await loadImage(input.logo);
    const scale = Math.min(t.logoHeight / logo.height, innerWidth / 2 / logo.width);
    ctx.drawImage(logo, zone.x + t.pad, zone.y + t.pad, logo.width * scale, logo.height * scale);
  }

  // 4. Measure what lies under each box, judge, and only then draw the words.
  for (const b of blocks) b.background_samples = samplesUnder(ctx, b.box);
  const placed: PlacedText[] = blocks.map(({ wrapped: _w, style: _s, ...p }) => p);
  const verdict = checkRender(format, placed, zone);
  if (verdict.length) return { kind: "refused", findings: verdict };
  ctx.fillStyle = overlay.text_color;
  ctx.textBaseline = "top";
  for (const b of blocks) {
    ctx.font = fontOf(b.style);
    b.wrapped.forEach((line, i) => ctx.fillText(line, b.box.x, b.box.y + i * b.style.px * LINE_HEIGHT));
  }
  return { kind: "rendered", png: await canvas.encode("png"), blocks: placed };
}
