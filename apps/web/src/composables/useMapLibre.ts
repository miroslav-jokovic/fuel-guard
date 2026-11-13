/**
 * One MapLibre map, set up the way this product needs it (LIVE-MAP-PLAN.md LM7).
 *
 * ── WHY THIS IS A COMPOSABLE AND NOT A SECOND COPY IN THE LIVE MAP ──────────────────────────────
 * Four pieces of this were about to be needed twice: the oklch→sRGB token conversion, the Bearer
 * token on every tile request, the style that points at our authenticated tile proxy, and the
 * teardown that has to unsubscribe as well as dispose the map. Copying them into `LiveMapPanel.vue`
 * would have been four copies of four separate bugs — and this repo's register for that is "a copy is
 * a workaround with a delay fuse".
 *
 * ⚠ IT IS EXTRACTED BEFORE THE SECOND CALLER EXISTS, ON PURPOSE. LM7 runs before LM8 so the
 * extraction is proven against a surface that already works (Fuel Planning) rather than validated by
 * the thing that is about to copy it. If this had been written while building the live map, "it
 * renders" would have been the only evidence either surface was right.
 *
 * ── BEHAVIOUR IS UNCHANGED FROM `RouteMapGL.vue` ─────────────────────────────────────────────────
 * This is a refactor. Every line below was moved, not rewritten — including the awkward bit that
 * matters: `onMounted` is async and resolves the access token BEFORE constructing the map, because
 * maplibre issues its first tile request during construction and a map built without a token gets a
 * screen of 401s. Do not "tidy" that into a non-blocking fetch.
 */
import { onBeforeUnmount, onMounted, shallowRef, toValue, watch, type Ref } from "vue";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { HERE_MAX_TILE_ZOOM, HERE_MAX_VECTOR_ZOOM, TILE_CSS_PX, TRUCK_PLACES_ZOOM, TILE_REQUEST } from "@silvicom/shared";
import { GLYPHS_PATH, MAP_PALETTE_KEYS, TRUCK_PLACES_TILES_TEMPLATE, isVectorTemplate, truckPlacesSourceId, vectorBasemapLayers, type MapPalette } from "./vectorBasemap";
import { installMapIcons, rasteriseMapIcons } from "./mapIcons";
import { rasteriseShields } from "./mapShields";
import { supabase } from "@/lib/supabase";

/**
 * Convert a computed CSS colour into something maplibre's style parser accepts.
 *
 * The design tokens are authored in `oklch()`, which that parser rejects outright. `getComputedStyle`
 * returns either `rgb()`/`rgba()` (older engines) or `oklch()` verbatim (Chromium/Edge ≥ ~120), so the
 * conversion has to happen here and DETERMINISTICALLY in JS. An earlier canvas round-trip left oklch
 * untouched on some engines — Edge among them — which is exactly why maplibre threw
 * `color expected, 'oklch(…)'` and the route line silently failed to draw for those users.
 *
 * Exported separately from the composable because it is PURE: it takes a string and returns a string,
 * touches no DOM and no map, and is therefore the one piece of this file a unit test can hold still.
 */
export function toMapColor(color: string): string {
  const s = color.trim();
  const m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)/i.exec(s);
  if (!m) return s || "rgb(37, 99, 235)"; // already rgb()/rgba()/hex (maplibre-safe); literal only guards empty
  const L = m[1]!.endsWith("%") ? parseFloat(m[1]!) / 100 : parseFloat(m[1]!);
  const C = m[2]!.endsWith("%") ? (parseFloat(m[2]!) / 100) * 0.4 : parseFloat(m[2]!); // 100% chroma = 0.4 (CSS)
  const h = (parseFloat(m[3]!) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  // OKLab → LMS (cubed) → linear sRGB (Björn Ottosson's matrices) → gamma-encoded sRGB byte.
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m2 = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s2 = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m2 + 0.2309699292 * s2,
    -1.2684380046 * l + 2.6097574011 * m2 - 0.3413193965 * s2,
    -0.0041960863 * l - 0.7034186147 * m2 + 1.707614701 * s2,
  ];
  const toByte = (u: number) => {
    const v = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  };
  return `rgb(${toByte(lin[0]!)}, ${toByte(lin[1]!)}, ${toByte(lin[2]!)})`;
}

/**
 * Resolve a semantic token class to a concrete colour at runtime — no hex literals in source.
 *
 * Renders a hidden element carrying the class, reads its computed colour, and normalises it. That
 * indirection is what keeps `lint:tokens-parity` and `lint:token-gamut` satisfiable: a map layer needs
 * a literal colour string and the design system refuses to have one written down anywhere but
 * `tokens.css`.
 */
/**
 * Resolve a CSS custom property (a `--map-*` token) to a concrete colour, in the scheme now on screen.
 *
 * Same indirection as `tokenColor`, for tokens that have no utility class: the vector basemap's
 * palette (D-DR31) is internal to the map, so its roles are not exposed to Tailwind. The token's
 * `light-dark()` resolves against the document's scheme, so reading it again after a theme switch
 * gives the other half.
 */
export function cssVarColor(name: string): string {
  const el = document.createElement("span");
  el.style.color = `var(${name})`;
  el.style.display = "none";
  document.body.appendChild(el);
  const raw = window.getComputedStyle(el).color;
  el.remove();
  return toMapColor(raw);
}

/** The vector basemap's palette, read from the `--map-*` tokens. */
export function mapPalette(): MapPalette {
  return Object.fromEntries(MAP_PALETTE_KEYS.map((k) => [k, cssVarColor(`--map-${k}`)])) as MapPalette;
}

export function tokenColor(cls: string): string {
  const el = document.createElement("span");
  el.className = cls;
  el.style.display = "none";
  document.body.appendChild(el);
  const raw = window.getComputedStyle(el).color;
  el.remove();
  return toMapColor(raw);
}

export interface UseMapLibreOptions {
  /** The element the map mounts into. Read on `onMounted`; nothing happens if it is still null. */
  container: Ref<HTMLElement | null>;
  /**
   * Raster tile template, served by our own authenticated proxy.
   *
   * ⚠ A `Ref` here means "this map can change basemap without being rebuilt" (D-DR8). Passing a plain
   * string is still the common case and behaves exactly as before — `RouteMapGL` does, because a
   * route preview has one basemap. The live map passes a ref so the tiles can follow the reader's
   * colour scheme, and the alternative was tearing the map down and constructing a new one on every
   * toggle, which would throw away the dispatcher's pan and zoom to change a colour.
   */
  tiles: string | Ref<string>;
  /**
   * The path fragment marking a request that needs our Bearer token. maplibre fetches tiles from a
   * worker with no auth header of its own, so `transformRequest` is the only place to attach one —
   * and it is matched on a fragment rather than applied to every request, because sending the
   * carrier's JWT to a third-party attribution or sprite URL would be a credential leak.
   */
  authPathFragment: string;
  attribution: string;
  /**
   * Add maplibre's own zoom control. Defaults to true; see the `addControl` call for why a caller
   * would ever say no.
   */
  navControl?: boolean;
  /**
   * The reader's colour scheme. Only the vector road map needs it: its colours are tokens, so a
   * scheme switch repaints it, where a raster basemap changes by changing its tile URL instead.
   */
  isDark?: Ref<boolean>;
  /** Run once the style has loaded, with the live map. Sources and layers are added here. */
  onLoad?: (map: maplibregl.Map) => void;
  /**
   * Run on unmount, BEFORE the map is disposed. Anything a caller attached to the map and owns
   * itself — markers, above all — is cleaned up here.
   *
   * ⚠ It exists so the ORDER is stated rather than inherited. Vue runs `onBeforeUnmount` hooks in
   * registration order, so a caller that registered its own teardown after calling this composable
   * would find the map already gone when it ran, and `Marker.remove()` would be reaching into a
   * disposed map. That is the kind of coupling that works until somebody moves a line, so the hook
   * is explicit instead.
   */
  onBeforeTeardown?: (map: maplibregl.Map | null) => void;
}

/**
 * The FIRST raster source/layer this composable owns; later basemaps get `here-1`, `here-2`, …
 *
 * Private, and see the `watch` at the end for why there is more than one of them now (D-DR23).
 */
const TILE_SOURCE = "here";

/**
 * A caller's tile template with the tile request appended (D-DR26, `@silvicom/shared` basemap.ts).
 *
 * ⚠ It is appended HERE and not by the callers, because `size=512&ppi=200` and the `tileSize` below
 * are two halves of one decision: that tile is right only because the source lays it over
 * `TILE_CSS_PX`. A caller writing `size=` into its own URL could change one half without the other —
 * the live map and Fuel Planning would each be a copy of the rule. Pure, so a test can hold it still.
 */
export function withTileRequest(template: string): string {
  // A vector tile has no pixel size or density; the request is the tile and nothing else.
  if (isVectorTemplate(template)) return template;
  return `${template}${template.includes("?") ? "&" : "?"}size=${TILE_REQUEST.size}&ppi=${TILE_REQUEST.ppi}`;
}

/**
 * ── D-DR28: 32 PARALLEL TILE REQUESTS, AND THE FADE STAYS (2026-11-10, corrected by D-DR32) ─────────
 * The owner, the morning after D-DR26: "the map is slowed down when zooming in and out and tiles are
 * loading slow". D-DR26 is the cause and is NOT reverted — a Retina-sharp raster map has to lay a 2×
 * tile over 256 CSS pixels, so the tile count it brought (154 → 410 on one zoom walk, 2.7×) is the
 * price of the sharp map that names the Pilot.
 *
 * **The parallel cap is raised.** maplibre caps image requests at 16 (`MAX_PARALLEL_IMAGE_REQUESTS`,
 * 5.24.0), a number from the HTTP/1.1 era of six sockets per host. Production serves `/api` over
 * HTTP/2 (checked: `curl` reports `2` on the tile route), where 32 requests are one connection. In a
 * rig timing "zoom finished → map idle" over 18 one-level zooms, 32 alone moved the p50 from
 * 1.35–1.65 s to 1.22–1.31 s. It is a global setter, so it is set once per map construction.
 * ⚠ While the camera MOVES maplibre still throttles to 8 per frame
 * (`MAX_PARALLEL_IMAGE_REQUESTS_PER_FRAME`); that one has no public setter and is left alone.
 *
 * ⚠⚠ **THE FADE WAS TURNED OFF FOR A DAY, AND THAT WAS A MEASUREMENT MISTAKE (D-DR32).** D-DR28
 * first shipped `raster-fade-duration: 0`, reporting that zooms settled in 0.69–0.98 s instead of
 * 1.35–1.65 s. Most of that gain was the metric, not the map: maplibre's `idle` waits for running
 * fades to end, so a 300 ms fade adds ~300 ms to "zoom finished → idle" even when every tile arrived
 * at the same moment. The reader got almost nothing faster and lost the cross-fade. The owner saw
 * the cost the same afternoon: "tiles are loaded in a weird way and look really bad and not
 * natural". A video of the staging map shows why. A raster tile carries its labels baked in, so
 * with no fade each square SNAPS from the previous zoom's large, edge-clipped labels ("Hebrc",
 * "Woodsto", "Ri" beside "Ringwood") to the new small ones on its own, and the seams show as a
 * patchwork. maplibre's default 300 ms cross-fade blends each square in instead.
 *
 * So the fade is maplibre's own default, written out so the next person tuning speed sees why it is
 * there before turning it off again. The patchwork itself belongs to raster tiles. Only a vector
 * basemap, where maplibre draws the labels and places them across tiles, removes it (D-DR31, proposed).
 */
const RASTER_FADE_MS = 300;
const MAX_PARALLEL_TILE_REQUESTS = 32;

export function useMapLibre(options: UseMapLibreOptions): {
  map: Ref<maplibregl.Map | null>;
} {
  // `shallowRef`, not `ref`: a maplibre Map is a large mutable object with its own internal state, and
  // making it deeply reactive would have Vue walk and proxy the whole thing on every access.
  const map = shallowRef<maplibregl.Map | null>(null);
  let accessToken: string | null = null;
  let authSub: { unsubscribe(): void } | null = null;
  /**
   * Every basemap this map has shown, by its tile URL — the cache D-DR23 is about.
   *
   * At most five entries (three raster choices, the night variant of one, and the vector road map),
   * each added the first time the reader asks for it and kept for the life of the map. A raster
   * basemap is one layer; the vector one is a group of layers on one source, shown and hidden as one.
   */
  const basemaps = new Map<string, { source: string; layers: string[] }>();
  const tileUrl = () => withTileRequest(toValue(options.tiles));
  /**
   * Both raster definitions in this file are built here so they cannot disagree.
   *
   * ⚠ `maxzoom` is HERE's deepest tile. maplibre defaults a raster source to 22 and asks for zoom 21
   * tiles nobody serves — measured in the app on the code before D-DR26: 10 zoom-21 requests at the
   * deepest zoom, each refused by the proxy's coordinate check. maplibre then falls back to the
   * zoom-20 tile, so the picture was right and the requests were waste. With `maxzoom` it overzooms
   * the zoom-20 tile without asking (measured after: deepest tile requested is 20).
   */
  const rasterSource = (tiles: string) => ({
    type: "raster" as const,
    tiles: [tiles],
    tileSize: TILE_CSS_PX,
    maxzoom: HERE_MAX_TILE_ZOOM,
  });

  /**
   * The vector road map's source (D-DR31). Its template is made absolute by joining, NOT with
   * `new URL()`: that percent-encodes `{z}/{x}/{y}` into `%7Bz%7D`, which maplibre no longer
   * recognises as a placeholder, so every tile would be requested with the braces in it. Caught by
   * "adds one vector source and its layers under the trucks, then hides the raster once it has loaded".
   */
  const absolute = (tiles: string) => (tiles.startsWith("/") ? `${window.location.origin}${tiles}` : tiles);
  const vectorSource = (tiles: string) => ({
    type: "vector" as const,
    tiles: [absolute(tiles)],
    maxzoom: HERE_MAX_VECTOR_ZOOM,
    attribution: options.attribution,
  });
  /**
   * D-DR34: every vector basemap brings its truck-places source, keyed off its own source id. Both
   * zoom bounds are `TRUCK_PLACES_ZOOM`, so maplibre asks for the advanced tile at that zoom alone and
   * overzooms it beyond; the proxy refuses every other zoom, so the two cannot drift apart unseen.
   */
  const vectorSources = (tiles: string, id: string) => ({
    [id]: vectorSource(tiles),
    [truckPlacesSourceId(id)]: {
      type: "vector" as const,
      tiles: [absolute(TRUCK_PLACES_TILES_TEMPLATE)],
      minzoom: TRUCK_PLACES_ZOOM,
      maxzoom: TRUCK_PLACES_ZOOM,
      attribution: options.attribution,
    },
  });

  /** Both raster LAYERS are built here too, for the same reason as `rasterSource` (D-DR28). */
  const rasterLayer = (id: string, layout?: { visibility: "none" }) => ({
    id,
    type: "raster" as const,
    source: id,
    paint: { "raster-fade-duration": RASTER_FADE_MS },
    ...(layout ? { layout } : {}),
  });

  function attachAuth(url: string): maplibregl.RequestParameters {
    if (accessToken && url.includes(options.authPathFragment)) {
      return { url, headers: { Authorization: `Bearer ${accessToken}` } };
    }
    return { url };
  }

  onMounted(async () => {
    if (!options.container.value) return;
    // ⚠ Awaited BEFORE the map is constructed — see the file header.
    // D-DR35: the place icons are drawn while the session is read, so the map is built with them.
    const [{ data: sess }, icons] = await Promise.all([supabase.auth.getSession(), iconsInScheme()]);
    accessToken = sess.session?.access_token ?? null;
    authSub = supabase.auth.onAuthStateChange((_e, session) => {
      // Kept fresh on refresh: a map left open longer than the token's life would start 401ing tiles
      // partway through a session, which looks like a broken map rather than an expired login.
      accessToken = session?.access_token ?? null;
    }).data.subscription;

    maplibregl.setMaxParallelImageRequests(MAX_PARALLEL_TILE_REQUESTS);
    // A map can open on either kind of basemap; the first one is declared in the style either way.
    const first = tileUrl();
    const firstLayers = isVectorTemplate(first)
      ? vectorBasemapLayers(mapPalette(), TILE_SOURCE, `${TILE_SOURCE}:`)
      : [rasterLayer(TILE_SOURCE)];
    const instance = new maplibregl.Map({
      container: options.container.value,
      transformRequest: attachAuth,
      style: {
        version: 8,
        sources: isVectorTemplate(first)
          ? vectorSources(first, TILE_SOURCE)
          : { [TILE_SOURCE]: { ...rasterSource(first), attribution: options.attribution } },
        layers: firstLayers as maplibregl.LayerSpecification[],
        // D-DR31: maplibre draws no text without glyphs. Declared up front because a style's glyph
        // URL cannot be added later, and the vector road map needs it the moment it is chosen.
        glyphs: `${window.location.origin}${GLYPHS_PATH}`,
      },
      attributionControl: { compact: true },
      dragRotate: false,
    });
    // The style above declares the first basemap, so it is registered here rather than added again —
    // otherwise the first switch would build a second layer for a basemap already on screen, and
    // every id would be off by one.
    basemaps.set(first, { source: TILE_SOURCE, layers: firstLayers.map((l) => l.id) });
    /**
     * ⚠ `navControl: false` exists because maplibre only knows FOUR corners, and on the live map all
     * four are taken (D-DR21). Measured 2026-09-16: the built-in control lands at 1458,92 (39×68)
     * and DR5's Filters panel at 1197,104 (288×142), so the panel sat ON the zoom buttons by
     * **27×56px — at 1512, 1280, 1024 and 768 alike**, because both are pinned to the right edge
     * with fixed insets. It is a constant defect, not a breakpoint one.
     *
     * ⚠⚠ And the overlap check that shipped with DR5 could not see it: it compared our floating
     * panels to EACH OTHER and never to maplibre's own DOM. A control this composable adds is still
     * something on the screen — an owner spotted it before any of our measurements did.
     *
     * A caller that turns this off takes on drawing its own zoom affordance. `RouteMapGL` does not
     * and is unchanged.
     */
    if (options.navControl !== false) {
      instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    }
    repaintIcons = installMapIcons(instance, withShields(icons));
    instance.on("load", () => options.onLoad?.(instance));
    map.value = instance;
  });

  /**
   * Add the raster layer for a basemap the reader has not seen yet, hidden, beneath everything.
   *
   * ⚠ `beforeId` is not optional politeness. A layer added with no `beforeId` goes on TOP, so the
   * second basemap would be painted over the truck markers `onLoad` added — a map with no trucks on
   * it, reported as "the markers disappeared when I changed the theme". The new raster goes directly
   * above the rasters we already own and below the first layer that is anybody else's.
   */
  function addBasemapLayer(instance: maplibregl.Map, tiles: string): string {
    const id = `${TILE_SOURCE}-${basemaps.size}`;
    /**
     * ⚠ EVERY source carries the attribution, and the comment that stood here said the opposite.
     * It claimed maplibre would print "© HERE" once per source; the installed 5.24.0 bundle
     * (`_updateAttributions`) adds a source's attribution only if it is not already in the list, and
     * only for a source a VISIBLE layer uses. So with the attribution on the first source alone, the
     * credit vanished the moment satellite or terrain hid that layer, and HERE's terms require it
     * (Platform Terms §13.1). Found while adding the vector map, 2026-11-10.
     */
    if (isVectorTemplate(tiles)) {
      for (const [sourceId, source] of Object.entries(vectorSources(tiles, id))) instance.addSource(sourceId, source);
    } else {
      instance.addSource(id, { ...rasterSource(tiles), attribution: options.attribution });
    }
    const layers = isVectorTemplate(tiles) ? vectorBasemapLayers(mapPalette(), id, `${id}:`) : [rasterLayer(id)];
    const before = firstForeignLayer(instance, layers.map((l) => l.id));
    for (const layer of layers) {
      instance.addLayer({ ...layer, layout: { ...(layer.layout ?? {}), visibility: "none" } } as maplibregl.LayerSpecification, before);
    }
    basemaps.set(tiles, { source: id, layers: layers.map((l) => l.id) });
    return id;
  }

  /** The first layer that is not one of this composable's basemaps: new basemap layers go under it. */
  function firstForeignLayer(instance: maplibregl.Map, adding: string[]): string | undefined {
    const ours = new Set([...[...basemaps.values()].flatMap((b) => b.layers), ...adding]);
    return instance.getStyle().layers.find((l) => !ours.has(l.id))?.id;
  }

  /**
   * Repaint the vector road map in the scheme now on screen (D-DR31). Its layers are rebuilt from
   * the tokens in place, under the same layer; the source and its tiles are kept, so nothing is
   * fetched again.
   */
  function repaintVector(instance: maplibregl.Map): void {
    for (const [tiles, group] of basemaps) {
      if (!isVectorTemplate(tiles)) continue;
      const visible = instance.getLayoutProperty(group.layers[0]!, "visibility") !== "none";
      const fresh = vectorBasemapLayers(mapPalette(), group.source, `${group.source}:`);
      const before = instance.getStyle().layers.slice(
        instance.getStyle().layers.findIndex((l) => l.id === group.layers.at(-1)) + 1,
      )[0]?.id;
      for (const lid of group.layers) instance.removeLayer(lid);
      for (const layer of fresh) {
        instance.addLayer({ ...layer, layout: { ...(layer.layout ?? {}), visibility: visible ? "visible" : "none" } } as maplibregl.LayerSpecification, before);
      }
    }
  }

  /** D-DR35: the place icons in the scheme on screen, and how a scheme change reaches the map. */
  const iconsInScheme = () => rasteriseMapIcons(mapPalette().label, mapPalette()["label-halo"]);
  /** D-DR36: the road signs are drawn synchronously and join the icons as one set of images. */
  const withShields = (icons: Awaited<ReturnType<typeof iconsInScheme>>) => new Map([...icons, ...rasteriseShields(mapPalette())]);
  let repaintIcons: ((next: Awaited<ReturnType<typeof iconsInScheme>>) => void) | null = null;

  if (options.isDark) {
    watch(options.isDark, () => {
      if (map.value) repaintVector(map.value);
      void iconsInScheme().then((next) => repaintIcons?.(withShields(next)));
    });
  }

  /**
   * Swap the basemap when a reactive `tiles` changes (D-DR8, rebuilt by D-DR23).
   *
   * ── WHY THIS IS NO LONGER `setTiles`, MEASURED RATHER THAN ASSUMED (2026-09-16) ─────────────────
   * D-DR8 swapped the ONE raster source's tiles in place, which kept the camera — the thing that
   * mattered — but threw away maplibre's tiles for the basemap being left, so every flip re-requested
   * the whole viewport and re-decoded it. Measured on the live map at 1512×900 (9 tiles in view, the
   * API stand-in serving real HERE bytes with the proxy's own headers):
   *
   *   flip to an unseen scheme   9 requests · 262 KB on the wire · last repaint at 722 ms
   *   flip BACK to a seen scheme 9 requests · **0 KB — every one served by the browser's HTTP cache**
   *                              · last repaint still at ~400–440 ms
   *
   * ⚠ **The second line is why the fix is not the one the queue assumed.** The handoff read this as a
   * network cost; `Cache-Control: max-age=86400` on the proxy had already solved that half.
   * What is left is maplibre re-requesting, re-decoding and re-uploading nine textures it had a
   * moment ago — ~0.4 s of work to show a picture the GPU has already been given. A fix aimed at the
   * bytes would have moved a number that was already zero.
   *
   * So each basemap keeps its OWN source and layer, and a switch is a visibility toggle: nothing is
   * fetched, decoded or uploaded twice, and a return to a basemap this map has shown before is one
   * frame. ⚠ Nothing is added up front — a reader who never opens the switcher never pays for
   * satellite. This is also why D-DR22 (jpeg) had to land first: holding two viewports of tiles is
   * cheap at ~260 KB a scheme and would not have been at ~2.4 MB.
   *
   * ⚠ The old basemap stays visible until the new source has finished loading, so a first switch
   * fades between two maps instead of flashing the empty canvas. On a repeat switch the source is
   * already loaded and `isSourceLoaded` is true on the spot, so there is no delay to pay.
   *
   * ⚠ Source ids stay private to this composable. A caller reaching for `getSource("here")` to do
   * this itself would be the copy that drifts — the ref is the supported way to ask.
   */
  watch(
    tileUrl,
    (next) => {
      const instance = map.value;
      if (!instance) return;
      const known = basemaps.get(next)?.source;
      const id = known ?? addBasemapLayer(instance, next);
      const show = (tiles: string, on: boolean) => {
        for (const layerId of basemaps.get(tiles)?.layers ?? []) {
          if (instance.getLayer(layerId)) instance.setLayoutProperty(layerId, "visibility", on ? "visible" : "none");
        }
      };
      const reveal = () => {
        for (const tiles of basemaps.keys()) show(tiles, tiles === next);
      };
      // A layer must be visible before maplibre will load its tiles, so the new one is revealed
      // first and the old ones are only hidden once the new source reports itself loaded.
      show(next, true);
      if (instance.isSourceLoaded(id)) return reveal();
      const onData = (e: maplibregl.MapSourceDataEvent) => {
        if (e.sourceId !== id || !instance.isSourceLoaded(id)) return;
        instance.off("sourcedata", onData);
        // The reader may have switched again while this one loaded; the last choice wins.
        if (tileUrl() === next) reveal();
      };
      instance.on("sourcedata", onData);
    },
  );

  onBeforeUnmount(() => {
    // The caller's own attachments go first, while the map they were added to still exists.
    options.onBeforeTeardown?.(map.value);
    // Then the subscription, then the map, and both matter. An auth listener that outlives its map
    // writes a token into a closure nothing will ever read; a map that is not disposed leaks a WebGL
    // context, and browsers cap those at around sixteen before they start killing the oldest.
    authSub?.unsubscribe();
    authSub = null;
    map.value?.remove();
    map.value = null;
  });

  return { map };
}
