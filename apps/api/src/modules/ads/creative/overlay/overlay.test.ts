import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { AD_FORMATS, FORMAT_SIZE, safeZone, type AdBrandKit, type AdFormat, type AdClaim } from "@silvicom/shared";
import { renderOverlay, type OverlayInput } from "./overlay.js";

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

describe("overlay renderer — golden images per format", () => {
  // One literal title per format, so `lint:ads-readiness` can pin each golden (it reads titles as written).
  it("1:1 matches its golden image", () => golden("1:1"));
  it("4:5 matches its golden image", () => golden("4:5"));
  it("9:16 matches its golden image", () => golden("9:16"));

  async function golden(format: AdFormat): Promise<void> {
    const out = await renderOverlay(await input(format));
    if (out.kind !== "rendered") throw new Error(JSON.stringify(out.findings));
    const meta = await sharp(out.png).metadata();
    expect([meta.width, meta.height]).toEqual([FORMAT_SIZE[format].width, FORMAT_SIZE[format].height]);
    const file = new URL(`${format.replace(":", "x")}.png`, GOLDEN);
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
    const out = await renderOverlay(await input("1:1", { kit: { overlays: { "1:1": top as NonNullable<AdBrandKit["overlays"]["1:1"]> } }, logo: null }));
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
