// What is the vector trial's longest freeze? (item 7 follow-up, 2026-11-11.) Runs the zoom sequence of
// staging-map-frames.mjs once on BASEMAP (default the vector trial) at THROTTLE× CPU with Chrome's JS sampling
// profiler, finds the TOP longest unbroken stretches of main-thread work (no "(idle)" sample), and prints, for
// each, its length and the functions that took the most time inside it: self time, and inclusive time by
// function. maplibre's minified bundle keeps its method names (_placeLayer, …), so they read.
//   EMAIL=... PW="$(security find-generic-password ...)" node docs/plans/livemap/tools/staging-map-freeze-profile.mjs
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
const BASE = "https://staging-api.360.silvicominc.com";
const THROTTLE = Number(process.env.THROTTLE ?? 4);
const BASEMAP = process.env.BASEMAP ?? "Map (vector trial)";
const TOP = Number(process.env.TOP ?? 3);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`); await page.fill("#email", process.env.EMAIL); await page.fill("#password", process.env.PW);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
await page.goto(`${BASE}/?tab=dispatch`); await page.waitForSelector("canvas.maplibregl-canvas"); await page.waitForTimeout(4000);
if (BASEMAP !== "Map") { await page.click('[aria-label^="Basemap:"]'); await page.click(`button.kebab-item:has-text("${BASEMAP}")`); await page.waitForTimeout(5000); }
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
await cdp.send("Profiler.start");
const box = await page.locator("canvas.maplibregl-canvas").boundingBox();
const X = box.x + box.width * 0.62, Y = box.y + box.height * 0.36;
for (let k = 0; k < 7; k++) { await page.mouse.dblclick(X, Y); await page.waitForTimeout(900); }
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, 500); await page.waitForTimeout(900); }
await page.waitForTimeout(2500);
const { profile } = await cdp.send("Profiler.stop");
if (process.env.SAVE) writeFileSync(process.env.SAVE, JSON.stringify(profile));
await browser.close();

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const name = (n) => `${n.callFrame.functionName || "(anonymous)"} ${(n.callFrame.url.split("/").pop() || "").replace(/-[\w-]{8}\.js$/, ".js")}`.trim();
// Sample i lasts timeDeltas[i+1]; walk them into contiguous busy stretches.
const t = []; let at = 0;
for (let i = 0; i < profile.samples.length; i++) { at += profile.timeDeltas[i]; t.push(at); }
const idle = (id) => ["(idle)", "(program)", "(garbage collector)"].includes(byId.get(id).callFrame.functionName) && byId.get(id).callFrame.functionName === "(idle)";
const stretches = []; let start = -1;
for (let i = 0; i < profile.samples.length; i++) {
  const busy = !idle(profile.samples[i]);
  if (busy && start < 0) start = i;
  if ((!busy || i === profile.samples.length - 1) && start >= 0) { stretches.push({ from: start, to: i, ms: (t[i] - t[start]) / 1000 }); start = -1; }
}
stretches.sort((a, b) => b.ms - a.ms);
console.log(`profile ${(t.at(-1) / 1e6).toFixed(1)} s, ${profile.samples.length} samples; busy stretches over 100 ms: ${stretches.filter((s) => s.ms > 100).length}`);
for (const s of stretches.slice(0, TOP)) {
  const self = new Map(), incl = new Map();
  for (let i = s.from; i < s.to; i++) {
    const dt = (t[i + 1] - t[i]) / 1000;
    const leaf = byId.get(profile.samples[i]);
    self.set(name(leaf), (self.get(name(leaf)) ?? 0) + dt);
    const seen = new Set();
    for (let id = profile.samples[i]; id !== undefined; id = parent.get(id)) {
      const k = name(byId.get(id)); if (seen.has(k)) continue; seen.add(k);
      incl.set(k, (incl.get(k) ?? 0) + dt);
    }
  }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `    ${v.toFixed(0).padStart(5)} ms  ${k}`).join("\n");
  console.log(`\n== busy stretch of ${s.ms.toFixed(0)} ms\n  self time:\n${top(self, 12)}\n  inclusive:\n${top(incl, 18)}`);
}
