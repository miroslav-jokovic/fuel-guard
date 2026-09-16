/**
 * Which HERE basemap a map asks our tile proxy for (D-DR8).
 *
 * ── WHY THIS IS IN `shared` AND NOT A STRING IN EACH APP ─────────────────────────────────────────
 * Two processes have to agree on the same two vendor strings: `apps/web` puts one on the tile URL and
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
 * web against new api: no parameter, so `resolveBasemapStyle(undefined)` returns the same default.
 * Both ends degrade to exactly today's behaviour, so this does NOT need to ship in two merges.
 */

/**
 * ⚠ `explore.night` is CERTAIN and satellite is not, which is why only these two are here. Both are
 * the same HERE v3 resource on the same path with one parameter changed
 * (`/v3/base/mc/{z}/{x}/{y}/png?style=…`), so a dark basemap costs nothing but this string. Satellite
 * is a different resource (`…/jpeg?style=satellite.day`) that may carry different licensing on our
 * plan, and it stays Q-DR2 until somebody checks the contract rather than the docs.
 */
export const BASEMAP_STYLES = {
  light: "explore.day",
  dark: "explore.night",
} as const;

export type BasemapScheme = keyof typeof BASEMAP_STYLES;
export type BasemapStyle = (typeof BASEMAP_STYLES)[BasemapScheme];

/** The style for a resolved colour scheme. The web side's only entry point — it never spells a style. */
export function basemapStyleFor(isDark: boolean): BasemapStyle {
  return isDark ? BASEMAP_STYLES.dark : BASEMAP_STYLES.light;
}

/**
 * Validate a style off the wire, falling back to the light basemap.
 *
 * Takes `unknown` because that is what `req.query.style` honestly is: Express hands back a string, an
 * ARRAY of strings when the parameter is repeated, or undefined, and a signature promising
 * `string | undefined` would be a lie that a `?style=a&style=b` request exposes.
 */
export function resolveBasemapStyle(raw: unknown): BasemapStyle {
  const values: readonly string[] = Object.values(BASEMAP_STYLES);
  return typeof raw === "string" && values.includes(raw) ? (raw as BasemapStyle) : BASEMAP_STYLES.light;
}
