import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { AD_FORMATS, AD_LOOKS, AD_OVERLAY_LAYOUTS, FORMAT_SIZE, contains, safeZone, type AdBrandKit, type AdFormat, type AdClaim, type AdLook, type AdOverlayLayout } from "@silvicom/shared";
import { frameStill, overlayFit, renderOverlay, type OverlayInput } from "./overlay.js";
import { inkOn, paletteOf, SCRIM_STEPS } from "./overlayLooks.js";

/**
 * The overlay renderer (C4; the looks, ADS-AD-LOOK-PLAN): golden images per format, layout and look, and every
 * refusal. The goldens are committed PNGs in `__golden__/`; a render is compared pixel by pixel with a small
 * tolerance, because Skia's antialiasing can differ by a few levels between macOS and Linux with the same font
 * file. `UPDATE_GOLDEN=1` rewrites them — a change to a golden is a change to how every ad looks, and review
 * sees the new PNG in the diff. All values are fixtures — never a real brand value (Q-AD14).
 */
const GOLDEN = new URL("./__golden__/", import.meta.url);
const claims: AdClaim[] = [{ kind: "money", cents: 68, per: "mile" }, { kind: "term", term: "home weekly" }];
const GROUND = "#07130E", ACCENT = "#F2B01E", PRIMARY = "#0B3D2E";
const overlays = (plate: string | null) => Object.fromEntries(AD_FORMATS.map((f) => [f, { zone: null, text_color: "#FFFFFF", plate_color: plate }])) as AdBrandKit["overlays"];
const KIT: OverlayInput["kit"] = {
  overlays: overlays(GROUND), phone: "(555) 010-0142",
  colors: [{ name: "primary", hex: PRIMARY }, { name: "accent", hex: ACCENT }, { name: "white", hex: "#FFFFFF" }],
};

/** A fixture "photo": a mid-grey field with a bright sky band — compresses well, and has a light patch. */
async function base(): Promise<Buffer> {
  const sky = await sharp({ create: { width: 1200, height: 500, channels: 3, background: "#E8EEF4" } }).png().toBuffer();
  return sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#5A6470" } }).composite([{ input: sky, top: 0, left: 0 }]).png().toBuffer();
}
const flat = (background: string) => sharp({ create: { width: 1080, height: 1350, channels: 3, background } }).png().toBuffer();
const logoOf = (r: number, g: number, b: number) => sharp({ create: { width: 300, height: 120, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();

/** All five roles: kicker, headline, second line, call to action, and (the kit's) phone beside the legal line. */
const input = async (format: AdFormat, over: Partial<OverlayInput> = {}): Promise<OverlayInput> => ({
  format, language: "en", base: await base(), kicker: "Now hiring", headline: "Earn $0.68/mile and be home weekly", subline: "Home weekly", cta: "Apply today",
  brief: { claims }, kit: KIT, logo: await logoOf(230, 170, 30), ...over,
});
const rendered = async (i: OverlayInput) => {
  const out = await renderOverlay(i);
  if (out.kind !== "rendered") throw new Error(JSON.stringify(out.findings));
  return out;
};
const pixel = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * 3;
  return [data[at]!, data[at + 1]!, data[at + 2]!];
};

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
   * A 4:5 picture with its subject high and its lower part plain, as the art director composes one for
   * `bottom_plate` (thirds when this was written; half since D-ADL14 — the cut under test does not depend on
   * which). Rows 0–299 sky, 300–849 red, 850–1349 grey (at 1080 wide).
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
  // One literal title per golden, so `lint:ads-readiness` can pin each (it reads titles as written). The nine
  // that were here before the looks keep their titles and files: they are now the `rail` look, the default.
  it("1:1 matches its golden image", () => golden("1:1"));
  it("4:5 matches its golden image", () => golden("4:5"));
  it("9:16 matches its golden image", () => golden("9:16"));
  it("1:1 top_band matches its golden image", () => golden("1:1", "top_band"));
  it("4:5 top_band matches its golden image", () => golden("4:5", "top_band"));
  it("9:16 top_band matches its golden image", () => golden("9:16", "top_band"));
  it("1:1 centered matches its golden image", () => golden("1:1", "centered"));
  it("4:5 centered matches its golden image", () => golden("4:5", "centered"));
  it("9:16 centered matches its golden image", () => golden("9:16", "centered"));
  it("1:1 ribbon matches its golden image", () => golden("1:1", "bottom_plate", "ribbon"));
  it("4:5 ribbon matches its golden image", () => golden("4:5", "bottom_plate", "ribbon"));
  it("9:16 ribbon matches its golden image", () => golden("9:16", "bottom_plate", "ribbon"));
  it("4:5 ribbon top_band matches its golden image", () => golden("4:5", "top_band", "ribbon"));
  it("4:5 ribbon centered matches its golden image", () => golden("4:5", "centered", "ribbon"));

  async function golden(format: AdFormat, layout: AdOverlayLayout = "bottom_plate", look: AdLook = "rail"): Promise<void> {
    const out = await rendered(await input(format, { layout, look }));
    const meta = await sharp(out.png).metadata();
    expect([meta.width, meta.height]).toEqual([FORMAT_SIZE[format].width, FORMAT_SIZE[format].height]);
    const name = [format.replace(":", "x"), ...(look === "rail" ? [] : [look]), ...(layout === "bottom_plate" ? [] : [layout])].join("-");
    const file = new URL(`${name}.png`, GOLDEN);
    if (process.env.UPDATE_GOLDEN === "1" || !existsSync(file)) {
      if (process.env.CI === "true" && !existsSync(file)) throw new Error(`golden ${file.pathname} is missing — run with UPDATE_GOLDEN=1 and commit it`);
      mkdirSync(GOLDEN, { recursive: true });
      writeFileSync(file, out.png);
    }
    expect(await differs(out.png, readFileSync(file))).toBeLessThan(0.005);
  }

  it("draws five roles in reading order, every one inside the format's safe zone, in both looks", async () => {
    for (const look of AD_LOOKS) {
      for (const format of AD_FORMATS) {
        const out = await rendered(await input(format, { look }));
        for (const b of out.blocks) expect(contains(safeZone(format), b.box), `${look} ${format} ${b.label}`).toBe(true);
        // The rail look draws the headline's figure in the accent colour, and that second colour is judged too.
        expect(out.blocks.map((b) => b.label)).toEqual(["kicker", "headline", ...(look === "rail" ? ["headline_figures"] : []), "subline", "cta", "phone", "eeo"]);
      }
    }
  });

  it("an ad with only a headline and a call to action is the same look with those rows absent, and no phone is drawn for a kit without one", async () => {
    const out = await rendered(await input("4:5", { kicker: null, subline: undefined, kit: { ...KIT, phone: null } }));
    expect(out.blocks.map((b) => b.label)).toEqual(["headline", "headline_figures", "cta", "eeo"]);
    const full = await rendered(await input("4:5"));
    expect(out.stack.height).toBeLessThan(full.stack.height);
  });

  it("every layout keeps the stack inside the zone: top_band highest, centered between, bottom_plate lowest, and the same words make the same stack in each", async () => {
    for (const look of AD_LOOKS) {
      for (const format of AD_FORMATS) {
        const z = safeZone(format);
        const [low, high, mid] = await Promise.all(AD_OVERLAY_LAYOUTS.map(async (layout) => (await rendered(await input(format, { layout, look }))).stack));
        for (const s of [low!, high!, mid!]) expect(contains(z, s), `${look} ${format}`).toBe(true);
        expect(high!.y).toBeLessThan(mid!.y);
        expect(mid!.y).toBeLessThan(low!.y);
        expect(new Set([low!.height, high!.height, mid!.height]).size).toBe(1);
      }
    }
  });

  it("the same words on the same picture are a different image per layout and per look", async () => {
    const of = async (layout: AdOverlayLayout, look: AdLook) => (await rendered(await input("4:5", { layout, look }))).png;
    const [a, b, c, d] = await Promise.all([of("bottom_plate", "rail"), of("top_band", "rail"), of("centered", "rail"), of("bottom_plate", "ribbon")]);
    expect(await differs(a!, b!)).toBeGreaterThan(0.02);
    expect(await differs(b!, c!)).toBeGreaterThan(0.02);
    expect(await differs(a!, c!)).toBeGreaterThan(0.02);
    expect(await differs(a!, d!)).toBeGreaterThan(0.02);
  });

  it("draws the Spanish EEO line and accented copy in capitals with the bundled faces, in both looks", async () => {
    for (const look of AD_LOOKS) {
      const out = await renderOverlay(await input("4:5", { look, language: "es", kicker: "Contratación", headline: "Gana $0.68 por milla, en casa cada semana", subline: "¿Más millas? Sí", cta: "Aplica hoy" }));
      expect(out.kind, look).toBe("rendered");
    }
  });
});

describe("overlay renderer — the headline steps down a ladder, and only the headline (D-ADL3)", () => {
  const headlinePx = async (headline: string, over: Partial<OverlayInput> = {}) => (await rendered(await input("4:5", { headline, ...over }))).blocks.find((b) => b.label === "headline")!.px;

  it("a short headline is drawn at the top rung, a longer one lower, and every other line keeps its one size", async () => {
    expect(await headlinePx("$0.68/mile")).toBe(176);
    const long = await rendered(await input("4:5", { headline: "Earn $0.68/mile and be home weekly" }));
    const short = await rendered(await input("4:5", { headline: "$0.68/mile" }));
    const px = (o: typeof long, label: string) => o.blocks.find((b) => b.label === label)!.px;
    expect(px(long, "headline")).toBeLessThan(176);
    expect(px(long, "headline")).toBeGreaterThanOrEqual(84);
    for (const label of ["kicker", "subline", "cta", "phone", "eeo"]) expect(px(long, label), label).toBe(px(short, label));
  });

  it("a headline that would push the stack out of the plain part of the picture steps down, though its lines fit wider", async () => {
    // Two lines hold these words at the top rung by width; on the square the stack would then pass two fifths of
    // the frame, so a lower rung is taken. On the taller 4:5 the same words keep a higher one.
    const words = "$0.68/mile home weekly";
    const square = (await rendered(await input("1:1", { headline: words }))).blocks.find((b) => b.label === "headline")!.px;
    expect(square).toBeLessThan(await headlinePx(words));
  });
});

describe("overlay renderer — the picture is darkened by as much as it needs (D-ADL1)", () => {
  it("a bright picture under the words takes a stronger step than a dark one, and both are readable", async () => {
    const bright = await rendered(await input("4:5", { base: await flat("#F4F6F8"), logo: null }));
    const dark = await rendered(await input("4:5", { base: await flat("#1B2126"), logo: null }));
    expect(dark.scrim).toBe(SCRIM_STEPS[0]);
    expect(bright.scrim).toBeGreaterThan(dark.scrim);
  });

  it("one narrow bright stripe behind the words raises the step for the whole stack, where a null plate would refuse", async () => {
    const stripe = await sharp({ create: { width: 24, height: 1350, channels: 3, background: "#FFFFFF" } }).png().toBuffer();
    const striped = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#20262C" } }).composite([{ input: stripe, top: 0, left: 300 }]).png().toBuffer();
    const plain = await rendered(await input("4:5", { base: await flat("#20262C"), logo: null }));
    const out = await rendered(await input("4:5", { base: striped, logo: null }));
    expect(out.scrim).toBeGreaterThan(plain.scrim);
    const refused = await renderOverlay(await input("4:5", { base: striped, logo: null, kit: { ...KIT, overlays: overlays(null) } }));
    expect(refused.kind === "refused" && refused.findings.map((f) => f.kind)).toContain("low_contrast");
  });

  it("the picture above the stack is left as it was: the scrim fades out, it is not a box", async () => {
    const out = await rendered(await input("4:5", { base: await flat("#8090A0"), logo: null }));
    expect(await pixel(out.png, 540, 40)).toEqual([0x80, 0x90, 0xa0]);
    // Just above the stack the picture is darker than at the top and lighter than under the words: a fade.
    const edge = (await pixel(out.png, 1000, Math.round(out.stack.y) - 90))[0]!;
    const under = (await pixel(out.png, 1000, Math.round(out.stack.y) + 4))[0]!;
    expect(edge).toBeLessThan(0x80);
    expect(edge).toBeGreaterThan(under);
  });

  it("on 9:16 the picture under the safe zone is left alone too: the part the platform's controls cover is not darkened", async () => {
    const out = await rendered(await input("9:16", { base: await flat("#8090A0"), logo: null }));
    expect(await pixel(out.png, 540, 1900)).toEqual([0x80, 0x90, 0xa0]);
  });

  it("a kit whose plate is null darkens nothing, and the check alone decides", async () => {
    const out = await rendered(await input("4:5", { base: await flat("#1B2126"), logo: null, kit: { ...KIT, overlays: overlays(null) } }));
    expect(out.scrim).toBe(0);
    expect(await pixel(out.png, 1000, Math.round(out.stack.y) + 4)).toEqual([0x1b, 0x21, 0x26]);
  });
});

describe("overlay renderer — the kit's colours are read (D-ADL5) and the logo is measured (D-ADL7)", () => {
  const ov = { zone: null, text_color: "#FFFFFF", plate_color: GROUND };

  it("the accent is the colour the kit names accent; with none named, the kit colour that stands out most from the ground", () => {
    expect(paletteOf(ov, KIT.colors).accent).toBe(ACCENT);
    expect(paletteOf(ov, [{ name: "primary", hex: PRIMARY }, { name: "sun", hex: "#F2B01E" }, { name: "rust", hex: "#B5482A" }]).accent).toBe("#F2B01E");
  });

  it("a colour too close to the ground, or the text colour again, is never the accent: the accent shapes are then drawn in the text colour", () => {
    expect(paletteOf(ov, [{ name: "accent", hex: "#0B3D2E" }, { name: "white", hex: "#FFFFFF" }]).accent).toBe("#FFFFFF");
    expect(paletteOf(ov, undefined).accent).toBe("#FFFFFF");
  });

  it("the footer band is the colour named primary, and words on a shape are whichever of the kit's two overlay colours reads better on it", () => {
    const p = paletteOf(ov, KIT.colors);
    expect(p.primary).toBe(PRIMARY);
    expect(inkOn(ACCENT, p)).toBe(GROUND);
    expect(inkOn(PRIMARY, p)).toBe("#FFFFFF");
  });

  it("the rail look paints the button in the accent colour and the band in the primary; the ribbon look paints the ribbon in the accent", async () => {
    const rail = await rendered(await input("4:5", { logo: null }));
    const hex = (c: number[]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
    expect(hex(await pixel(rail.png, 540, 1340))).toBe(PRIMARY);
    const cta = rail.blocks.find((b) => b.label === "cta")!.box;
    expect(hex(await pixel(rail.png, Math.round(cta.x) - 12, Math.round(cta.y)))).toBe(ACCENT);
    const ribbon = await rendered(await input("4:5", { logo: null, look: "ribbon" }));
    const sub = ribbon.blocks.find((b) => b.label === "subline")!.box;
    expect(hex(await pixel(ribbon.png, Math.round(sub.x) - 12, Math.round(sub.y)))).toBe(ACCENT);
  });

  it("a logo that would vanish into what is under it is set on a chip; one that reads is drawn straight on the picture", async () => {
    const z = safeZone("4:5");
    const sky = await flat("#E8EEF4");
    // 6 px outside the logo's corner: inside the chip's padding when a chip is drawn, bare picture when not.
    const beside = async (logo: Buffer) => pixel((await rendered(await input("4:5", { base: sky, logo }))).png, z.x - 6, z.y - 6);
    expect(await beside(await logoOf(250, 250, 250))).toEqual([0x07, 0x13, 0x0e]);
    expect(await beside(await logoOf(20, 30, 25))).toEqual([0xe8, 0xee, 0xf4]);
  });
});

describe("overlay renderer — it refuses rather than overflows or invents", () => {
  it("a headline that needs a third line at the lowest rung refuses, naming it, with no image", async () => {
    const out = await renderOverlay(await input("1:1", { headline: "Earn $0.68/mile on regional lanes and be home weekly with a team that answers the phone when you call" }));
    expect(out).toEqual({ kind: "refused", findings: [expect.objectContaining({ kind: "too_long", label: "headline", max_lines: 2 })] });
  });

  it("a line with one size refuses as an overflow, never shrunk: the call to action, the kicker and the second line", async () => {
    for (const [label, over] of [["cta", { cta: "Apply".repeat(12) }], ["kicker", { kicker: "Now hiring ".repeat(8) }], ["subline", { subline: "Home weekly ".repeat(8) }]] as const) {
      const i = await input("4:5", over);
      const out = await renderOverlay(i);
      expect(out.kind === "refused" && out.findings, label).toEqual([expect.objectContaining({ kind: "overflows", label })]);
      // And it is known before any picture exists: compose asks this first (D-AD26).
      expect(overlayFit(i).map((f) => [f.kind, "label" in f && f.label]), label).toEqual([["overflows", label]]);
    }
  });

  it("a figure the brief does not hold is refused here too, whatever checked it before — in the headline, the kicker or the second line", async () => {
    const out = await renderOverlay(await input("4:5", { headline: "Earn $0.75/mile" }));
    expect(out.kind === "refused" && out.findings).toEqual([expect.objectContaining({ kind: "claim", label: "headline", text: "$0.75", claim: "money_not_in_brief" })]);
    for (const label of ["kicker", "subline"] as const) {
      const o = await renderOverlay(await input("4:5", { [label]: "$0.75/mile" }));
      expect(o.kind === "refused" && o.findings, label).toEqual([expect.objectContaining({ kind: "claim", label, claim: "money_not_in_brief" })]);
    }
  });

  it("white text with no plate over the bright sky fails on contrast, measured under the text, not the image's average", async () => {
    // `top_band`: the words are at the top, so the square is cut keeping the picture's top (AG4) — its sky.
    const kit = { ...KIT, overlays: overlays(null) };
    const out = await renderOverlay(await input("1:1", { kit, logo: null, layout: "top_band" }));
    expect(out.kind === "refused" && out.findings.map((f) => f.kind)).toContain("low_contrast");
    // The same text and colours over the dark lower field pass: where the words are decides, not the image.
    const low = await renderOverlay(await input("1:1", { kit: { ...kit, colors: undefined }, logo: null }));
    expect(low.kind).toBe("rendered");
  });

  it("text and ground too close to read is refused however strong the scrim: the kit's two colours are the check's, not ours to fix", async () => {
    const kit = { ...KIT, colors: undefined, overlays: Object.fromEntries(AD_FORMATS.map((f) => [f, { zone: null, text_color: "#FFFFFF", plate_color: "#E0E4E8" }])) as AdBrandKit["overlays"] };
    const out = await renderOverlay(await input("4:5", { kit, logo: null }));
    expect(out.kind === "refused" && out.findings.map((f) => f.kind)).toContain("low_contrast");
  });

  it("a format with no overlay in the brand kit refuses — no colour is invented", async () => {
    const out = await renderOverlay(await input("9:16", { kit: { overlays: {} } }));
    expect(out).toEqual({ kind: "refused", findings: [{ kind: "no_template", format: "9:16" }] });
  });

  it("a character the bundled faces cannot draw refuses instead of printing an empty box", async () => {
    const out = await renderOverlay(await input("1:1", { cta: "Apply today 🚚" }));
    expect(out.kind === "refused" && out.findings).toEqual([expect.objectContaining({ kind: "undrawable_character", label: "cta" })]);
  });
});
