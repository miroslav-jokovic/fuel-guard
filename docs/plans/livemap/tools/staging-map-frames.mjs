// Item 7 of the vector-map handoff: today's map and the vector trial on STAGING, the same zoom sequence as
// staging-map-compare.mjs, Chrome's CPU slowed by THROTTLE (default 4, "an older office PC"), RUNS of each
// (default 5) alternating so time-of-day drift lands on both. Per run: frames over 50 ms and the longest
// frame (requestAnimationFrame gaps), main-thread long-task time (PerformanceObserver "longtask"), tile
// requests, truck-source writes a second over a 10 s still hold at the fitted zoom and writes over the walk
// (D-DR39's figure: before the gate it was one per frame), and wall time. Prints every run and the min–max
// range per map: ranges, never a single number.
//   EMAIL=... PW="$(security find-generic-password ...)" node docs/plans/livemap/tools/staging-map-frames.mjs
// ⚠ A rig in a headless browser on this Mac is not the office PC. It answers "did the font fix move the
// numbers, and which way"; the owner's look on the slowest office PC is still the deciding check.
import { chromium } from "playwright-core";
const BASE = "https://staging-api.360.silvicominc.com";
const RUNS = Number(process.env.RUNS ?? 5);
const THROTTLE = Number(process.env.THROTTLE ?? 4);
// ⚠ GPU=1 draws WebGL on this machine's graphics chip. Without it headless Chrome uses SwiftShader, a SOFTWARE
// renderer on the CPU (measured 2026-11-11: "SwiftShader Device"), which no office PC with a GPU uses and which
// costs a vector map far more than raster images. Neither is the office PC: SwiftShader is a floor, a
// developer Mac's GPU a ceiling. Each run prints the renderer it actually used.
const browser = await chromium.launch(process.env.GPU === "1" ? { args: ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"] } : {});
const results = [];
for (let i = 0; i < RUNS * 2; i++) {
  const mode = i % 2 === 0 ? "map" : "vector";
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.fill("#email", process.env.EMAIL); await page.fill("#password", process.env.PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
  await page.goto(`${BASE}/?tab=dispatch`); await page.waitForSelector("canvas.maplibregl-canvas"); await page.waitForTimeout(4000);
  if (mode === "vector") { await page.click('[aria-label^="Basemap:"]'); await page.click('button.kebab-item:has-text("Map (vector trial)")'); await page.waitForTimeout(5000); }
  const renderer = await page.evaluate(() => { const gl = document.createElement("canvas").getContext("webgl2"); const d = gl?.getExtension("WEBGL_debug_renderer_info"); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : "unknown"; });
  if (i === 0) console.log("renderer:", renderer);
  let tiles = 0;
  page.on("request", (r) => { if (r.url().includes("/map-tiles/")) tiles++; });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  await page.evaluate(() => {
    const w = window; w.__frames = []; w.__long = 0; w.__writes = 0; let last = performance.now();
    const tick = (t) => { w.__frames.push(t - last); last = t; if (!w.__stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__long += e.duration; }).observe({ type: "longtask" });
    // D-DR39: the canvas announces every write of the truck source; before the gate this was one per frame.
    window.addEventListener("livemap:write", () => { w.__writes += 1; });
  });
  const box = await page.locator("canvas.maplibregl-canvas").boundingBox();
  const X = box.x + box.width * 0.62, Y = box.y + box.height * 0.36;
  // Ten seconds still, at the zoom the fleet is watched from (the fitted view, maxZoom 9): writes a second
  // here is the D-DR39 figure — the fleet is moving, nobody touches the map, how often is the source rewritten?
  const HOLD_MS = 10_000;
  await page.evaluate(() => { window.__writes = 0; });
  await page.waitForTimeout(HOLD_MS);
  const holdWrites = await page.evaluate(() => window.__writes);
  const t0 = Date.now();
  for (let k = 0; k < 7; k++) { await page.mouse.dblclick(X, Y); await page.waitForTimeout(900); }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, 500); await page.waitForTimeout(900); }
  await page.waitForTimeout(2500);
  const wall = (Date.now() - t0) / 1000;
  const m = await page.evaluate(() => { window.__stop = true; const f = window.__frames.slice(1); return { over50: f.filter((d) => d > 50).length, worst: Math.round(Math.max(...f)), longMs: Math.round(window.__long), writes: window.__writes }; });
  results.push({ run: Math.floor(i / 2) + 1, mode, ...m, writesPerSecStill: (holdWrites / (HOLD_MS / 1000)).toFixed(1), tiles, wall_s: wall.toFixed(1) });
  console.log(JSON.stringify(results.at(-1)));
  await ctx.close();
}
for (const mode of ["map", "vector"]) {
  const r = results.filter((x) => x.mode === mode);
  const range = (k) => `${Math.min(...r.map((x) => Number(x[k])))}–${Math.max(...r.map((x) => Number(x[k])))}`;
  console.log(`${mode.padEnd(6)} frames>50ms ${range("over50")} | worst frame ms ${range("worst")} | long-task ms ${range("longMs")} | tiles ${range("tiles")} | writes/s still ${range("writesPerSecStill")} | writes in walk ${range("writes")} | wall s ${range("wall_s")}`);
}
await browser.close();
