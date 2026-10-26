import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { narrationFor, type NarrationManifest } from "./produce/narration";
import type { Tutorial, TutorialStep } from "./scenario";

/**
 * Plays a `Tutorial` against the page: moves a visible cursor, rings what it is about to touch, does
 * it, waits for the page to PROVE it happened, and holds the shot for as long as the narration speaks.
 *
 * ── WHY OUR OWN CURSOR, NOT `screencast.showActions()` ──────────────────────────────────────────
 * On 1.61 `showActions` captions every action with its Playwright title ("locator.click …") and only
 * 1.64's `style` option can hide it. That is a debugging overlay, not something to put in front of a
 * dispatcher, so the cursor and the ring are two fixed-position elements drawn into the page here. The
 * ring's colour is the app's own `--ramp-brand-600` token, read in the page, never a copied hex.
 *
 * ── THE EXPECT IS NOT OPTIONAL ──────────────────────────────────────────────────────────────────
 * Every step names what the page must show after it (`TutorialStep.expect`), and the step does not
 * end until Playwright's web-first assertion passes. A recording therefore cannot carry on past a
 * click that did nothing: it fails, and no video of a broken screen is ever produced.
 *
 * ── PACING COMES FROM THE VOICE ─────────────────────────────────────────────────────────────────
 * Narration is generated BEFORE recording (`produce/narration.ts`), so each step knows how long its
 * line is and holds at least that long. Sound and picture then line up without stretching either,
 * and the timeline written here is exactly where `compose.ts` places each line and each caption.
 */

export interface TimelineEntry {
  chapter: number;
  step: number;
  chapterTitle: string;
  say: string;
  /** Milliseconds from the start of the video. */
  startMs: number;
  endMs: number;
  narrationFile: string | null;
  narrationMs: number;
  shot: string | null;
}

export interface DirectorOptions {
  /** `record` films at speaking pace; `check` runs every action and assertion as fast as it can. */
  mode: "record" | "check";
  outDir: string;
  narration: NarrationManifest | null;
}

/** A line of narration starts this long before its action, so the viewer hears why before seeing what. */
const LEAD_MS = 700;
/** Silence between two lines — a breath, not a pause. */
const GAP_MS = 450;
const CURSOR_TRAVEL_MS = 750;
const CHAPTER_CARD_MS = 2600;

const OVERLAY = `(() => {
  if (window.__tutorial) return;
  const install = () => {
    if (document.getElementById("__tut_cursor")) return;
    const cursor = document.createElement("div");
    cursor.id = "__tut_cursor";
    cursor.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:transform ${CURSOR_TRAVEL_MS}ms cubic-bezier(.45,0,.2,1);will-change:transform";
    cursor.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))"><path d="M4 2l15 11.2-6.6 1.3 3.9 7.3-2.9 1.5-3.9-7.4L4 20z" fill="black" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    const ring = document.createElement("div");
    ring.id = "__tut_ring";
    ring.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;border-radius:12px;opacity:0;transition:opacity 220ms ease, left 220ms ease, top 220ms ease, width 220ms ease, height 220ms ease;border:3px solid var(--ramp-brand-600);box-shadow:0 0 0 6px color-mix(in oklch, var(--ramp-brand-600) 22%, transparent)";
    document.documentElement.append(ring, cursor);
    const last = JSON.parse(sessionStorage.getItem("__tut_pos") || '{"x":960,"y":600}');
    cursor.style.transition = "none";
    cursor.style.transform = "translate(" + last.x + "px," + last.y + "px)";
    requestAnimationFrame(() => (cursor.style.transition = "transform ${CURSOR_TRAVEL_MS}ms cubic-bezier(.45,0,.2,1)"));
  };
  window.__tutorial = {
    move(x, y) { install(); sessionStorage.setItem("__tut_pos", JSON.stringify({ x, y })); document.getElementById("__tut_cursor").style.transform = "translate(" + (x - 4) + "px," + (y - 2) + "px)"; },
    ring(b) { install(); const r = document.getElementById("__tut_ring"); const pad = 6; Object.assign(r.style, { left: b.x - pad + "px", top: b.y - pad + "px", width: b.width + pad * 2 + "px", height: b.height + pad * 2 + "px", opacity: "1" }); },
    unring() { const r = document.getElementById("__tut_ring"); if (r) r.style.opacity = "0"; },
    pulse() { const c = document.getElementById("__tut_cursor"); if (!c) return; c.animate([{ scale: 1 }, { scale: 0.82 }, { scale: 1 }], { duration: 260 }); },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
})();`;

export async function installOverlay(page: Page): Promise<void> {
  await page.addInitScript(OVERLAY);
}

export class Director {
  readonly timeline: TimelineEntry[] = [];
  private t0 = Date.now();

  constructor(private readonly page: Page, private readonly opts: DirectorOptions) {}

  private now(): number {
    return Date.now() - this.t0;
  }

  private async wait(ms: number): Promise<void> {
    if (ms > 0) await this.page.waitForTimeout(ms);
  }

  /** Glide the cursor to the middle of `target`, ring it, and move the real mouse there too (hover states). */
  private async approach(target: Locator): Promise<{ x: number; y: number }> {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error(`Cannot point at ${target}: it has no box on screen.`);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (this.opts.mode === "record") {
      await this.page.evaluate(([b, px, py]) => {
        const t = (window as unknown as { __tutorial: { ring(b: unknown): void; move(x: number, y: number): void } }).__tutorial;
        t.ring(b);
        t.move(px, py);
      }, [box, x, y] as const);
      await this.page.mouse.move(x, y, { steps: 18 });
      await this.wait(CURSOR_TRAVEL_MS);
    }
    return { x, y };
  }

  private async release(): Promise<void> {
    if (this.opts.mode !== "record") return;
    await this.page.evaluate(() => (window as unknown as { __tutorial: { unring(): void } }).__tutorial.unring());
  }

  private async perform(step: TutorialStep): Promise<void> {
    const a = step.act;
    if (!a) return;
    const p = this.page;
    switch (a.kind) {
      case "goto":
        await p.goto(a.path, { waitUntil: "load" });
        return;
      case "point":
        await this.approach(a.target(p));
        await this.wait(this.opts.mode === "record" ? 900 : 0);
        await this.release();
        return;
      case "click": {
        const target = a.target(p);
        await this.approach(target);
        if (this.opts.mode === "record") {
          await p.evaluate(() => (window as unknown as { __tutorial: { pulse(): void } }).__tutorial.pulse());
          await this.wait(180);
        }
        await this.release();
        await target.click();
        return;
      }
      case "type": {
        const target = a.target(p);
        await this.approach(target);
        await this.release();
        await target.click();
        if (a.clear) await target.fill("");
        await target.pressSequentially(a.text, { delay: this.opts.mode === "record" ? 85 : 0 });
        return;
      }
      case "select": {
        const target = a.target(p);
        await this.approach(target);
        await this.release();
        await target.selectOption(a.value);
        return;
      }
      case "press":
        await p.keyboard.press(a.key);
        return;
    }
  }

  async chapterCard(title: string, description: string | undefined): Promise<void> {
    if (this.opts.mode !== "record") return;
    await this.page.screencast.showChapter(title, { description, duration: CHAPTER_CARD_MS });
    await this.wait(CHAPTER_CARD_MS + 300);
  }

  async play(tutorial: Tutorial): Promise<void> {
    this.t0 = Date.now();
    for (const [ci, chapter] of tutorial.chapters.entries()) {
      await this.chapterCard(chapter.title, chapter.description);
      for (const [si, step] of chapter.steps.entries()) {
        const line = narrationFor(this.opts.narration, step.say);
        const startMs = this.now();
        if (this.opts.mode === "record" && step.act && step.act.kind !== "goto") await this.wait(LEAD_MS);
        await this.perform(step);
        await step.expect(this.page);
        let shot: string | null = null;
        if (step.shot !== false) {
          shot = `${String(ci + 1).padStart(2, "0")}-${String(si + 1).padStart(2, "0")}.jpg`;
          fs.mkdirSync(path.join(this.opts.outDir, "steps"), { recursive: true });
          await this.page.screenshot({ path: path.join(this.opts.outDir, "steps", shot), type: "jpeg", quality: 78 });
        }
        if (this.opts.mode === "record") await this.wait(startMs + line.ms + GAP_MS - this.now());
        this.timeline.push({
          chapter: ci + 1, step: si + 1, chapterTitle: chapter.title, say: step.say, startMs, endMs: this.now(),
          narrationFile: line.file, narrationMs: line.ms, shot,
        });
      }
    }
    if (this.opts.mode === "record") await this.wait(1200);
  }
}
