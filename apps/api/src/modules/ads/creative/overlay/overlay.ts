import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import sharp from "sharp";
import {
  checkRender, contrastRatio, FORMAT_SIZE, MOTION_FORMAT, MOTION_SIZE, parseHex,
  type AdFormat, type AdLook, type AdOverlayLayout, type PlacedText, type Rect, type Rgb, type Size,
} from "@silvicom/shared";
import { fontOf, layOut, type Laid, type LaidRow, type OverlayFinding, type OverlayText } from "./overlayLayout.js";
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
 * Then the words sat on the picture in display faces with a drawn button, a rail or ribbon and a hairline footer.
 * Since 2026-11-12 (ADS-AD-LOOK-PLAN D-ADL16–19) an ad wears the carrier's own brand with no ornament: `field` and
 * `number` put the words on a solid band of the kit's ground colour, `photo` puts them on the picture, and no look
 * draws a button. WHERE things go and whether the words fit is `overlayLayout.ts`; WHAT a look is, is
 * `overlayLooks.ts`; this file paints.
 *
 * ── THE SCRIM IS MEASURED, NOT A CONSTANT (`photo` only) ───────────────────────────────────────────
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
 *
 * ── ONE LAYOUT, PAINTED AT A RESOLUTION (Q-APX17 (a), 2026-11-19) ──────────────────────────────────
 * Everything is laid out on the still's frame (`layOut`, 1080 wide), and a motion ad paints THAT layout onto a
 * frame `MOTION_SCALE` larger (1440 × 1800) through the canvas's transform. It is not laid out again at 1440: a
 * line measures 1,280.53 px scaled and 1,280.41 px set at the larger size (measured 2026-11-19, Big Shoulders), so
 * a second layout could, at a line's margin, wrap or step down differently and the video would end on an ad nobody
 * approved. Text drawn through the transform is as sharp as text set at the larger size (8,561 soft edge pixels
 * against 8,574 on a 1440 line), where the 1080 painting stretched to 1440 has 24,321 — the softness option (b) was
 * refused for. Pixels are read in the frame's own pixels: a reference box is multiplied by the scale.
 */

export interface OverlayInput extends OverlayText {
  /** The generated image (C3's stored asset), any size; covered to the format's size. */
  base: Buffer;
  /** The kit's logo bytes, or null for Q-AD14's fallback (no logo). */
  logo: Buffer | null;
}

export type OverlayOutcome =
  | { kind: "rendered"; png: Buffer; blocks: PlacedText[]; /** Headline to supporting line: the part the visual check judges. */ stack: Rect; /** The scrim step used; 0 when nothing was darkened. */ scrim: number; /** The look drawn, after `layOut`'s fallbacks. */ look: AdLook }
  | { kind: "refused"; findings: OverlayFinding[] };

/** Every SAMPLE_STEP-th pixel in each direction under a line is a contrast sample. */
const SAMPLE_STEP = 4;
const rgbOf = (hex: string): Rgb => parseHex(hex)!;

/**
 * The pixels under one rectangle, each with the row it came from (the scrim's strength depends on the row). `box`
 * and `frame` are on the layout's frame; `s` is how much larger the canvas is (1 for a still). The pixels are read
 * in the canvas's own pixels, every `SAMPLE_STEP`-th of them, and each row is handed back on the layout's frame.
 */
function samplesUnder(ctx: SKRSContext2D, box: Rect, frame: { width: number; height: number }, s = 1): Array<{ rgb: Rgb; y: number }> {
  const x = Math.max(0, Math.floor(box.x * s)), y = Math.max(0, Math.floor(box.y * s));
  const w = Math.max(1, Math.min(frame.width * s - x, Math.floor(box.width * s))), h = Math.max(1, Math.min(frame.height * s - y, Math.floor(box.height * s)));
  const data = ctx.getImageData(x, y, w, h).data;
  const out: Array<{ rgb: Rgb; y: number }> = [];
  for (let j = 0; j < h; j += SAMPLE_STEP) {
    for (let i = 0; i < w; i += SAMPLE_STEP) {
      const at = (j * w + i) * 4;
      out.push({ rgb: [data[at]!, data[at + 1]!, data[at + 2]!], y: (y + j) / s });
    }
  }
  return out;
}

/**
 * The image as it fills `format`'s frame, before any text: what the overlay draws on, and what the visual
 * check looks at (C5b) — one function, so the checker sees exactly the pixels the ad is made of. Where the
 * picture is larger than the frame, `layout` decides which edge is kept (`CUT_KEEPS`). `size` is the still's
 * unless a motion ad asks for its own (`MOTION_SIZE`): the same cut, at that many pixels, from the picture itself.
 */
export async function frameStill(image: Buffer, format: AdFormat, layout: AdOverlayLayout = "bottom_plate", size: Size = FORMAT_SIZE[format]): Promise<Buffer> {
  const { width, height } = size;
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
function scrimFor(ctx: SKRSContext2D, l: Laid, s: number): number {
  if (!l.palette.ground || l.band) return 0;
  const ground = rgbOf(l.palette.ground);
  const under = l.rows.filter((r) => r.on === "picture").flatMap((row) => {
    const colors = colorsOf(row).map(rgbOf);
    return row.lines.flatMap((_, i) => samplesUnder(ctx, lineBox(row, i), l, s).map((px) => ({ ...px, colors })));
  });
  const reaches = (step: number) => under.every((px) => {
    const bg = blend(px.rgb, ground, step * scrimShare(l, px.y));
    return px.colors.every((c) => contrastRatio(c, bg) >= SCRIM_TARGET);
  });
  return SCRIM_STEPS.find(reaches) ?? SCRIM_STEPS[SCRIM_STEPS.length - 1]!;
}

/**
 * One strip per row of the CANVAS's pixels, outside the transform: a strip one layout-row tall would be 4/3 of a
 * pixel on a motion frame, and two overlapping translucent strips darken their shared row twice.
 */
function paintScrim(ctx: SKRSContext2D, l: Laid, step: number, s: number): void {
  if (!step || !l.palette.ground) return;
  const [r, g, b] = rgbOf(l.palette.ground);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let y = 0; y < l.height * s; y += 1) {
    const a = step * scrimShare(l, y / s);
    if (a < 0.004) continue;
    ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(4)})`;
    ctx.fillRect(0, y, l.width * s, 1);
  }
  ctx.restore();
}

/** The solid band of `field` and `number`, in the kit's ground colour: a field, not a panel — edge to edge, no line on it (D-ADL17). */
function paintBand(ctx: SKRSContext2D, l: Laid): void {
  if (!l.band) return;
  ctx.fillStyle = l.band.fill;
  ctx.fillRect(l.band.x, l.band.y, l.band.width, l.band.height);
}

/**
 * The logo, top-left of the zone, never recoloured (D-ADL7). Its contrast is measured: the mean of its opaque
 * pixels against the mean of what is under it. Below 3:1 it is set on a square block in whichever of the kit's two
 * overlay colours it reads better on — square since 2026-11-12, as a rounded chip is a card (D-ADL17). A mean is a crude reading of a many-coloured logo; it is the reading that
 * catches the case that matters, a dark logo on a darkened picture or a white one on a bright sky. `measured` is
 * the canvas the reading is taken from when it is not the one drawn on: a motion ad's layer is transparent, and
 * what is under its logo is on the still's canvas.
 */
async function paintLogo(ctx: SKRSContext2D, l: Laid, bytes: Buffer, s: number, measured: SKRSContext2D = ctx): Promise<void> {
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
  const under = samplesUnder(measured, box, l, s), mean = (k: 0 | 1 | 2) => under.reduce((t, px) => t + px.rgb[k], 0) / under.length;
  if (n > 0 && contrastRatio([r / n, g / n, b / n], [mean(0), mean(1), mean(2)]) < 3) {
    const hex = `#${[r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("")}`, pad = 12 * l.u;
    ctx.fillStyle = inkOn(hex, l.palette);
    ctx.fillRect(box.x - pad, box.y - pad, w + 2 * pad, h + 2 * pad);
  }
  ctx.drawImage(logo, box.x, box.y, w, h);
}

function paintText(ctx: SKRSContext2D, l: Laid, rows: readonly LaidRow[] = l.rows): void {
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (const row of rows) {
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

type Rendered = Extract<OverlayOutcome, { kind: "rendered" }>;

/**
 * The one painting of an ad, for a still and for a motion ad alike. `layered` also paints everything but the
 * words on a second, transparent canvas (`under`) — the same calls with the same measured scrim step, so the two
 * cannot drift.
 */
/**
 * A canvas of the frame's own pixels, drawn on in the layout's units: `s` is 1 for a still and `MOTION_SCALE` for
 * a motion frame. The size must be a whole number of pixels, exactly the layout's frame scaled — not a near one.
 */
function surface(l: Laid, frame: Size): { canvas: Canvas; ctx: SKRSContext2D; s: number } {
  const s = frame.width / l.width;
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.height !== l.height * s) {
    throw new Error(`overlay: a ${frame.width} × ${frame.height} frame is not the ${l.width} × ${l.height} layout scaled`);
  }
  const canvas = createCanvas(frame.width, frame.height), ctx = canvas.getContext("2d");
  if (s !== 1) ctx.scale(s, s);
  return { canvas, ctx, s };
}

async function paint(input: OverlayInput, layered: boolean, frame?: Size): Promise<Extract<OverlayOutcome, { kind: "refused" }> | { kind: "painted"; out: Rendered; l: Laid; under: { canvas: Canvas; ctx: SKRSContext2D } | null; s: number }> {
  const layout: AdOverlayLayout = input.layout ?? "bottom_plate";
  const l = layOut({ ...input, hasLogo: input.logo !== null });
  if (!l.ok) return { kind: "refused", findings: l.findings };
  const size = frame ?? { width: l.width, height: l.height };
  const { canvas, ctx, s } = surface(l, size);
  const layer = layered ? surface(l, size) : null;
  const uctx = layer?.ctx ?? null;

  // 1. The background: the picture, darkened under the words by as much as THIS picture needs, then our shapes.
  //    The picture is cut at the canvas's own size, so nothing of it is stretched.
  ctx.drawImage(await loadImage(await frameStill(input.base, input.format, layout, size)), 0, 0, l.width, l.height);
  const scrim = scrimFor(ctx, l, s);
  for (const c of uctx ? [ctx, uctx] : [ctx]) { paintScrim(c, l, scrim, s); paintBand(c, l); }
  // The layer's logo first: its block is decided by what lies under it on the still, before the still's own logo is there.
  if (input.logo && uctx) await paintLogo(uctx, l, input.logo, s, ctx);
  if (input.logo) await paintLogo(ctx, l, input.logo, s);

  // 2. Measure what lies under each line on that background, judge, and only then draw the words. A row drawn
  //    in two colours is judged in both. Its size is judged on the layout's frame (`l.u` is 1 there): WCAG's
  //    "large text" is about how large it LOOKS, and a 1440 motion frame fills the same feed slot as the 1080
  //    still — judged in the motion frame's pixels, an 18 px line would pass as 24 px large text at 3:1.
  const placed: PlacedText[] = l.rows.flatMap((row) => colorsOf(row).map((color, i) => ({
    label: i === 0 ? row.label : `${row.label}_figures`, box: row.box, needed_width: Math.floor(row.needed),
    px: row.style.px * l.u, bold: row.style.face === "display", color: rgbOf(color),
    background_samples: row.lines.flatMap((_, n) => samplesUnder(ctx, lineBox(row, n), l, s).map((px) => px.rgb)),
  })));
  const verdict = checkRender(input.format, placed, l.zone);
  if (verdict.length) return { kind: "refused", findings: verdict };
  paintText(ctx, l);
  return { kind: "painted", out: { kind: "rendered", png: await canvas.encode("png"), blocks: placed, stack: l.stack, scrim, look: l.look }, l, under: layer, s };
}

export async function renderOverlay(input: OverlayInput): Promise<OverlayOutcome> {
  const p = await paint(input, false);
  return p.kind === "painted" ? p.out : p;
}

/** The rows on every frame of a motion ad: the line the law asks for and the number to call. The logo and the band are with them. */
const ALWAYS_ROWS: ReadonlySet<string> = new Set(["eeo", "phone"]);

export interface MotionWordLayer { labels: string[]; /** The characters read, a line break counted as the space it replaced: what `motionTimeline` times. */ chars: number; png: Buffer }

export type MotionLayersOutcome =
  | (Omit<Rendered, "png"> & {
    /** The finished still: the motion ad's last frame, and the frame every check above was made on. */
    still: Buffer;
    /** Everything but the timed words, transparent where the picture shows: scrim, band, logo, the always-on rows. */
    under: Buffer;
    /** The timed words in the order they arrive, each a transparent layer of the frame's size. */
    words: MotionWordLayer[];
    /**
     * `under` before any word was painted on it: scrim, band and logo alone. Over a frame of the moving picture
     * it is what lies BEHIND every line at that moment — what the frame check samples (`motionFrames.ts`). `under`
     * itself would not do: it carries the always-on rows, and a line's own ink is not its background.
     */
    ground: Buffer;
    /**
     * Where each row's lines are drawn, by row label, in THIS frame's pixels (`MOTION_SIZE`): the boxes the frame
     * check reads the moving picture under. `blocks`, `stack` and their boxes stay on the still's frame, where the
     * layout and its verdict were made.
     */
    lines: Record<string, Rect[]>;
  })
  | Extract<OverlayOutcome, { kind: "refused" }>;

/**
 * A motion ad's layers (ADS-PLATFORM-V2-PLAN V4, Q-APX13): the SAME painting as the still, taken apart, so that
 * the picture, `under` and every `words` layer put back together are the still — the frame a person approves and
 * the one the contrast check was made on. Refused exactly when the still is. Painted at `MOTION_SIZE` (Q-APX17):
 * the still's own layout, so the last frame is the approved ad at 1440 rather than a second layout of it. Only the
 * motion format is made: a layer of another frame would not be the size the join and the frame check expect.
 *
 * The words arrive in reading order: the headline (with `number`'s figure) first, then each remaining row in the
 * layout's own order — today one, the supporting line, which every look draws under the headline. What `photo`'s words lie on moves once the picture does; the still's contrast verdict
 * speaks for the last frame only, and the frames before it are the sampled-frame check's (`checkMotionFrames`).
 */
export async function renderMotionLayers(input: OverlayInput): Promise<MotionLayersOutcome> {
  if (input.format !== MOTION_FORMAT) throw new Error(`overlay: a motion ad is made in ${MOTION_FORMAT}, not ${input.format}`);
  const p = await paint(input, true, MOTION_SIZE);
  if (p.kind !== "painted") return p;
  const { l, out, s } = p, under = p.under!;
  // The layer's own context, with its transform: a second `getContext` is not promised to be the same one.
  const ground = await under.canvas.encode("png");
  paintText(under.ctx, l, l.rows.filter((r) => ALWAYS_ROWS.has(r.label)));

  const timed = l.rows.filter((r) => !ALWAYS_ROWS.has(r.label));
  const first = timed.filter((r) => r.label.startsWith("headline"));
  const later = timed.filter((r) => !first.includes(r));
  const words: MotionWordLayer[] = [];
  for (const rows of [first, ...later.map((r) => [r])]) {
    if (!rows.length) continue;
    const layer = surface(l, MOTION_SIZE);
    paintText(layer.ctx, l, rows);
    words.push({ labels: rows.map((r) => r.label), chars: rows.reduce((n, r) => n + r.lines.map((line) => line.text).join(" ").length, 0), png: await layer.canvas.encode("png") });
  }
  const { png: still, ...rest } = out;
  const scaled = (b: Rect): Rect => ({ x: b.x * s, y: b.y * s, width: b.width * s, height: b.height * s });
  const lines = Object.fromEntries(l.rows.map((r) => [r.label, r.lines.map((_, i) => scaled(lineBox(r, i)))]));
  return { ...rest, still, under: await under.canvas.encode("png"), words, ground, lines };
}
