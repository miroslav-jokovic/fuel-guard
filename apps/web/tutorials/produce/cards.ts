import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import type { Tutorial } from "../scenario";

/**
 * The title card before a tutorial and the end card after it, as two 1920×1080 stills.
 *
 * ── NOT REMOTION ────────────────────────────────────────────────────────────────────────────────
 * The handoff suggested Remotion, as the maintenance proposal video used. These are two still cards
 * with a fade, and Remotion would bring React 19, its own headless Chromium and a second render
 * pipeline into the web workspace for them — against `compose.ts`'s rule of FFmpeg only and no
 * second compositor. So each card is an HTML page drawn by the Chromium the recorder already
 * drives, and `compose.ts` holds it on screen and joins it to the recording (2026-10-27).
 *
 * ── THE PRODUCT'S OWN LOOK, READ, NOT RESTATED ──────────────────────────────────────────────────
 * Colours come from `@silvicom/ui`'s generated tokens (the same file the app loads), the type is the
 * app's Hanken Grotesk from `public/fonts`, and the logo is `public/SilvicomLogo360.svg`. Nothing
 * here names a hex value, so a token change reaches the cards at the next recording.
 *
 * ── WHAT THEY SAY IS DERIVED ────────────────────────────────────────────────────────────────────
 * The title, summary and chapter list are the tutorial's own; "2 of 4" and "Next" come from the
 * order of approved tutorials in `scenarios/index.ts`. A card cannot describe a video that differs.
 */

const WEB = path.resolve(import.meta.dirname, "../..");
const TOKENS = path.resolve(WEB, "../../packages/ui/src/tokens.generated.css");
const FONTS = path.join(WEB, "public/fonts");
const LOGO = path.join(WEB, "public/SilvicomLogo360.svg");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const url = (file: string) => pathToFileURL(file).href;

function page(body: string): string {
  const faces = [400, 500, 600, 700]
    .map((w) => `@font-face{font-family:"Hanken Grotesk";font-weight:${w};src:url("${url(path.join(FONTS, `HankenGrotesk-${w}-Regular.woff2`))}")}`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${url(TOKENS)}">
<style>
${faces}
:root{color-scheme:light}
*{box-sizing:border-box;margin:0}
body{width:1920px;height:1080px;overflow:hidden;font-family:"Hanken Grotesk",system-ui,sans-serif;
  background:var(--canvas);color:var(--ink);display:flex;flex-direction:column;padding:120px 160px}
.rule{height:8px;width:120px;border-radius:4px;background:var(--ramp-brand-600);margin:56px 0 40px}
.eyebrow{font-size:30px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ramp-brand-700)}
h1{font-size:120px;font-weight:700;line-height:1.02;letter-spacing:-.02em;margin-top:20px}
.summary{font-size:40px;line-height:1.35;color:var(--ink-secondary);max-width:1300px;margin-top:32px}
ol{list-style:none;padding:0;margin-top:auto;display:flex;gap:28px}
li{flex:1;background:var(--surface);border-radius:20px;padding:32px 36px;font-size:32px;font-weight:600;
  box-shadow:0 1px 2px oklch(0% 0 0 / .06),0 8px 24px oklch(0% 0 0 / .05)}
li span{display:block;font-size:24px;font-weight:600;color:var(--ramp-brand-600);margin-bottom:10px}
.next{margin-top:auto;background:var(--surface);border-radius:24px;padding:44px 52px;max-width:1300px;
  box-shadow:0 1px 2px oklch(0% 0 0 / .06),0 8px 24px oklch(0% 0 0 / .05)}
.next .eyebrow{font-size:26px}
.next h2{font-size:64px;font-weight:700;margin-top:12px}
.next p{font-size:32px;line-height:1.35;color:var(--ink-secondary);margin-top:14px}
.logo{height:72px;width:auto;align-self:flex-start}
</style></head><body><img class="logo" src="${url(LOGO)}" alt="">${body}</body></html>`;
}

export interface CardFiles {
  intro: string;
  outro: string;
}

/** Draws both cards for `tutorial` into `outDir` as `card-intro.png` and `card-outro.png`. */
export async function renderCards(outDir: string, tutorial: Tutorial, series: readonly Tutorial[]): Promise<CardFiles> {
  const at = series.findIndex((t) => t.id === tutorial.id);
  const next = series[at + 1];
  const place = at >= 0 ? ` · ${at + 1} of ${series.length}` : "";

  const intro = page(`
<div class="rule"></div>
<div class="eyebrow">Dispatcher training${place}</div>
<h1>${esc(tutorial.title)}</h1>
<p class="summary">${esc(tutorial.summary)}</p>
<ol>${tutorial.chapters.map((c, i) => `<li><span>${i + 1}</span>${esc(c.title)}</li>`).join("")}</ol>`);

  const outro = page(`
<div class="rule"></div>
<div class="eyebrow">Dispatcher training${place}</div>
<h1>${esc(tutorial.title)}</h1>
${
  // The title stands alone, never inside a sentence: titles are written for a heading ("The Live
  // map"), and "That's The Live map." read wrong on the first cut.
  next
    ? `<p class="summary">That's the end of this video.</p><div class="next"><div class="eyebrow">Next</div><h2>${esc(next.title)}</h2><p>${esc(next.summary)}</p></div>`
    : `<p class="summary">That's the end of this video, and of the series.</p>`
}`);

  const files: CardFiles = { intro: path.join(outDir, "card-intro.png"), outro: path.join(outDir, "card-outro.png") };
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    for (const [html, file] of [[intro, files.intro], [outro, files.outro]] as const) {
      // A file page, so the tokens, fonts and logo load by file:// beside it.
      const src = file.replace(/\.png$/, ".html");
      fs.writeFileSync(src, html);
      await p.goto(url(src));
      await p.evaluate(() => document.fonts.ready);
      await p.screenshot({ path: file });
      fs.rmSync(src);
    }
  } finally {
    await browser.close();
  }
  return files;
}
