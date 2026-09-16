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
