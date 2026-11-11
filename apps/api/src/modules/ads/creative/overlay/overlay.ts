import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import sharp from "sharp";
import {
  checkRender, contrastRatio, FORMAT_SIZE, parseHex,
  type AdFormat, type AdOverlayLayout, type PlacedText, type Rect, type Rgb,
} from "@silvicom/shared";
import { CHEVRON, fontOf, layOut, type Laid, type LaidRow, type OverlayFinding, type OverlayText } from "./overlayLayout.js";
import { inkOn, SCRIM_STEPS, SCRIM_TARGET } from "./overlayLooks.js";

export { EEO_LINE } from "./overlayLayout.js";
export type { OverlayFinding, OverlayLanguage, OverlayText } from "./overlayLayout.js";

/**
 * The overlay renderer for stills (ADS-AGENT-BUILD-WORKFLOW C4; plan D-AD9, D-AD12 §3; ADS-AD-LOOK-PLAN): the
 * words on an ad image are drawn HERE, by us, never by the image model. One format and one language per call;
 * bytes in, PNG out — storing the result and recording it on the creative are compose's (C5).
 *
 * ── WHAT CHANGED ON 2026-11-10, AND WHY ────────────────────────────────────────────────────────────
 * Until then this drew one office sans at three fixed sizes inside a flat rectangle (the "plate") pasted on the
 * picture. The owner's verdict on the result: "they don't look really good, professional and enterprise grade."
 * Now the words sit ON the picture in display faces, the picture is darkened under them, the call to action is
 * a drawn button, the kit's colours are used, and the phone and the legal line have a footer. WHERE things go
 * and whether the words fit is `overlayLayout.ts`; WHAT a look is, is `overlayLooks.ts`; this file paints.
 *
 * ── THE SCRIM IS MEASURED, NOT A CONSTANT ──────────────────────────────────────────────────────────
 * The picture is blended toward the kit's ground colour across the stack and fades out beyond it (D-ADL1). How
 * strongly is decided per picture: the pixels under every line that sits on the picture are read first, and the
 * weakest step of `SCRIM_STEPS` at which the worst of them reaches `SCRIM_TARGET` is used. A constant was
 * measured on the mock-ups and was wrong in both directions — the same scrim gave a headline 14:1 over a
 * prairie road and 1.2:1 where it climbed onto a white cab.
 *
 * ── CONTRAST IS STILL JUDGED UNDER THE TEXT, ON THE FINISHED BACKGROUND ────────────────────────────
 * Choosing a step is arithmetic; the verdict is not. After the scrim and every shape are painted, the pixels
 * under each line are sampled from THAT canvas and `checkRender` (shared, pure) judges the worst one. Any
 * finding refuses; no PNG is returned with a finding. A kit whose `plate_color` is null asked for words straight
 * on the picture: nothing is darkened and the check alone decides, as a null plate always meant.
 */

export interface OverlayInput extends OverlayText {
  /** The generated image (C3's stored asset), any size; covered to the format's size. */
  base: Buffer;
  /** The kit's logo bytes, or null for Q-AD14's fallback (no logo). */
  logo: Buffer | null;
}

export type OverlayOutcome =
  | { kind: "rendered"; png: Buffer; blocks: PlacedText[]; /** Kicker to button: the band the visual check judges. */ stack: Rect; /** The scrim step used; 0 when nothing was darkened. */ scrim: number }
  | { kind: "refused"; findings: OverlayFinding[] };

/** Every SAMPLE_STEP-th pixel in each direction under a line is a contrast sample. */
const SAMPLE_STEP = 4;
const rgbOf = (hex: string): Rgb => parseHex(hex)!;

/** The pixels under one rectangle, each with the row it came from (the scrim's strength depends on the row). */
function samplesUnder(ctx: SKRSContext2D, box: Rect, frame: { width: number; height: number }): Array<{ rgb: Rgb; y: number }> {
  const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
  const w = Math.max(1, Math.min(frame.width - x, Math.floor(box.width))), h = Math.max(1, Math.min(frame.height - y, Math.floor(box.height)));
  const data = ctx.getImageData(x, y, w, h).data;
  const out: Array<{ rgb: Rgb; y: number }> = [];
  for (let j = 0; j < h; j += SAMPLE_STEP) {
    for (let i = 0; i < w; i += SAMPLE_STEP) {
      const at = (j * w + i) * 4;
      out.push({ rgb: [data[at]!, data[at + 1]!, data[at + 2]!], y: y + j });
    }
  }
  return out;
}

/**
 * The image as it fills `format`'s frame, before any text: what the overlay draws on, and what the visual
 * check looks at (C5b) — one function, so the checker sees exactly the pixels the ad is made of. Where the
 * picture is larger than the frame, `layout` decides which edge is kept (`CUT_KEEPS`).
 */
export async function frameStill(image: Buffer, format: AdFormat, layout: AdOverlayLayout = "bottom_plate"): Promise<Buffer> {
  const { width, height } = FORMAT_SIZE[format];
  return sharp(image).resize(width, height, { fit: "cover", position: CUT_KEEPS[layout] }).png().toBuffer();
}

/**
 * Which edge of the picture a cut keeps (AG4; Q-AD75, ruled 2026-11-10). One picture is made, for the first
 * published frame (4:5), and the art director was told to keep the part under the words plain
 * (`QUIET_REGION`, D-AD28). A shorter frame cut from it (1:1) must put ITS words over that same plain part —
 * and the stack sits against the zone's edge the layout names. So the cut keeps the words' edge: the bottom
 * for `bottom_plate`, the top for `top_band`. What is cut away is the far edge of the subject's side, the sky
 * above a truck or the road below it. Until AG4 every cut was the centre, which slides the words up onto the
 * subject by half of what was removed (135 px of a 4:5 → 1:1 cut). `centered` has its words in the middle,
 * and the centre is the cut that keeps them there.
 *
 * Only the cropped axis moves: a picture wider than the frame still loses its two sides equally.
 */
const CUT_KEEPS: Record<AdOverlayLayout, "south" | "north" | "centre"> = { bottom_plate: "south", top_band: "north", centered: "centre" };

/**
 * Why these words cannot be drawn on this format in this layout and look, or nothing when they can (D-AD26). No
 * image is read and none is made. Contrast is NOT answered here: it is measured under the text on the finished
 * picture. Whether a logo will be drawn is read from the kit, which is where compose reads the logo from.
 */
export function overlayFit(input: OverlayText): OverlayFinding[] {
  const l = layOut({ ...input, hasLogo: Boolean(input.kit.logo) });
  return l.ok ? [] : l.findings;
}

/** How much of the scrim's full strength row `y` gets: all of it inside a span, easing to none beyond it. */
function scrimShare(l: Laid, y: number): number {
  const fade = l.height * 0.16;
  let most = 0;
  for (const [from, to] of l.scrim) {
    const t = Math.min(1, (y < from ? from - y : y > to ? y - to : 0) / fade);
    most = Math.max(most, 1 - t * t * (3 - 2 * t));
  }
  return most;
}

const blend = (under: Rgb, over: Rgb, a: number): Rgb => [under[0] * (1 - a) + over[0] * a, under[1] * (1 - a) + over[1] * a, under[2] * (1 - a) + over[2] * a];
const lineBox = (row: LaidRow, i: number): Rect => ({ x: row.lines[i]!.x, y: row.lines[i]!.y, width: row.lines[i]!.width, height: row.cap });
const colorsOf = (row: LaidRow) => [row.color, ...(row.figureColor ? [row.figureColor] : [])];

/** The weakest step at which every line on the picture reaches the target; the strongest when none does. */
function scrimFor(ctx: SKRSContext2D, l: Laid): number {
  if (!l.palette.ground) return 0;
  const ground = rgbOf(l.palette.ground);
  const under = l.rows.filter((r) => r.on === "picture").flatMap((row) => {
    const colors = colorsOf(row).map(rgbOf);
    return row.lines.flatMap((_, i) => samplesUnder(ctx, lineBox(row, i), l).map((s) => ({ ...s, colors })));
  });
  const reaches = (step: number) => under.every((s) => {
    const bg = blend(s.rgb, ground, step * scrimShare(l, s.y));
    return s.colors.every((c) => contrastRatio(c, bg) >= SCRIM_TARGET);
  });
  return SCRIM_STEPS.find(reaches) ?? SCRIM_STEPS[SCRIM_STEPS.length - 1]!;
}

function paintScrim(ctx: SKRSContext2D, l: Laid, step: number): void {
  if (!step || !l.palette.ground) return;
  const [r, g, b] = rgbOf(l.palette.ground);
  for (let y = 0; y < l.height; y += 1) {
    const a = step * scrimShare(l, y);
    if (a < 0.004) continue;
    ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(4)})`;
    ctx.fillRect(0, y, l.width, 1);
  }
}

/** A ">" of the given height with its top-left at (x, y). */
function chevron(ctx: SKRSContext2D, x: number, y: number, h: number, color: string): void {
  const w = h * 0.55, k = h * 0.34;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + k, y); ctx.lineTo(x + k + w, y + h / 2); ctx.lineTo(x + k, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x + w, y + h / 2);
  ctx.closePath();
  ctx.fill();
}

function paintShapes(ctx: SKRSContext2D, l: Laid): void {
  const { palette, u } = l;
  if (l.band) {
    ctx.fillStyle = palette.primary!;
    ctx.fillRect(l.band.x, l.band.y, l.band.width, l.band.height);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(l.band.x, l.band.y, l.band.width, 5 * u);
  }
  if (l.hairline) {
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = palette.text;
    ctx.fillRect(l.hairline.x, l.hairline.y, l.hairline.width, l.hairline.height);
    ctx.globalAlpha = 1;
  }
  if (l.rail) { ctx.fillStyle = palette.accent; ctx.fillRect(l.rail.x, l.rail.y, l.rail.width, l.rail.height); }
  for (const row of l.rows) {
    if (!row.shape) continue;
    const { rect, fill, radius } = row.shape;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
    ctx.fill();
    if (row.shape.kind === "button") {
      const line = row.lines[0]!, h = CHEVRON.height * u;
      chevron(ctx, line.x + line.width + CHEVRON.gap * u, rect.y + (rect.height - h) / 2, h, row.color);
    }
  }
}

/**
 * The logo, top-left of the zone, never recoloured (D-ADL7). Its contrast is measured: the mean of its opaque
 * pixels against the mean of what is under it. Below 3:1 it is set on a chip in whichever of the kit's two
 * overlay colours it reads better on. A mean is a crude reading of a many-coloured logo; it is the reading that
 * catches the case that matters, a dark logo on a darkened picture or a white one on a bright sky.
 */
async function paintLogo(ctx: SKRSContext2D, l: Laid, bytes: Buffer): Promise<void> {
  if (!l.logo) return;
  const logo = await loadImage(bytes);
  const scale = Math.min(l.logo.height / logo.height, l.logo.maxWidth / logo.width);
  const w = logo.width * scale, h = logo.height * scale, box = { x: l.logo.x, y: l.logo.y, width: w, height: h };
  const cw = Math.max(1, Math.round(w)), ch = Math.max(1, Math.round(h));
  const own = createCanvas(cw, ch).getContext("2d");
  own.drawImage(logo, 0, 0, cw, ch);
  const px = own.getImageData(0, 0, cw, ch).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3]! > 128) { r += px[i]!; g += px[i + 1]!; b += px[i + 2]!; n += 1; }
  const under = samplesUnder(ctx, box, l), mean = (k: 0 | 1 | 2) => under.reduce((t, s) => t + s.rgb[k], 0) / under.length;
  if (n > 0 && contrastRatio([r / n, g / n, b / n], [mean(0), mean(1), mean(2)]) < 3) {
    const hex = `#${[r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("")}`, pad = 12 * l.u;
    ctx.fillStyle = inkOn(hex, l.palette);
    ctx.beginPath();
    ctx.roundRect(box.x - pad, box.y - pad, w + 2 * pad, h + 2 * pad, 10 * l.u);
    ctx.fill();
  }
  ctx.drawImage(logo, box.x, box.y, w, h);
}

function paintText(ctx: SKRSContext2D, l: Laid): void {
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (const row of l.rows) {
    Object.assign(ctx, fontOf(row.style, l.u));
    for (const line of row.lines) {
      if (!row.figureColor) { ctx.fillStyle = row.color; ctx.fillText(line.text, line.x, line.y + row.cap); continue; }
      // Word by word, each placed by the measured width of the words before it, so the line is as wide as it
      // was measured whatever the colours.
      const words = line.text.split(" ");
      words.forEach((word, i) => {
        const before = i === 0 ? 0 : ctx.measureText(`${words.slice(0, i).join(" ")} `).width;
        ctx.fillStyle = /\d/.test(word) ? row.figureColor! : row.color;
        ctx.fillText(word, line.x + before, line.y + row.cap);
      });
    }
  }
}

export async function renderOverlay(input: OverlayInput): Promise<OverlayOutcome> {
  const layout: AdOverlayLayout = input.layout ?? "bottom_plate";
  const l = layOut({ ...input, hasLogo: input.logo !== null });
  if (!l.ok) return { kind: "refused", findings: l.findings };
  const canvas = createCanvas(l.width, l.height);
  const ctx = canvas.getContext("2d");

  // 1. The background: the picture, darkened under the words by as much as THIS picture needs, then our shapes.
  ctx.drawImage(await loadImage(await frameStill(input.base, input.format, layout)), 0, 0, l.width, l.height);
  const scrim = scrimFor(ctx, l);
  paintScrim(ctx, l, scrim);
  paintShapes(ctx, l);
  if (input.logo) await paintLogo(ctx, l, input.logo);

  // 2. Measure what lies under each line on that background, judge, and only then draw the words. A row drawn
  //    in two colours is judged in both.
  const placed: PlacedText[] = l.rows.flatMap((row) => colorsOf(row).map((color, i) => ({
    label: i === 0 ? row.label : `${row.label}_figures`, box: row.box, needed_width: Math.floor(row.needed),
    px: row.style.px * l.u, bold: row.style.face !== "medium", color: rgbOf(color),
    background_samples: row.lines.flatMap((_, n) => samplesUnder(ctx, lineBox(row, n), l).map((s) => s.rgb)),
  })));
  const verdict = checkRender(input.format, placed, l.zone);
  if (verdict.length) return { kind: "refused", findings: verdict };
  paintText(ctx, l);
  return { kind: "rendered", png: await canvas.encode("png"), blocks: placed, stack: l.stack, scrim };
}
