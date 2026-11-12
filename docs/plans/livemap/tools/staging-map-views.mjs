// Staging stills of the vector trial at chosen places and zooms (D-DR36 signs, D-DR37 land colours, item 5
// road density), each with what maplibre actually RENDERED there, and every 4xx/5xx and console error.
//   EMAIL=... PW="$(security find-generic-password ...)" OUT=/some/dir \
//   VIEWS='[{"name":"joliet-z9","lng":-88.08,"lat":41.52,"zoom":9}]' BASEMAP="Map (vector trial)" \
//   node docs/plans/livemap/tools/staging-map-views.mjs        (from the repo root)
// BASEMAP defaults to the vector trial; "Map" gives today's raster map at the same spot, for comparison.
// COLOR_SCHEME=dark opens the app in the night scheme (the app follows prefers-color-scheme unless a reader
// chose one). SWITCH_TO_DARK=1 opens light and switches to dark after the views, then repeats the first view:
// that is the in-place repaint a reader gets, which opening in dark never exercises. SWITCH_VIA_MENU=1 does the
// same through the account menu's Appearance radios.
// WAIT_MS (default 7000) is how long each view settles before its still; raster needs longer at regional zoom.
// The map handle comes from patching maplibre's _setupContainer in the served chunk: a rig, never app code.
import { chromium } from "playwright-core";
const BASE = "https://staging-api.360.silvicominc.com";
const { OUT, EMAIL, PW } = process.env;
const VIEWS = JSON.parse(process.env.VIEWS);
const BASEMAP = process.env.BASEMAP ?? "Map (vector trial)";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: process.env.COLOR_SCHEME === "dark" ? "dark" : "light" })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error" || /could not be loaded|Unable to load glyph/.test(m.text())) errs.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url()}`); });
await page.route(/\/assets\/.*\.js$/, async (route) => {
  const res = await route.fetch();
  const body = (await res.text()).replace("_setupContainer(){let e=this._container;", "_setupContainer(){window.__map=this;let e=this._container;");
  await route.fulfill({ response: res, body });
});
await page.goto(`${BASE}/login`); await page.fill("#email", EMAIL); await page.fill("#password", PW);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
await page.goto(`${BASE}/?tab=dispatch`); await page.waitForSelector("canvas.maplibregl-canvas"); await page.waitForTimeout(3000);
if (BASEMAP !== "Map") { await page.click('[aria-label^="Basemap:"]'); await page.click(`button.kebab-item:has-text("${BASEMAP}")`); await page.waitForTimeout(3000); }
if (!(await page.evaluate(() => !!window.__map))) throw new Error("no map handle: maplibre's _setupContainer changed shape");
async function shoot(v, suffix = "") {
  await page.evaluate((v) => window.__map.jumpTo({ center: [v.lng, v.lat], zoom: v.zoom }), v);
  await page.waitForTimeout(Number(process.env.WAIT_MS ?? 7000));
  await page.screenshot({ path: `${OUT}/${v.name}${suffix}.png` });
  const seen = await page.evaluate(() => {
    const ids = window.__map.getStyle().layers.map((l) => l.id);
    const pick = (suffix) => ids.filter((id) => id.endsWith(suffix));
    const count = (suffix, key) => { const c = {}; for (const f of window.__map.queryRenderedFeatures({ layers: pick(suffix) })) { const k = key(f); c[k] = (c[k] ?? 0) + 1; } return c; };
    return pick(":road-number").length === 0 ? null : {
      signs: count(":road-number", (f) => `${f.properties.network ?? "-"}`),
      land: count(":landuse-detail", (f) => f.properties.kind),
    };
  });
  console.log(v.name + suffix, JSON.stringify(seen));
}
for (const v of VIEWS) await shoot(v);
if (process.env.SWITCH_TO_DARK === "1") {
  // The OS flipping to dark while the app is open (a reader following the system scheme).
  await page.emulateMedia({ colorScheme: "dark" });
  await shoot(VIEWS[0], "-switched-dark");
}
if (process.env.SWITCH_VIA_MENU === "1") {
  // A reader choosing Dark in the account menu's Appearance radios (SidebarProfileMenu.vue).
  await page.mouse.click(26, 774); // the account avatar, bottom-left of the sidebar at 1280×800
  await page.getByRole("radio", { name: /Dark/ }).click();
  await page.keyboard.press("Escape");
  await shoot(VIEWS[0], "-menu-dark");
  // Nothing to undo: the choice is in this throwaway browser profile's localStorage, not the account.
}
console.log("errors", errs.length, JSON.stringify(errs.slice(0, 8)));
await browser.close();
