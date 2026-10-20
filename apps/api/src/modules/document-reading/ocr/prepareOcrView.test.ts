import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { cv, ImageProcessor } from "ppu-ocv";
import { applyMatrix, invertMatrix, pageBox } from "../evidence/pageGeometry.js";
import { findPaper, isLevel, lineStats, prepareOcrView, tiltOf } from "./prepareOcrView.js";

/**
 * The OCR witness's prepared view (prepareOcrView.ts) over the space of how a BOL is photographed: a ruled
 * page, held at every turn from −8° to 8°, every perspective a hand gives it, on a dark surface — and a page
 * that fills the frame but is printed crooked on its paper, as Sonny's is. What must hold on each:
 *   - the view's printed lines are level (what the engine needs to read a line as one line);
 *   - a mark on the page, found in the view and carried back by `toPage`, lands where it is in the photo
 *     (what the reviewer is shown);
 *   - and a page with nothing to fix is left alone: no view, the engine reads it as it is.
 */
const PW = 850, PH = 1100;
/** A BOL-like page: ruled table, lines of type, and a red mark at a known place. */
const MARK = { x: 600, y: 420, w: 60, h: 24 };
async function page(tilt = 0): Promise<Buffer> {
  const rows = Array.from({ length: 14 }, (_, i) => 300 + i * 40);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}"><rect width="100%" height="100%" fill="#fbfbf2"/>
    <g transform="rotate(${tilt} ${PW / 2} ${PH / 2})" stroke="#111" fill="#111" font-family="Helvetica" font-size="16">
    <text x="60" y="120" font-size="34">STRAIGHT BILL OF LADING</text>
    ${rows.map((y) => `<line x1="50" y1="${y}" x2="${PW - 50}" y2="${y}" stroke-width="2"/><text x="70" y="${y + 27}" stroke="none">UN1824, SODIUM HYDROXIDE, SOLUTION 8, PGII 28800</text>`).join("")}
    <line x1="50" y1="300" x2="50" y2="${rows.at(-1)}" stroke-width="2"/><line x1="${PW - 50}" y1="300" x2="${PW - 50}" y2="${rows.at(-1)}" stroke-width="2"/>
    <rect x="${MARK.x}" y="${MARK.y}" width="${MARK.w}" height="${MARK.h}" fill="#e00000" stroke="none"/></g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** The page photographed: its corners at `to` in a W×H frame of dark surface. Returns the photo and page→photo. */
async function photo(png: Buffer, to: [number, number][], W = 1536, H = 2048): Promise<{ png: Buffer; g: number[] }> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const src = cv.matFromImageData({ data: new Uint8ClampedArray(data), width: PW, height: PH } as never);
  const a = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, PW, 0, PW, PH, 0, PH]);
  const b = cv.matFromArray(4, 1, cv.CV_32FC2, to.flat());
  const m = cv.getPerspectiveTransform(a, b);
  const out = new cv.Mat();
  cv.warpPerspective(src, out, m, new cv.Size(W, H), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(38, 40, 52, 255));
  const g = Array.from(m.data64F);
  const res = await sharp(Buffer.from(out.data), { raw: { width: W, height: H, channels: 4 } }).removeAlpha().png().toBuffer();
  [src, a, b, m, out].forEach((x) => x.delete());
  return { png: res, g };
}

/** The red mark's box in an image, in its pixels. */
async function markIn(png: Buffer): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 3;
    if (data[i]! > 170 && data[i + 1]! < 90 && data[i + 2]! < 90) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * 0 when a view's printed lines are level and agree (`isLevel`), else its line statistics. Not `measureTilt`:
 * that answers 0 for lines that disagree — the very view a wrong outline makes — and would call it level.
 */
async function tiltOfView(png: Buffer): Promise<number | string> {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const g = cv.matFromArray(info.height, info.width, cv.CV_8UC1, Array.from(data));
  try {
    if (isLevel(g)) return 0;
    const st = lineStats(g);
    return `${st.lines} lines, ${Math.round(st.agree * 100)} % agreeing, median ${st.median.toFixed(2)}°`;
  } finally {
    g.delete();
  }
}

/** Where the page's mark is in the photo, as a fraction of the photo (the bound of its corners through g). */
function markInPhoto(g: number[], W: number, H: number) {
  const pts = [[MARK.x, MARK.y], [MARK.x + MARK.w, MARK.y], [MARK.x + MARK.w, MARK.y + MARK.h], [MARK.x, MARK.y + MARK.h]].map(([x, y]) => applyMatrix(g, x!, y!));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs) / W, y: Math.min(...ys) / H, w: (Math.max(...xs) - Math.min(...xs)) / W, h: (Math.max(...ys) - Math.min(...ys)) / H };
}

/** Corners of the page held at `deg`, scaled by `s`, its far edge `persp` narrower, centred in the frame. */
function held(deg: number, s: number, persp: number, W = 1536, H = 2048): [number, number][] {
  const r = (deg * Math.PI) / 180, [cx, cy] = [W / 2, H / 2];
  const half = [PW * s / 2, PH * s / 2];
  const local: [number, number][] = [[-half[0]! * (1 - persp), -half[1]!], [half[0]! * (1 - persp), -half[1]!], [half[0]!, half[1]!], [-half[0]!, half[1]!]];
  return local.map(([x, y]) => [cx + x * Math.cos(r) - y * Math.sin(r), cy + x * Math.sin(r) + y * Math.cos(r)]);
}

beforeAll(async () => {
  await ImageProcessor.initRuntime();
});

describe("prepareOcrView over how a page is photographed", () => {
  it("levels the printed lines and carries a mark back to where it is in the photo, at every turn and perspective", async () => {
    const wrong: string[] = [];
    const flat = await page();
    for (const deg of [-8, -5, -3, -1.5, 0, 1.5, 3, 5, 8]) for (const persp of [0, 0.08, 0.16]) for (const s of [1.25, 1.6]) {
      const shot = await photo(flat, held(deg, s, persp));
      const view = await prepareOcrView(shot.png);
      const tag = `turn ${deg}° perspective ${persp} scale ${s}`;
      if (!view) { wrong.push(`${tag}: no view`); continue; }
      const t = await tiltOfView(view.png);
      if (t !== 0) wrong.push(`${tag}: lines ${t} in the view`);
      const m = await markIn(view.png);
      if (!m) { wrong.push(`${tag}: mark lost`); continue; }
      const got = pageBox({ page: 1, width: view.width, height: view.height, items: [], toPage: { matrix: view.toPage, width: 1536, height: 2048 } }, m);
      const want = markInPhoto(shot.g, 1536, 2048);
      const off = Math.max(Math.abs(got.x - want.x), Math.abs(got.y - want.y), Math.abs(got.x + got.w - want.x - want.w), Math.abs(got.y + got.h - want.y - want.h));
      if (off > 0.006) wrong.push(`${tag}: mark ${(off * 100).toFixed(2)} % of the photo off`);
    }
    expect(wrong).toEqual([]);
  }, 240_000);

  it("levels a page printed crooked on paper that fills the frame — Sonny's corrosives page", async () => {
    const wrong: string[] = [];
    for (const tilt of [-4, -2.5, -1.5, 1, 2, 3, 4]) {
      const v = await prepareOcrView(await page(tilt));
      if (!v) { wrong.push(`${tilt}°: no view`); continue; }
      const t = await tiltOfView(v.png);
      if (t !== 0) wrong.push(`${tilt}°: lines ${t} in the view`);
    }
    expect(wrong).toEqual([]);
  }, 120_000);

  it("leaves a straight page that fills the frame alone, and a frame with no paper in it", async () => {
    expect(await prepareOcrView(await page(0))).toBeNull();
    expect(await prepareOcrView(await page(0.2))).toBeNull();
    const dark = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#26283a" } }).png().toBuffer();
    expect(await prepareOcrView(dark)).toBeNull();
  }, 60_000);

  it("never makes a view worse than the photo when the paper lies against a second white sheet (60974485 page 7)", async () => {
    // The sheets touch, so the bright region is one blob; its outline can still be four-cornered without being
    // the page. Before the view checked its own lines, 8 of these 64 photos made a view whose lines disagreed.
    const W = 1536, H = 2048;
    const flat = await page();
    const wrong: string[] = [];
    let fellBack = 0;
    for (const deg of [-4, 3]) for (const sheetDeg of [-25, -12, 10, 25]) for (const dx of [-500, -350]) for (const sw of [500, 800]) for (const dy of [-200, 100]) {
      const p = await sharp(flat).resize(Math.round(PW * 1.2)).rotate(deg, { background: "#26283a" }).png().toBuffer();
      const pm = await sharp(p).metadata();
      const sh = await sharp({ create: { width: sw, height: 1500, channels: 3, background: "#f4f4f4" } }).rotate(sheetDeg, { background: "#26283a" }).png().toBuffer();
      const sm = await sharp(sh).metadata();
      const both = await sharp({ create: { width: W, height: H, channels: 3, background: "#26283a" } }).composite([
        { input: sh, left: Math.max(0, Math.round(W / 2 - pm.width! / 2 + dx)), top: Math.max(0, Math.round(H / 2 - sm.height! / 2 + dy)), blend: "lighten" },
        { input: p, left: Math.round(W / 2 - pm.width! / 2), top: Math.round(H / 2 - pm.height! / 2), blend: "lighten" },
      ]).png().toBuffer();
      // A wrong outline is thrown away: no view (the page read as it is) or a level one, never a crooked one —
      // and where an outline WAS found and thrown away, the page is still levelled where it lies (8 photos).
      const view = await prepareOcrView(both);
      const raw = await sharp(both).greyscale().raw().toBuffer({ resolveWithObject: true });
      const g = cv.matFromArray(raw.info.height, raw.info.width, cv.CV_8UC1, Array.from(raw.data));
      const outline = findPaper(g);
      g.delete();
      if (outline) fellBack++;
      if (!view && !outline) continue;
      const t = view ? await tiltOfView(view.png) : "no view after a rejected outline";
      if (t !== 0) wrong.push(`page ${deg}°, sheet ${sheetDeg}° at ${dx},${dy} width ${sw}: view lines ${t}`);
    }
    expect(wrong).toEqual([]);
    expect(fellBack).toBeGreaterThan(0);
  }, 600_000);

  it("is not turned by a signature: long strokes across a straight page leave it level", async () => {
    const straight = await page(0);
    const scrawl = `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}"><path d="M120 900 C 300 840, 420 980, 760 860 M 140 960 L 700 900" stroke="#1a3fa0" stroke-width="5" fill="none"/></svg>`;
    const signed = await sharp(straight).composite([{ input: Buffer.from(scrawl) }]).png().toBuffer();
    expect(await prepareOcrView(signed)).toBeNull();
  }, 60_000);
});

describe("tiltOf — the line angle the view is levelled by", () => {
  const seg = (a: number, len = 100) => ({ a, len });
  it("takes the median of agreeing lines, each counted once, so a few long paper edges never outvote the print", () => {
    expect(tiltOf([...Array(10)].map(() => seg(2)).concat([seg(1.6, 50), seg(2.4, 50)]))).toBe(2);
    expect(tiltOf([...Array(12)].map(() => seg(-1)).concat([...Array(3)].map(() => seg(6, 3000))))).toBe(-1);
  });
  it("answers 0 — read as it is — for too few lines, lines that disagree, or a tilt too small to resample for", () => {
    expect(tiltOf([...Array(7)].map(() => seg(3)))).toBe(0);
    expect(tiltOf([...Array(5)].map(() => seg(-3)).concat([...Array(5)].map(() => seg(3))))).toBe(0);
    expect(tiltOf([...Array(10)].map(() => seg(0.3)))).toBe(0);
  });
});

describe("pageBox — a witness's box on the page the reviewer sees", () => {
  it("is the box as a fraction of the page when the page was read as it is", () => {
    const b = pageBox({ page: 1, width: 200, height: 100, items: [] }, { x: 20, y: 10, width: 40, height: 30 });
    for (const [k, v] of Object.entries({ x: 0.1, y: 0.1, w: 0.2, h: 0.3 })) expect(b[k as keyof typeof b]).toBeCloseTo(v, 9);
  });
  it("maps a view's box through toPage, and inverting a transform undoes it", () => {
    const m = [2, 0, 10, 0, 2, 20, 0, 0, 1];
    const b = pageBox({ page: 1, width: 50, height: 50, items: [], toPage: { matrix: m, width: 200, height: 200 } }, { x: 5, y: 5, width: 10, height: 10 });
    for (const [k, v] of Object.entries({ x: 0.1, y: 0.15, w: 0.1, h: 0.1 })) expect(b[k as keyof typeof b]).toBeCloseTo(v, 9);
    const g = [1.1, 0.05, 30, -0.04, 0.95, 12, 0.0001, -0.00005, 1];
    const [x, y] = applyMatrix(invertMatrix(g), ...applyMatrix(g, 123, 456));
    expect([x, y].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([123, 456]);
  });
});
