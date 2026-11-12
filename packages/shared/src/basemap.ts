/**
 * Which HERE basemap a map asks our tile proxy for (D-DR8, extended by D-DR20).
 *
 * ── WHY THIS IS IN `shared` AND NOT A STRING IN EACH APP ─────────────────────────────────────────
 * Two processes have to agree on the same vendor strings: `apps/web` puts one on the tile URL and
 * `apps/api`'s proxy decides whether to honour it. Written down twice, a typo on either side is a map
 * that silently serves the wrong basemap — the API falls back rather than erroring (see below), so a
 * misspelt style on the web side produces a LIGHT map in dark mode and no error anywhere. That is the
 * exact failure this repo's "deriving beats restating" rule exists to prevent, so the allowlist and
 * the caller of it are the same list.
 *
 * ── WHY THE PROXY FALLS BACK RATHER THAN REJECTING ───────────────────────────────────────────────
 * `mapProxies.ts` answers `400 bad_request` on an invalid tile COORDINATE, and this deliberately does
 * not follow it. A coordinate arrives from maplibre and a bad one means one broken tile; the style
 * arrives from our own code and a rejected one means EVERY tile in the viewport fails at once — a
 * whole grey grid where a map should be. A basemap in the wrong scheme is a cosmetic defect; a
 * viewport of failed tiles reads as an outage. So the strictness that is right for coordinates is
 * wrong here, and the type above is what stops the fallback from hiding a mistake instead.
 *
 * ── THE DEPLOY WINDOW IS SAFE IN BOTH DIRECTIONS, WHICH IS WORTH STATING ─────────────────────────
 * `docs/MIGRATION-DISCIPLINE.md`'s two-merge rule is about a COLUMN and its first reader, and the
 * reflex it teaches is worth applying to an API change too — but the answer here is that neither
 * order breaks. New web against old api: the old proxy has no `style` handling at all, ignores an
 * unknown query parameter and serves `explore.day` — the map is light until the api catches up. Old
 * web against new api: no parameter, so `resolveBasemap(undefined)` returns the same default.
 * Both ends degrade to exactly today's behaviour, so this does NOT need to ship in two merges.
 */

/**
 * ── Q-DR2 IS ANSWERED, BY MEASUREMENT RATHER THAN BY READING THE DOCS (2026-09-16) ───────────────
 * The plan carried satellite as an open question for a fortnight — "a different resource that may
 * carry different licensing on our plan". Every candidate was requested with the production key and
 * the answer read off the status line:
 *
 *   explore.day · explore.night · lite.day · lite.night · topo.day  → 200
 *   satellite.day                                                   → 200
 *   hybrid.day (satellite WITH labels)                              → 400, "not currently supported"
 *
 * So satellite and terrain are both ours; the one comp (7) draws that we cannot have is a labelled
 * hybrid. The tiles were opened and looked at, not just counted: `satellite.day` is real imagery and
 * `topo.day` is the terrain style.
 *
 * ⚠ **FORMAT IS A SECOND DIMENSION, AND MISSING IT WOULD HAVE COST 12× THE BYTES.** The proxy used to
 * hardcode `/png` in the path. Measured on the same tile: `satellite.day` is **41 KB as jpeg and
 * 488 KB as png** — a photograph does not belong in a lossless format. So a basemap is a STYLE AND A
 * FORMAT together, which is why this is a table of objects rather than a table of strings.
 */
/**
 * ── D-DR22: EVERY BASEMAP IS JPEG, INCLUDING THE ROAD STYLES (2026-09-16) ────────────────────────
 * D-DR20 took the format win on satellite alone, on the reasoning that "a photograph does not belong
 * in a lossless format". That reasoning was too narrow: HERE renders these road tiles as photographs
 * too — anti-aliased type over gradient fills at 512px — and png pays full price for it. Measured
 * with the production key on five tiles spanning a dense city (Chicago z13), a metro (Dallas z11), an
 * interstate (Iowa z9), the national view (z5) and open country (Texas z14):
 *
 *   explore.day    286 KB png → 47 KB jpeg   ·  269 KB → 29 KB (z5)  ·  57 KB → 8.6 KB (z14)
 *   explore.night  286 KB png → 41 KB jpeg   ·  278 KB → 26 KB (z5)
 *   topo.day       278 KB png → 38 KB jpeg   ·  288 KB → 25 KB (z5)
 *
 * That is **84–91% of the bytes, on every style at every zoom**, and a 12-tile viewport therefore
 * pulls ~0.4 MB where it pulled ~3.2 MB. HERE itself was never slow (150–210 ms round trip,
 * 100–170 ms TTFB): the payload was.
 *
 * ⚠ **THE TRADE WAS LOOKED AT, NOT TAKEN ON TRUST, because jpeg is lossy exactly where these tiles
 * carry road labels.** Both renders of the same tile were opened side by side at 1:1 in day and night
 * and are indistinguishable; the damage is real but sub-threshold, and it was measured where it
 * lands rather than as one average:
 *
 *   - **Label legibility does not move.** Contrast ratio over six label runs (3rd vs 97th percentile
 *     luminance): `Chicago Union Station` 3.44:1 png / 3.48:1 jpeg, `W Harrison St` 3.21 / 3.39, the
 *     same runs at night 6.89 / 6.97 and 8.08 / 7.94. Every pair is within ±0.2 — noise, and in both
 *     directions, so it is not a loss being rounded away.
 *   - **Where the loss IS: flat colour fields.** Neighbour-to-neighbour luminance noise in the map's
 *     uniform areas rises from 0.12 (png, i.e. genuinely flat) to 2.47 of 255 — ~1%, jpeg's block
 *     mottle. On high-contrast edges the mean luminance shift is 9.1 of 255 with a p95 of 25.
 *
 * A mean over the whole tile (8.33) would have reported this as worse than it is, which is the
 * D-DR19 lesson arriving again: quote the percentile over the zone the eye picks out.
 *
 * ⚠ This lands BEFORE the theme-switch caching step deliberately. That step's candidate fix is to
 * hold both schemes' raster sources in memory at once, and holding two sets of tiles is cheap at
 * 33 KB each and not at 260 KB. The order is the reason it is affordable.
 */
export const BASEMAPS = {
  /** The default road map. The only basemap with a night variant, so the only one the scheme moves. */
  map: { style: "explore.day", format: "jpeg" },
  mapNight: { style: "explore.night", format: "jpeg" },
  satellite: { style: "satellite.day", format: "jpeg" },
  terrain: { style: "topo.day", format: "jpeg" },
} as const;

export type BasemapKey = keyof typeof BASEMAPS;
export type Basemap = (typeof BASEMAPS)[BasemapKey];
export type BasemapStyle = Basemap["style"];

/**
 * The formats the PROXY will put in a HERE URL, which is deliberately not `Basemap["format"]`.
 *
 * ⚠ D-DR22 made every basemap jpeg and the compiler immediately rejected `resolveBasemapFormat`'s
 * `png` fallback — which was the derived type telling the truth about a conflation rather than an
 * inconvenience. Two different sets were sharing one name: what OUR basemaps ask for (now jpeg, all
 * four) and what the proxy will HONOUR off the wire (still both, because an older web bundle mid
 * deploy window and `RouteMapGL` send no format at all and must keep getting a tile). Deriving the
 * wire allowlist from the table would have silently switched every no-format caller to jpeg the
 * moment the table moved — a cross-surface behaviour change hidden inside a fallback.
 */
export type BasemapFormat = "png" | "jpeg";

/**
 * What a reader may CHOOSE, which is not the same list as what exists.
 *
 * `mapNight` is absent on purpose: it is not a third choice beside satellite and terrain, it is what
 * `map` becomes in dark mode. Offering it would put the colour scheme on screen twice and let the two
 * disagree — the same reasoning D-DR8 used to refuse a Day/Night toggle outright.
 */
export const BASEMAP_CHOICES = [
  { key: "map" as const, label: "Map" },
  { key: "satellite" as const, label: "Satellite" },
  { key: "terrain" as const, label: "Terrain" },
];

export type BasemapChoice = (typeof BASEMAP_CHOICES)[number]["key"];

/**
 * The basemap for a chosen layer and the reader's resolved scheme.
 *
 * ⚠ Only `map` has a night variant, and that asymmetry is a vendor fact rather than an omission:
 * HERE publishes `explore.night` but no `satellite.night` or `topo.night`. A reader on satellite in
 * dark mode therefore gets daylight imagery, which is correct — a satellite photograph of the earth
 * at night is not a basemap, it is a picture of city lights.
 */
export function basemapFor(choice: BasemapChoice, isDark: boolean): Basemap {
  if (choice === "satellite") return BASEMAPS.satellite;
  if (choice === "terrain") return BASEMAPS.terrain;
  return isDark ? BASEMAPS.mapNight : BASEMAPS.map;
}

const STYLES: readonly string[] = Object.values(BASEMAPS).map((b) => b.style);
const FORMATS: readonly string[] = ["png", "jpeg"];

/**
 * Validate a style off the wire, falling back to the light road map.
 *
 * Takes `unknown` because that is what `req.query.style` honestly is: Express hands back a string, an
 * ARRAY of strings when the parameter is repeated, or undefined, and a signature promising
 * `string | undefined` would be a lie that a `?style=a&style=b` request exposes.
 */
export function resolveBasemapStyle(raw: unknown): BasemapStyle {
  return typeof raw === "string" && STYLES.includes(raw)
    ? (raw as BasemapStyle)
    : BASEMAPS.map.style;
}

/**
 * Validate a format off the wire, falling back to `png`.
 *
 * ⚠ Separate from the style rather than derived from it, even though today every style has exactly
 * one sensible format. Deriving would mean the PROXY owning the opinion "satellite implies jpeg",
 * and the proxy is the wrong place for it: the client already knows which basemap it asked for, and
 * a server that second-guesses the format would have to be edited every time the vendor adds a style.
 * The allowlist here is what keeps the freedom from becoming an open redirect of formats.
 *
 * ⚠ The fallback stays `png` after D-DR22 made every basemap jpeg, so it is now reached by exactly
 * two callers and both want it: a request from the deploy window's older web bundle, which has no
 * `format` on the URL, and `RouteMapGL` (Fuel Planning), which does not use `basemapFor` at all.
 * png is the format every HERE style answers, so the fallback keeps being the one that cannot be
 * wrong — it is the fat one, and giving the route preview the win is its own step (§7, still open).
 */
export function resolveBasemapFormat(raw: unknown): BasemapFormat {
  return typeof raw === "string" && FORMATS.includes(raw) ? (raw as BasemapFormat) : "png";
}

/**
 * ── D-DR26: EVERY TILE IS A 512-PIXEL, PPI-200 TILE LAID OVER 256 CSS PIXELS (2026-11-09) ────────
 * The owner, on the live map: "the map is a little blurry" and "when I zoom in I don't see place
 * names — I can't tell whether a truck is at a truck stop". Both were one setting.
 *
 * **The blur.** Every map asked HERE for a 512-pixel tile and laid it over 512 CSS pixels. A Retina
 * screen has two device pixels per CSS pixel, so the browser stretched every tile 2× — soft roads and
 * smudged labels at every zoom. Satellite hid it because a photograph forgives a stretch; type does not.
 *
 * **The place names.** HERE prints a business name only from tile zoom 17. Requested over the Pilot
 * Travel Center in Joliet with the production key: zoom 16 draws two blue "P" pins with no words,
 * zoom 17 names them. With 512-pixel tiles maplibre asks for tile zoom = round(map zoom), so a
 * dispatcher had to reach map zoom 16.5 — street level — before any name appeared.
 *
 * **The fix.** Lay each tile over 256 CSS pixels (`TILE_CSS_PX`): maplibre then asks for tile zoom
 * round(map zoom + 1) — `coveringZoomLevel` in the installed 5.24.0 bundle,
 * `transform.zoom + scaleZoom(512 / tileSize)`. And keep asking for a 512-pixel tile, at `ppi=200`,
 * so the tile carries two pixels per CSS pixel and HERE draws its type at twice the pixel size — the
 * same apparent size on screen as before, now at the zoom that names the place.
 *
 * ⚠ **IT IS ONE REQUEST FOR EVERY SCREEN, AND THAT WAS MEASURED, NOT ASSUMED.** The first build sent a
 * standard screen (devicePixelRatio 1) a 256-pixel tile at ppi 100 — one tile pixel per screen pixel,
 * which sounds like the sharp choice. In the real app over Joliet at map zoom 16 it drew the same two
 * BARE "P" pins as before: HERE decides whether a name fits by the tile's ground resolution per
 * pixel, and a 256 tile at zoom 17 has exactly the resolution of a 512 tile at zoom 16. Only the
 * ppi-200 tile names the Pilot. Shown on a standard screen the 512 tile is shrunk 2×, and that is
 * clean: maplibre binds raster textures `LINEAR_MIPMAP_NEAREST` and generates their mipmaps (the
 * installed bundle), and the screenshot at devicePixelRatio 1 is crisp and names it. So there is no
 * screen-density branch at all, and a standard office monitor gets the place names too.
 *
 * ⚠ **THE COST IS THE TILE COUNT, AND IT IS STATED RATHER THAN HIDDEN — ABOUT 2×, MEASURED.** In the
 * real app on a 1512×900 map, opening on one truck over Joliet and pressing "Zoom in" from 9 to 21,
 * the same walk on the code before and after: **125 → 262 tile requests at devicePixelRatio 2, 135 →
 * 268 at 1.** Not the 4× the tile area suggests: a deeper tile zoom covers less ground, and the 10
 * refused zoom-21 requests are gone (`HERE_MAX_TILE_ZOOM`). Each tile measured 14–15 KB as jpeg over
 * Joliet (12–13 KB before). HERE's per-tile price was NOT read from HERE: third-party 2026 write-ups
 * put raster tiles at 30,000 free a month then ~$0.09 per 1,000, billed per request, and this fleet's
 * monthly tile count was never measured (Q-LM21 — HERE's own console can).
 *
 * ⚠ `ppi` is pinned because HERE refuses most values with `400 E62…` — measured: 100, 200 and 400
 * answer 200; 150, 250, 300 and 500 answer 400. A wrong value would fail every tile in view at once,
 * the same outage `resolveBasemapStyle` falls back to avoid.
 */
export const TILE_REQUEST = { size: 512, ppi: 200 } as const;

/** The CSS-pixel size every map lays a tile over (D-DR26). */
export const TILE_CSS_PX = 256;

/**
 * The deepest tile HERE serves. Measured on all four basemaps with the production key: zoom 20
 * answers 200, zoom 21 answers 400 "The zoom level is not within the supported ranges".
 *
 * ⚠ The map has to be TOLD this. maplibre's raster source defaults to `maxzoom: 22` and asks for
 * zoom 21 tiles nobody serves. Measured in the app on the code before D-DR26: 10 zoom-21 requests at
 * the deepest zoom, each refused by the proxy's coordinate check (which reads this constant). maplibre
 * falls back to the zoom-20 tile, so the picture was right and the requests were waste — and over
 * 256 CSS pixels they would start a whole map zoom earlier. The web source's `maxzoom` reads this too.
 */
export const HERE_MAX_TILE_ZOOM = 20;

/**
 * Validate a tile size and ppi off the wire: `TILE_REQUEST`, or the request from before D-DR26.
 *
 * ⚠ The two are checked as ONE pair. `size=256&ppi=200` would put twice-size type on a half-size tile.
 *
 * ⚠ Anything else gets a 512 tile at ppi 100, and that is deliberate: it is exactly the request this
 * proxy sent before D-DR26 (HERE documents its default ppi as 100, and the same Joliet tile came back
 * at the same 13 KB with `ppi=100` and with no ppi at all). A browser still running an older bundle
 * sends neither parameter and lays the tile over 512 CSS pixels, so it must keep receiving the tile
 * it was built for; handing it `TILE_REQUEST` would halve every label in it until it reloaded.
 */
export function resolveTileRequest(rawSize: unknown, rawPpi: unknown): { size: number; ppi: number } {
  return rawSize === String(TILE_REQUEST.size) && rawPpi === String(TILE_REQUEST.ppi)
    ? { size: TILE_REQUEST.size, ppi: TILE_REQUEST.ppi }
    : { size: 512, ppi: 100 };
}

/**
 * The deepest VECTOR tile HERE serves (D-DR31). Measured with the production key on 2026-11-09: zooms
 * 12–17 answer 200 and 18 answers 400. maplibre overzooms the zoom-17 tile beyond that, so the web
 * source's `maxzoom` and the proxy's coordinate check both read this.
 */
export const HERE_MAX_VECTOR_ZOOM = 17;

/**
 * The ONE zoom at which the vector road map fetches its truck places (D-DR34): HERE's
 * `content=default,advanced_pois` tile. The web source's `minzoom`/`maxzoom` and the proxy's
 * coordinate check both read this, so the dearer tile cannot be asked for at any other zoom.
 *
 * ── WHY 13, MEASURED 2026-11-11 WITH OUR KEY ────────────────────────────────────────────────────
 * HERE's default vector tiles carry NO truck categories: in them the Joliet Pilot (41.4805, −88.0792)
 * is an ordinary "Parking Lot" (800-8500-0178, `min_zoom` 17). The same tile with `advanced_pois`
 * adds it as a truck stop (700-7900-0132) and truck parking (700-7900-0131), both `min_zoom` 13.
 * Across 24 zoom-13 tiles around Joliet, Indianapolis and Dallas the advanced tiles carried 17 truck
 * stops, 19 truck parking lots and 4 rest areas, all at `min_zoom` 13 or 14.
 * Advanced tiles bill at $0.239 per 1 000 against $0.088, so they are fetched at 13 alone and
 * maplibre overzooms that one tile for every closer zoom: one dearer request per zoom-13 square
 * (≈ 4.9 × 3.6 km at Chicago's latitude), not one per tile at every zoom.
 */
export const TRUCK_PLACES_ZOOM = 13;

/**
 * The two fonts the vector road map draws labels with (D-DR31), by the name maplibre puts in the
 * glyph URL. Each name is a directory of glyph files under `apps/web/public/fonts/glyphs/`, built
 * from FiraGO's TTFs (D-DR40, the design plan §7 2026-11-12 says how), so the style and the files
 * on disk read this one list and a test checks the directories exist.
 *
 * ⚠ Until 2026-11-12 these were HERE's names ("Fira GO Regular") and an API route relayed HERE's
 * keyless font host. FiraGO is the same font under the SIL Open Font License 1.1 (the licence file
 * sits beside the glyph files, as it requires); serving our own build ends the relay, the missing
 * caching header (Q-DR33) and the unread terms question in one move. The names changed with it
 * because a directory with spaces in a URL is a path nobody should have to escape.
 */
export const VECTOR_GLYPH_FONTS = ["FiraGO-Regular", "FiraGO-Bold"] as const;

/**
 * The ONE shape of a glyph range file (D-DR31): `0-255.pbf`. The web style's glyph URL must fill
 * `{range}` into a name that matches this, which is how the files on disk are named; maplibre asks
 * for 256 codepoints at a time and every one of the 256 ranges exists for both fonts, an empty one
 * being 31 bytes, so no label fetch can 404 and trip the style's `error` event.
 *
 * ⚠ Until 2026-11-11 the style asked for `{range}` with no `.pbf`, the relay of the day refused
 * every range with a 400, and maplibre fell back to drawing every label with the browser's own font
 * (its "Rendering codepoint … locally instead" path), so the font was never on screen and every
 * label was drawn on the reader's CPU. Nothing failed visibly, which is why one definition is kept.
 */
export const VECTOR_GLYPH_RANGE_FILE = /^\d{1,5}-\d{1,5}\.pbf$/;
