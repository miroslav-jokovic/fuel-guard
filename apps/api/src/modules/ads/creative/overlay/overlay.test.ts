import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { AD_FORMATS, AD_OVERLAY_LAYOUTS, FORMAT_SIZE, safeZone, type AdBrandKit, type AdFormat, type AdClaim, type AdOverlayLayout } from "@silvicom/shared";
import { frameStill, renderOverlay, type OverlayInput } from "./overlay.js";

/**
 * The overlay renderer (C4): golden images per format, and every refusal. The goldens are committed PNGs in
 * `__golden__/`; a render is compared pixel by pixel with a small tolerance, because Skia's antialiasing can
 * differ by a few levels between macOS and Linux with the same font file. `UPDATE_GOLDEN=1` rewrites them —
 * a change to a golden is a change to how every ad looks, and review sees the new PNG in the diff.
 * All values are fixtures — never a real brand value (Q-AD14).
 */
const GOLDEN = new URL("./__golden__/", import.meta.url);
const claims: AdClaim[] = [{ kind: "money", cents: 68, per: "mile" }, { kind: "term", term: "home weekly" }];
const KIT: Pick<AdBrandKit, "overlays"> = {
  overlays: Object.fromEntries(AD_FORMATS.map((f) => [f, { zone: null, text_color: "#FFFFFF", plate_color: "#0B3D2E" }])) as AdBrandKit["overlays"],
};

/** A fixture "photo": a mid-grey field with a bright sky band — compresses well, and has a light patch. */
async function base(): Promise<Buffer> {
  const sky = await sharp({ create: { width: 1200, height: 500, channels: 3, background: "#E8EEF4" } }).png().toBuffer();
  return sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#5A6470" } }).composite([{ input: sky, top: 0, left: 0 }]).png().toBuffer();
}
const logo = () => sharp({ create: { width: 300, height: 120, channels: 4, background: { r: 230, g: 170, b: 30, alpha: 1 } } }).png().toBuffer();

const input = async (format: AdFormat, over: Partial<OverlayInput> = {}): Promise<OverlayInput> => ({
  format, language: "en", base: await base(), headline: "Earn $0.68/mile and be home weekly", cta: "Apply today",
  brief: { claims }, kit: KIT, logo: await logo(), ...over,
});

/** Share of pixels where any channel differs by more than 48 levels. */
async function differs(a: Buffer, b: Buffer): Promise<number> {
  const [x, y] = await Promise.all([a, b].map((p) => sharp(p).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  if (x!.info.width !== y!.info.width || x!.info.height !== y!.info.height) return 1;
  let bad = 0;
  for (let i = 0; i < x!.data.length; i += 3) {
    if (Math.abs(x!.data[i]! - y!.data[i]!) > 48 || Math.abs(x!.data[i + 1]! - y!.data[i + 1]!) > 48 || Math.abs(x!.data[i + 2]! - y!.data[i + 2]!) > 48) bad += 1;
  }
  return bad / (x!.data.length / 3);
}

describe("frameStill — a cut keeps the edge the words sit against (AG4; Q-AD75)", () => {
  /**
   * A 4:5 picture as the art director composes one for `bottom_plate`: a red subject in the upper two thirds, the
   * lower third plain grey. Rows 0–299 sky, 300–849 red, 850–1349 grey (at 1080 wide).
   */
  async function composed(): Promise<Buffer> {
    const band = (height: number, background: string) => sharp({ create: { width: 1080, height, channels: 3, background } }).png().toBuffer();
    return sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#9FB8D0" } })
      .composite([{ input: await band(550, "#C00000"), top: 300, left: 0 }, { input: await band(500, "#606060"), top: 850, left: 0 }]).png().toBuffer();
  }
  /** The rows of a framed still, top to bottom, as "red" | "grey" | "sky", read down its middle column. */
  async function rows(png: Buffer): Promise<string[]> {
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return Array.from({ length: info.height }, (_, y) => {
      const at = (y * info.width + Math.floor(info.width / 2)) * 3;
      return data[at]! > 150 && data[at + 1]! < 80 ? "red" : data[at]! < 120 ? "grey" : "sky";
    });
  }
  const count = (r: string[], what: string) => r.filter((x) => x === what).length;

  it("bottom_plate: the square keeps the picture's bottom, so its words lie over the same plain part as the tall frame's, and the subject is whole", async () => {
    const square = await rows(await frameStill(await composed(), "1:1", "bottom_plate"));
    // The 4:5's bottom 500 plain rows are the square's bottom 500; all 550 rows of the subject survive.
    expect(square.slice(-500).every((x) => x === "grey")).toBe(true);
    expect(count(square, "red")).toBe(550);
    expect(count(square, "sky")).toBe(30);
  });

  it("top_band: the square keeps the picture's top, where those words are", async () => {
    const square = await rows(await frameStill(await composed(), "1:1", "top_band"));
    expect(square.slice(0, 300).every((x) => x === "sky")).toBe(true);
    expect(count(square, "grey")).toBe(230);
  });

  it("centered: the cut is the centre, as it always was, and so is a cut with no layout named", async () => {
    const square = await rows(await frameStill(await composed(), "1:1", "centered"));
    expect([count(square, "sky"), count(square, "red"), count(square, "grey")]).toEqual([165, 550, 365]);
  });

  it("a picture already in the frame's shape is not cut at all, whatever the layout", async () => {
    const tall = await composed();
    for (const layout of ["bottom_plate", "top_band", "centered"] as const) {
      const r = await rows(await frameStill(tall, "4:5", layout));
      expect([count(r, "sky"), count(r, "red"), count(r, "grey")]).toEqual([300, 550, 500]);
    }
  });

  it("a picture wider than the frame loses its two sides equally: only the cropped axis follows the layout", async () => {
    const left = await sharp({ create: { width: 400, height: 1080, channels: 3, background: "#C00000" } }).png().toBuffer();
    const wide = await sharp({ create: { width: 1880, height: 1080, channels: 3, background: "#606060" } }).composite([{ input: left, top: 0, left: 0 }]).png().toBuffer();
    for (const layout of ["bottom_plate", "top_band"] as const) {
      const { data, info } = await sharp(await frameStill(wide, "1:1", layout)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      // 400 px cut from each side: the red block's 400 px are gone from the left edge exactly.
      expect(data[0]! < 120 && info.width === 1080).toBe(true);
    }
  });
});

describe("overlay renderer — golden images per format", () => {
  // One literal title per format, so `lint:ads-readiness` can pin each golden (it reads titles as written).
  it("1:1 matches its golden image", () => golden("1:1"));
  it("4:5 matches its golden image", () => golden("4:5"));
  it("9:16 matches its golden image", () => golden("9:16"));
  // CQ6: the two other layouts, per format, each its own golden (`<format>-<layout>.png`).
  it("1:1 top_band matches its golden image", () => golden("1:1", "top_band"));
  it("4:5 top_band matches its golden image", () => golden("4:5", "top_band"));
  it("9:16 top_band matches its golden image", () => golden("9:16", "top_band"));
  it("1:1 centered matches its golden image", () => golden("1:1", "centered"));
  it("4:5 centered matches its golden image", () => golden("4:5", "centered"));
  it("9:16 centered matches its golden image", () => golden("9:16", "centered"));

  async function golden(format: AdFormat, layout: AdOverlayLayout = "bottom_plate"): Promise<void> {
    const out = await renderOverlay(await input(format, { layout }));
    if (out.kind !== "rendered") throw new Error(JSON.stringify(out.findings));
    const meta = await sharp(out.png).metadata();
    expect([meta.width, meta.height]).toEqual([FORMAT_SIZE[format].width, FORMAT_SIZE[format].height]);
    const file = new URL(`${format.replace(":", "x")}${layout === "bottom_plate" ? "" : `-${layout}`}.png`, GOLDEN);
    if (process.env.UPDATE_GOLDEN === "1" || !existsSync(file)) {
      if (process.env.CI === "true" && !existsSync(file)) throw new Error(`golden ${file.pathname} is missing — run with UPDATE_GOLDEN=1 and commit it`);
      mkdirSync(GOLDEN, { recursive: true });
      writeFileSync(file, out.png);
    }
    expect(await differs(out.png, readFileSync(file))).toBeLessThan(0.005);
  }

  it("keeps every text block inside the format's safe zone, stacked from its bottom", async () => {
    for (const format of AD_FORMATS) {
      const out = await renderOverlay(await input(format));
      if (out.kind !== "rendered") throw new Error(format);
      const z = safeZone(format);
      for (const b of out.blocks) {
        expect(b.box.x).toBeGreaterThanOrEqual(z.x);
        expect(b.box.y + b.box.height).toBeLessThanOrEqual(z.y + z.height);
      }
      expect(out.blocks.map((b) => b.label)).toEqual(["headline", "cta", "eeo"]);
    }
  });

  it("every layout keeps every block inside the zone; top_band starts at its top, centered sits mid-zone, bottom_plate ends at its bottom", async () => {
    for (const format of AD_FORMATS) {
      const z = safeZone(format);
      const by = Object.fromEntries(await Promise.all(AD_OVERLAY_LAYOUTS.map(async (layout) => {
        const out = await renderOverlay(await input(format, { layout }));
        if (out.kind !== "rendered") throw new Error(`${format} ${layout}: ${JSON.stringify(out.findings)}`);
        for (const b of out.blocks) {
          expect(b.box.x).toBeGreaterThanOrEqual(z.x);
          expect(b.box.y).toBeGreaterThanOrEqual(z.y);
          expect(b.box.y + b.box.height).toBeLessThanOrEqual(z.y + z.height);
        }
        return [layout, out.blocks] as const;
      })));
      const top = (l: AdOverlayLayout) => by[l]![0]!.box.y;
      const bottom = (l: AdOverlayLayout) => { const last = by[l]![by[l]!.length - 1]!; return last.box.y + last.box.height; };
      expect(top("top_band")).toBeLessThan(top("centered"));
      expect(top("centered")).toBeLessThan(top("bottom_plate"));
      expect(bottom("bottom_plate")).toBeGreaterThan(z.y + z.height - 60);
      expect(top("top_band")).toBeLessThan(z.y + 60);
      const mid = z.y + z.height / 2;
      expect(Math.abs((top("centered") + bottom("centered")) / 2 - mid)).toBeLessThan(40);
      // The stack's height is the layout's business nowhere: the same words make the same stack.
      expect(bottom("top_band") - top("top_band")).toBe(bottom("bottom_plate") - top("bottom_plate"));
    }
  });

  it("the same words on the same picture are three different images, one per layout", async () => {
    const [a, b, c] = await Promise.all(AD_OVERLAY_LAYOUTS.map(async (layout) => {
      const out = await renderOverlay(await input("4:5", { layout }));
      if (out.kind !== "rendered") throw new Error(layout);
      return out.png;
    }));
    expect(await differs(a!, b!)).toBeGreaterThan(0.02);
    expect(await differs(b!, c!)).toBeGreaterThan(0.02);
    expect(await differs(a!, c!)).toBeGreaterThan(0.02);
  });

  it("draws the Spanish EEO line and accented copy with the bundled font", async () => {
    const out = await renderOverlay(await input("4:5", { language: "es", headline: "Gana $0.68 por milla, en casa cada semana", cta: "Aplica hoy" }));
    expect(out.kind).toBe("rendered");
  });
});

describe("overlay renderer — it refuses rather than overflows or invents", () => {
  it("a headline that needs a third line refuses, naming it, with no image", async () => {
    const out = await renderOverlay(await input("1:1", { headline: "Earn $0.68/mile on regional lanes and be home weekly with a team that answers the phone when you call" }));
    expect(out).toEqual({ kind: "refused", findings: [expect.objectContaining({ kind: "too_long", label: "headline", max_lines: 2 })] });
  });

  it("one word wider than the zone refuses as an overflow, never shrunk", async () => {
    const out = await renderOverlay(await input("9:16", { cta: "Apply".repeat(12) }));
    expect(out.kind === "refused" && out.findings).toEqual([expect.objectContaining({ kind: "overflows", label: "cta" })]);
  });

  it("a figure the brief does not hold is refused here too, whatever checked it before", async () => {
    const out = await renderOverlay(await input("4:5", { headline: "Earn $0.75/mile" }));
    expect(out.kind === "refused" && out.findings).toEqual([expect.objectContaining({ kind: "claim", label: "headline", text: "$0.75", claim: "money_not_in_brief" })]);
  });

  it("white text with no plate over the bright sky fails on contrast, measured under the text, not the image's average", async () => {
    const top: Partial<AdBrandKit["overlays"]["1:1"] & object> = { zone: { ...safeZone("1:1"), height: 380 }, text_color: "#FFFFFF", plate_color: null };
    // `top_band`: the words are at the top, so the square is cut keeping the picture's top (AG4) — its sky.
    const out = await renderOverlay(await input("1:1", { kit: { overlays: { "1:1": top as NonNullable<AdBrandKit["overlays"]["1:1"]> } }, logo: null, layout: "top_band" }));
    expect(out.kind === "refused" && out.findings.map((f) => f.kind)).toContain("low_contrast");
    // The same text and colours over the dark lower field pass: the zone decides, not the image.
    const low = await renderOverlay(await input("1:1", { kit: { overlays: { "1:1": { zone: null, text_color: "#FFFFFF", plate_color: null } } }, logo: null }));
    expect(low.kind).toBe("rendered");
  });

  it("one narrow bright stripe behind the words fails, though the rest of the zone is dark", async () => {
    const stripe = await sharp({ create: { width: 24, height: 1200, channels: 3, background: "#FFFFFF" } }).png().toBuffer();
    const dark = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: "#20262C" } }).composite([{ input: stripe, top: 0, left: 588 }]).png().toBuffer();
    const kit = { overlays: { "1:1": { zone: null, text_color: "#FFFFFF", plate_color: null } } };
    const out = await renderOverlay(await input("1:1", { base: dark, kit, logo: null }));
    expect(out.kind === "refused" && out.findings.map((f) => f.kind)).toContain("low_contrast");
  });

  it("a format with no overlay in the brand kit refuses — no colour is invented", async () => {
    const out = await renderOverlay(await input("9:16", { kit: { overlays: {} } }));
    expect(out).toEqual({ kind: "refused", findings: [{ kind: "no_template", format: "9:16" }] });
  });

  it("a character the bundled font cannot draw refuses instead of printing an empty box", async () => {
    const out = await renderOverlay(await input("1:1", { cta: "Apply today 🚚" }));
    expect(out.kind === "refused" && out.findings).toEqual([expect.objectContaining({ kind: "undrawable_character", label: "cta" })]);
  });
});
