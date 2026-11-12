// Staging acceptance for D-DR34 (and the glyph check): sign in as the dispatcher test member, choose the
// vector trial, jump to the Joliet Pilot at zoom 16, 13 and 12, screenshot each into $OUT, and print the truck
// names maplibre actually RENDERED, every tile request by kind@zoom, and every 4xx/5xx and console error.
// Credentials as in staging-map-compare.mjs (Keychain -> env vars). Run from the repo root:
//   EMAIL=... PW="$(security find-generic-password ...)" OUT=/some/dir node docs/plans/livemap/tools/staging-truck-places.mjs
// The map handle comes from patching maplibre's _setupContainer in the served chunk: a rig, never app code.
import { chromium } from "playwright-core";
const BASE = "https://staging-api.360.silvicominc.com";
const OUT = process.env.OUT;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url().replace(/apikey=[^&]+/, "apikey=…")}`); });
let patched = 0;
await page.route(/\/assets\/.*\.js$/, async (route) => {
  const res = await route.fetch(); let body = await res.text();
  if (body.includes('_setupContainer(){let e=this._container;')) {
    body = body.replace('_setupContainer(){let e=this._container;', '_setupContainer(){window.__map=this;let e=this._container;'); patched++;
  }
  await route.fulfill({ response: res, body });
});
const tiles = [];
page.on("request", (r) => { const m = r.url().match(/map-tiles\/(truck-places|vector)\/(\d+)\//); if (m) tiles.push(`${m[1]}@${m[2]}`); });
const status = []; page.on("response", (r) => { if (r.url().includes("/truck-places/")) status.push(r.status()); });
await page.goto(`${BASE}/login`); await page.fill("#email", process.env.EMAIL); await page.fill("#password", process.env.PW);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
await page.goto(`${BASE}/?tab=dispatch`); await page.waitForSelector("canvas.maplibregl-canvas"); await page.waitForTimeout(3000);
await page.click('[aria-label^="Basemap:"]'); await page.click('button.kebab-item:has-text("Map (vector trial)")'); await page.waitForTimeout(3000);
console.log("patched chunks", patched, "map handle", await page.evaluate(() => !!window.__map));
for (const z of [16, 13, 12]) {
  await page.evaluate((z) => window.__map.jumpTo({ center: [-88.0792, 41.4805], zoom: z }), z);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/joliet-z${z}.png` });
  const names = await page.evaluate(() => {
    const ids = window.__map.getStyle().layers.map((l) => l.id).filter((id) => id.endsWith(":truck-place"));
    return window.__map.queryRenderedFeatures({ layers: ids }).map((f) => `${f.properties.pds_category} ${f.properties.name}`);
  });
  console.log(`z${z}: ${names.length} truck places rendered:`, [...new Set(names)].join(" | "));
}
const counts = {}; for (const t of tiles) counts[t] = (counts[t] ?? 0) + 1;
console.log("tile requests by kind@zoom", counts);
console.log("truck-places statuses", [...new Set(status)].join(","), "errors", errs.length, errs.slice(0, 5));
await browser.close();
