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
   * At most four entries (three choices × a night variant of one), each added the first time the
   * reader asks for it and kept for the life of the map.
   */
  const rasterLayers = new Map<string, string>();

  function attachAuth(url: string): maplibregl.RequestParameters {
    if (accessToken && url.includes(options.authPathFragment)) {
      return { url, headers: { Authorization: `Bearer ${accessToken}` } };
    }
    return { url };
  }

  onMounted(async () => {
    if (!options.container.value) return;
    // ⚠ Awaited BEFORE the map is constructed — see the file header.
    const { data: sess } = await supabase.auth.getSession();
    accessToken = sess.session?.access_token ?? null;
    authSub = supabase.auth.onAuthStateChange((_e, session) => {
      // Kept fresh on refresh: a map left open longer than the token's life would start 401ing tiles
      // partway through a session, which looks like a broken map rather than an expired login.
      accessToken = session?.access_token ?? null;
    }).data.subscription;

    const instance = new maplibregl.Map({
      container: options.container.value,
      transformRequest: attachAuth,
      style: {
        version: 8,
        sources: {
          [TILE_SOURCE]: {
            type: "raster",
            tiles: [toValue(options.tiles)],
            tileSize: 512,
            attribution: options.attribution,
          },
        },
        layers: [{ id: TILE_SOURCE, type: "raster", source: TILE_SOURCE }],
      },
      attributionControl: { compact: true },
      dragRotate: false,
    });
    // The style above declares the first basemap, so it is registered here rather than added again —
    // otherwise the first switch would build a second layer for a basemap already on screen, and
    // every id would be off by one.
    rasterLayers.set(toValue(options.tiles), TILE_SOURCE);
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
    const id = rasterLayers.size === 0 ? TILE_SOURCE : `${TILE_SOURCE}-${rasterLayers.size}`;
    instance.addSource(id, {
      type: "raster",
      tiles: [tiles],
      tileSize: 512,
      // ⚠ Only the first source carries it: maplibre concatenates the attribution of every source
      // with a visible layer, and four sources naming HERE would print "© HERE" four times.
      ...(rasterLayers.size === 0 ? { attribution: options.attribution } : {}),
    });
    const ours = new Set([...rasterLayers.values(), id]);
    const firstForeign = instance.getStyle().layers.find((l) => !ours.has(l.id));
    instance.addLayer({ id, type: "raster", source: id, layout: { visibility: "none" } }, firstForeign?.id);
    rasterLayers.set(tiles, id);
    return id;
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
   * network cost; `Cache-Control: public, max-age=86400` on the proxy had already solved that half.
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
    () => toValue(options.tiles),
    (next) => {
      const instance = map.value;
      if (!instance) return;
      const known = rasterLayers.get(next);
      const id = known ?? addBasemapLayer(instance, next);
      const reveal = () => {
        for (const [tiles, layerId] of rasterLayers) {
          if (!instance.getLayer(layerId)) continue;
          instance.setLayoutProperty(layerId, "visibility", tiles === next ? "visible" : "none");
        }
      };
      // A layer must be visible before maplibre will load its tiles, so the new one is revealed
      // first and the old ones are only hidden once the new source reports itself loaded.
      instance.setLayoutProperty(id, "visibility", "visible");
      if (instance.isSourceLoaded(id)) return reveal();
      const onData = (e: maplibregl.MapSourceDataEvent) => {
        if (e.sourceId !== id || !instance.isSourceLoaded(id)) return;
        instance.off("sourcedata", onData);
        // The reader may have switched again while this one loaded; the last choice wins.
        if (toValue(options.tiles) === next) reveal();
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
