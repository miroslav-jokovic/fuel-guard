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
import { onBeforeUnmount, onMounted, shallowRef, type Ref } from "vue";
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
  /** Raster tile template, served by our own authenticated proxy. */
  tiles: string;
  /**
   * The path fragment marking a request that needs our Bearer token. maplibre fetches tiles from a
   * worker with no auth header of its own, so `transformRequest` is the only place to attach one —
   * and it is matched on a fragment rather than applied to every request, because sending the
   * carrier's JWT to a third-party attribution or sprite URL would be a credential leak.
   */
  authPathFragment: string;
  attribution: string;
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

export function useMapLibre(options: UseMapLibreOptions): {
  map: Ref<maplibregl.Map | null>;
} {
  // `shallowRef`, not `ref`: a maplibre Map is a large mutable object with its own internal state, and
  // making it deeply reactive would have Vue walk and proxy the whole thing on every access.
  const map = shallowRef<maplibregl.Map | null>(null);
  let accessToken: string | null = null;
  let authSub: { unsubscribe(): void } | null = null;

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
          here: {
            type: "raster",
            tiles: [options.tiles],
            tileSize: 512,
            attribution: options.attribution,
          },
        },
        layers: [{ id: "here", type: "raster", source: "here" }],
      },
      attributionControl: { compact: true },
      dragRotate: false,
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    instance.on("load", () => options.onLoad?.(instance));
    map.value = instance;
  });

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
