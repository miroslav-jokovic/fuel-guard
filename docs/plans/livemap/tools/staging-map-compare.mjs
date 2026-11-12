// Sign in to staging as the dispatcher test member and run the same zoom walk on today's map and on the
// vector trial, alternating, counting tile requests and recording a video of each (D-DR31 handoff).
// Credentials come from the owner's Keychain through env vars, never the command line:
//   EMAIL=miki+staging-dispatcher@silvicominc.com \
//   PW="$(security find-generic-password -s silvicom-staging-test-member -a "$EMAIL" -w)" \
//   node docs/plans/livemap/tools/staging-map-compare.mjs     (from the repo root)
// Videos land in ./cmpvid/<mode-n>/. Pull frames with: ffmpeg -i <webm> -vf fps=4 f%03d.png
import { chromium } from "playwright-core";
const BASE = "https://staging-api.360.silvicominc.com";
const browser = await chromium.launch();
const out = [];
for (const mode of ["map", "vector", "map", "vector"]) {
  const tag = `${mode}-${out.length}`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, recordVideo: { dir: `cmpvid/${tag}`, size: { width: 1280, height: 800 } } });
  const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${BASE}/login`); await page.fill("#email", process.env.EMAIL); await page.fill("#password", process.env.PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
  await page.goto(`${BASE}/?tab=dispatch`); await page.waitForSelector("canvas.maplibregl-canvas"); await page.waitForTimeout(4000);
  if (mode === "vector") { await page.click('[aria-label^="Basemap:"]'); await page.click('button.kebab-item:has-text("Map (vector trial)")'); await page.waitForTimeout(4000); }
  const label = await page.getAttribute('[aria-label^="Basemap:"]', "aria-label");
  const reqs = []; const seen = new Map();
  page.on("request", (r) => { if (r.url().includes("/map-tiles/")) seen.set(r, Date.now()); });
  page.on("requestfinished", (r) => { const t = seen.get(r); if (t) reqs.push({ u: r.url(), ms: Date.now() - t, ok: true }); });
  page.on("requestfailed", (r) => { if (seen.has(r)) reqs.push({ u: r.url(), ok: false }); });
  const box = await page.locator("canvas.maplibregl-canvas").boundingBox();
  const X = box.x + box.width * 0.62, Y = box.y + box.height * 0.36;
  const t0 = Date.now();
  for (let i = 0; i < 7; i++) { await page.mouse.dblclick(X, Y); await page.waitForTimeout(900); }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 500); await page.waitForTimeout(900); }
  await page.waitForTimeout(2500);
  const wall = Date.now() - t0;
  const kinds = { vector: reqs.filter((r) => r.u.includes("/vector/")).length, glyphs: reqs.filter((r) => r.u.includes("/glyphs/")).length, raster: reqs.filter((r) => !/\/(vector|glyphs)\//.test(r.u)).length };
  const ok = reqs.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
  out.push({ mode, label, requests: reqs.length, ...kinds, cancelled: reqs.filter((r) => !r.ok).length, p50ms: ok[Math.floor(ok.length / 2)], wall_s: (wall / 1000).toFixed(1), pageErrors: errs.length });
  await page.screenshot({ path: `stg-${tag}.png` });
  await ctx.close();
}
console.table(out); await browser.close();
