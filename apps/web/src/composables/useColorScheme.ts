import { computed, ref } from "vue";

/**
 * The colour-scheme preference (D-DS2b).
 *
 * ── Why this writes `color-scheme` and not a class ──────────────────────────────────────────────
 * Every themed token is a `light-dark()` pair, and `light-dark()` resolves against the element's
 * computed `color-scheme` — not against a selector. So the entire toggle is one CSS property on
 * `<html>`. There is no `.dark` class, no `@custom-variant`, and no `dark:` variant anywhere in
 * apps/web; that is the whole reason D-DS2 was built this way.
 *
 * Setting the property also tells the browser which scheme is active, so native form controls,
 * scrollbars, `Highlight` and the rest follow without being restyled. A class could never do that.
 *
 * ── "system" is a real state, not the absence of one ────────────────────────────────────────────
 * `color-scheme: light dark` means "both supported, follow the user's OS". `light` or `dark` alone
 * pins it. So the three states map onto one property with no extra machinery, and clearing the
 * stored preference genuinely returns to following the system rather than freezing whatever the
 * system happened to be at the time.
 */
export type ColorScheme = "system" | "light" | "dark";

const STORAGE_KEY = "fg.color-scheme";
const SCHEMES: readonly ColorScheme[] = ["system", "light", "dark"];

function read(): ColorScheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return SCHEMES.includes(stored as ColorScheme) ? (stored as ColorScheme) : "system";
  } catch {
    // Safari in private mode throws on localStorage access rather than returning null.
    return "system";
  }
}

/** Module-level so every caller shares one value — the preference is global, not per-component. */
const scheme = ref<ColorScheme>(read());

/**
 * What the operating system prefers, kept current by the media query's `change` event.
 *
 * ⚠ `isDark` used to read `matchMedia(...).matches` inside its `computed`. Nothing reactive is
 * touched there, so it computed once and never again: when the OS turned dark while the app was
 * open (macOS "Auto" appearance at sunset), the CSS followed through `light-dark()` and every
 * reader of `isDark` did not. The live map kept its day tiles and light markers inside a dark app.
 * Found on staging 2026-11-11 while checking the vector map's night scheme (D-DR33 item 6).
 */
const systemQuery = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;
const systemDark = ref(systemQuery?.matches === true);
systemQuery?.addEventListener?.("change", (e) => {
  systemDark.value = e.matches;
  syncThemeColor();
});

/**
 * The browser's own chrome — an installed window's title bar, Android's status bar — in the page's canvas
 * (INSTALLED-APP-PLAN.md D-IA3). `index.html` ships a light/dark pair keyed to the OPERATING SYSTEM's scheme,
 * which is wrong the moment a person picks the other one here; so once the app runs there is one tag, and it
 * holds whatever `<html>`'s background actually resolved to. Read, never restated: the colour is `--canvas`.
 */
/**
 * The computed background comes back in the token's own notation (`oklch(…)`, measured in Chromium
 * 2026-11-14). Whether every browser's CHROME reads that from a meta tag is not something this can check, so
 * the tag is given plain sRGB: one pixel painted and read back. Where there is no canvas the value passes as is.
 */
function asSrgb(colour: string): string {
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return colour;
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => v!.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return colour;
  }
}

export function syncThemeColor() {
  if (typeof document === "undefined") return;
  const colour = getComputedStyle(document.documentElement).backgroundColor;
  // jsdom, or a stylesheet that has not arrived: leave `index.html`'s pair alone instead of writing nothing.
  if (!colour || colour === "transparent" || colour === "rgba(0, 0, 0, 0)") return;
  const tags = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  const tag = tags[0] ?? document.head.appendChild(Object.assign(document.createElement("meta"), { name: "theme-color" }));
  for (const extra of tags.slice(1)) extra.remove();
  tag.removeAttribute("media");
  tag.content = asSrgb(colour);
}

function paint(value: ColorScheme) {
  const root = document.documentElement;
  root.style.colorScheme = value === "system" ? "light dark" : value;
  syncThemeColor();
}

/**
 * Applied before mount so the first paint is already correct. `index.html` cannot do this — the
 * preference lives in localStorage and the token layer defaults to `light dark`, so a system-follow
 * user sees the right scheme immediately and only an explicit override needs replaying.
 */
export function initColorScheme() {
  paint(scheme.value);
}

export function useColorScheme() {
  const isDark = computed(() => {
    if (scheme.value === "dark") return true;
    if (scheme.value === "light") return false;
    return systemDark.value;
  });

  function set(value: ColorScheme) {
    scheme.value = value;
    paint(value);
    try {
      if (value === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // A preference that cannot be stored still applies for this session.
    }
  }

  return {
    scheme: computed(() => scheme.value),
    isDark,
    set,
    /** Cycles system → light → dark → system, for a single-control affordance. */
    cycle: () => set(SCHEMES[(SCHEMES.indexOf(scheme.value) + 1) % SCHEMES.length]!),
  };
}
